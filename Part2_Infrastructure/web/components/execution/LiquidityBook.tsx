"use client";

/**
 * Liquidity: the consolidated book, read two ways.
 *
 * The depth curve and the price ladder are the same snapshot — one as a shape,
 * one as levels — so they share a baseline and a single `snap` prop rather than
 * each reading the stream. Split out of `LiveMarket` with the ladder builder it
 * is the only caller of.
 *
 * Clicking a level stages a limit in the ticket; nothing here submits anything.
 *
 * The snapshot arrives every 300ms — `useLiveBook`'s publish tick is the
 * desk's shared throttle window, so a venue's ten frames a second coalesce to
 * one paint here. What this file adds on top is that the paint is confined:
 * the two ladders are memoised on the levels they draw, and the whole panel is
 * memoised to skip its render while the Liquidity section is hidden behind
 * another (`hidden-panel.ts`). The card margins and borders around the chart
 * never move; only the paths and the level rows inside them change.
 */

import { memo, useMemo } from "react";

import DepthChart from "@/components/DepthChart";
import StatTile from "@/components/StatTile";
import Figure from "@/components/coherence/Figure";
import { compact, fmt } from "@/lib/format";
import type { LiveSnapshot } from "@/lib/livebook";
import { DEPTH_BAND_BPS, type Side } from "@/lib/venues";

import { type HideablePanelProps, skipWhileHidden } from "./hidden-panel";
import DepthHeatmap from "./DepthHeatmap";

interface LiquidityBookProps extends HideablePanelProps {
  symbol: string;
  snap: LiveSnapshot | null;
  /** Price decimals for this instrument, decided once by the tab. */
  dp: number;
  /** Ladder click-to-trade: stage a limit at the clicked level in the ticket. */
  onPriceSelect?: (pick: { side: Side; price: number }) => void;
}

/**
 * Levels shown per side.
 *
 * Eight keeps the actionable near-touch book in one compact card without an
 * inner scroll. Deeper shape is still visible in the cumulative-depth chart;
 * the ladder is for choosing a price, where the closest levels are the useful
 * ones.
 */
const LADDER_DEPTH = 8;

/**
 * One side of the ladder as rows. Module-level rather than a closure so the
 * memo below can name exactly what a row depends on — the levels, the side,
 * the instrument's decimals and the click handler — and nothing else.
 */
function ladderRows(
  rows: [number, number][],
  kind: "bid" | "ask",
  symbol: string,
  dp: number,
  onPriceSelect?: (pick: { side: Side; price: number }) => void,
) {
  const top = rows.slice(0, LADDER_DEPTH);
  let cum = 0;
  const withCum = top.map(([p, q]) => {
    cum += p * q;
    return { p, q, cum };
  });
  const max = withCum.at(-1)?.cum ?? 1;
  const colour = kind === "bid" ? "var(--diverging-pos)" : "var(--diverging-neg)";
  const textColour = kind === "bid" ? "var(--diverging-pos)" : "var(--critical-text)";
  const rowsOut = kind === "ask" ? [...withCum].reverse() : withCum;

  // Lifting an ask is a BUY at that price; hitting a bid is a SELL.
  const clickSide: Side = kind === "ask" ? "BUY" : "SELL";

  return rowsOut.map(({ p, q, cum: c }) => (
    <button
      key={`${kind}-${p}`}
      type="button"
      className="ladder-row"
      title="Stage as a limit order in the ticket"
      aria-label={`${clickSide === "BUY" ? "Buy" : "Sell"} ${symbol} at ${fmt(p, dp)} — stage a limit order in the ticket`}
      onClick={() => onPriceSelect?.({ side: clickSide, price: p })}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          right: 0,
          width: `${(c / max) * 100}%`,
          background: colour,
          /* 0.14 read as ~1.05:1 against the card — a wash nobody saw. */
          opacity: 0.22,
          borderRadius: 3,
        }}
      />
      <span style={{ position: "relative", color: textColour }}>{fmt(p, dp)}</span>
      <span style={{ position: "relative", textAlign: "right", color: "var(--text-secondary)" }}>
        {fmt(q, 4)}
      </span>
      <span style={{ position: "relative", textAlign: "right", color: "var(--text-secondary)" }}>
        {compact(c)}
      </span>
    </button>
  ));
}

function LiquidityBook({ symbol, snap, dp, onPriceSelect }: LiquidityBookProps) {
  // Keyed on the merged sides, not on the snapshot: the venue list and the
  // derived tiles change on every publish, the levels only when a book moves.
  const asks = snap?.merged.asks;
  const bids = snap?.merged.bids;
  const askRows = useMemo(
    () => (asks ? ladderRows(asks, "ask", symbol, dp, onPriceSelect) : null),
    [asks, symbol, dp, onPriceSelect],
  );
  const bidRows = useMemo(
    () => (bids ? ladderRows(bids, "bid", symbol, dp, onPriceSelect) : null),
    [bids, symbol, dp, onPriceSelect],
  );

  // Depth is notional inside a band around the mid, so it is exactly as
  // measurable as the mid is. Named once and read by both tiles, which must
  // never disagree about whether the book was read.
  const bandMeasurable = snap != null && snap.consolidatedMid != null;
  const depthNote = snap == null
    ? "no book snapshot"
    : snap.consolidatedMid == null
      ? "no consolidated mid to measure a band against"
      : `within ±${DEPTH_BAND_BPS} bps of mid`;

  return (
    <>
      <div className="tiles" style={{ marginBottom: 16, gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
        <StatTile label="Consolidated mid" value={fmt(snap?.consolidatedMid, dp)} note={`${snap?.venues.filter((v) => v.status === "live").length ?? 0} venues live`} />
        <StatTile
          label="Spread"
          value={snap?.spreadBps == null ? "—" : `${fmt(snap.spreadBps, 2)} bps`}
          note={snap?.spreadBps != null && snap.spreadBps < 0 ? "crossed across venues" : "consolidated"}
          tone={snap?.spreadBps != null && snap.spreadBps < 0 ? "pos" : undefined}
        />
        {/* Dashed, not zeroed — matching the Spread tile beside them. An
            absent snapshot rendered "$0 of depth", which reads as an empty
            book rather than as an unread one.

            The same hole was still open one level down, and this is what
            closes it: `depthWithinBps` answers a null mid with a literal 0
            (lib/venues/book-maths.ts), so `depthUsdBid == null` could never
            be true and a snapshot taken while every venue was dark printed
            "$0" under the note "within ±10 bps of mid" — a band that did not
            exist to be measured. Traced rather than guessed: `consolidatedMid`
            is null whenever no venue is both connected and fresh, and the same
            publish tick that produces that null hands these tiles a 0 — the
            Imbalance tile beside them takes the honest branch (`bandImbalance`
            returns null on an empty band) and these two did not. The band is
            measured FROM the mid, so no mid is no measurement, and the tile
            names which of the two is missing. Rejected: changing that 0 to
            null in book-maths, whose other five call sites include the
            router's own depth sums — the claim to a reader is made here, so
            the guard belongs here.

            The `== null` half stays in front of it rather than being replaced
            by the mid check: `depthUsdBid` is typed `number` today only
            because that 0 exists, and `null-honesty.test.ts` reads this
            expression as the proof the tile does not zero an unread book.

            The band itself is read from the constant the maths uses rather
            than spelt "10" a second time: the note and the measurement were
            two copies of one number with nothing keeping them in step. */}
        <StatTile
          label="Bid depth"
          value={!bandMeasurable || snap?.depthUsdBid == null ? "—" : `$${compact(snap.depthUsdBid)}`}
          note={depthNote}
        />
        <StatTile
          label="Ask depth"
          value={!bandMeasurable || snap?.depthUsdAsk == null ? "—" : `$${compact(snap.depthUsdAsk)}`}
          note={depthNote}
        />
        <StatTile
          label="Imbalance"
          value={snap?.imbalance == null ? "—" : `${(snap.imbalance * 100).toFixed(1)}%`}
          note={snap?.imbalance == null ? "" : snap.imbalance > 0 ? "bid heavy" : "ask heavy"}
          tone={snap?.imbalance == null ? undefined : snap.imbalance > 0 ? "pos" : "neg"}
        />
      </div>

      {/* The first row reads one book as latest shape and bounded history. The
          exact ladder spans below it, keeping click-to-stage room without
          shrinking either quantitative view. */}
      <div className="compact-grid-2col liquidity-pair">
        <div className="card liquidity-pair__depth">
          <Figure
            caption="Cumulative resting depth through the current consolidated book"
            ariaLabel="Cumulative bid and ask notional by distance from the consolidated mid price"
            reserveInteractionRow={false}
          >
            <DepthChart
              bids={snap?.merged.bids ?? []}
              asks={snap?.merged.asks ?? []}
              mid={snap?.consolidatedMid ?? null}
              height={500}
            />
          </Figure>
          <details className="disclosure">
            <summary>How should this curve be read?</summary>
            <p className="research-note">
              Size resting between the mid and any price. A near-vertical step is a wall; a shallow ramp is a thin book that costs to cross.
            </p>
          </details>
        </div>

        <div className="card liquidity-pair__history" data-depth-history="">
          <DepthHeatmap history={snap?.depthHistory ?? []} dp={dp} />
        </div>

        <div className="card liquidity-pair__ladder">
          <h2 id="execution-liquidity-ladder-title">Consolidated ladder</h2>
          {/* The sentence split: the click-to-trade affordance is the only
              at-rest discovery of what a row does, so it stays here while the
              descriptive half folds under the ladder — matching the depth card
              beside it, which is the only reason this one earns a fold at all. */}
          <p className="sub">
            Click a level to stage it as a limit in the ticket.
          </p>
          <div
            className="liquidity-pair__book"
            role="region"
            aria-labelledby="execution-liquidity-ladder-title"
          >
            <div className="liquidity-ladder__head">
              <span>Price</span>
              <span style={{ textAlign: "right" }}>Size</span>
              <span style={{ textAlign: "right" }}>Cum $</span>
            </div>
            {askRows}
            <div className="liquidity-ladder__mid">
              <span className="num liquidity-ladder__mid-price">
                {fmt(snap?.consolidatedMid, dp)}
              </span>
              <span className="num muted liquidity-ladder__spread">
                spread {fmt(snap?.spreadBps, 2)} bps
              </span>
            </div>
            {bidRows ?? <div className="muted" style={{ padding: 16, textAlign: "center" }}>waiting for book…</div>}
          </div>
          <details className="disclosure">
            <summary>Whose levels are these, and in what order?</summary>
            <p className="research-note">
              Every venue&apos;s levels by price, the book a smart router walks.
            </p>
          </details>
        </div>
      </div>
    </>
  );
}

/**
 * Skips the render while the section is hidden; shallow-compares while shown.
 * `active` is read by the comparator and by nothing inside the component.
 */
export default memo(LiquidityBook, skipWhileHidden);
