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
 */

import DepthChart from "@/components/DepthChart";
import StatTile from "@/components/StatTile";
import { compact, fmt } from "@/lib/format";
import type { LiveSnapshot } from "@/lib/livebook";
import type { Side } from "@/lib/venues";

interface LiquidityBookProps {
  symbol: string;
  snap: LiveSnapshot | null;
  /** Price decimals for this instrument, decided once by the tab. */
  dp: number;
  /** Ladder click-to-trade: stage a limit at the clicked level in the ticket. */
  onPriceSelect?: (pick: { side: Side; price: number }) => void;
}

export default function LiquidityBook({ symbol, snap, dp, onPriceSelect }: LiquidityBookProps) {
  const ladder = (rows: [number, number][], kind: "bid" | "ask") => {
    const top = rows.slice(0, 12);
    let cum = 0;
    const withCum = top.map(([p, q]) => {
      cum += p * q;
      return { p, q, cum };
    });
    const max = withCum.at(-1)?.cum ?? 1;
    const colour = kind === "bid" ? "var(--diverging-pos)" : "var(--diverging-neg)";
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
        <span style={{ position: "relative", color: colour }}>{fmt(p, dp)}</span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-secondary)" }}>
          {fmt(q, 4)}
        </span>
        <span style={{ position: "relative", textAlign: "right", color: "var(--text-muted)" }}>
          {compact(c)}
        </span>
      </button>
    ));
  };

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
            book rather than as an unread one. */}
        <StatTile
          label="Bid depth"
          value={snap?.depthUsdBid == null ? "—" : `$${compact(snap.depthUsdBid)}`}
          note={snap == null ? "no book snapshot" : "within ±10 bps of mid"}
        />
        <StatTile
          label="Ask depth"
          value={snap?.depthUsdAsk == null ? "—" : `$${compact(snap.depthUsdAsk)}`}
          note={snap == null ? "no book snapshot" : "within ±10 bps of mid"}
        />
        <StatTile
          label="Imbalance"
          value={snap?.imbalance == null ? "—" : `${(snap.imbalance * 100).toFixed(1)}%`}
          note={snap?.imbalance == null ? "" : snap.imbalance > 0 ? "bid heavy" : "ask heavy"}
          tone={snap?.imbalance == null ? undefined : snap.imbalance > 0 ? "pos" : "neg"}
        />
      </div>

      {/* The curve and the ladder are the same book read two ways, so they
          share one baseline: the chart takes the ladder's height instead of
          sitting 210px tall beside 570px of levels. */}
      <div className="compact-grid-2col liquidity-pair">
        <div className="card">
          <h2>Cumulative depth</h2>
          <p className="sub">
            Size resting between the mid and any price. A near-vertical step is a wall; a shallow
            ramp is a thin book that costs to cross.
          </p>
          <DepthChart
            bids={snap?.merged.bids ?? []}
            asks={snap?.merged.asks ?? []}
            mid={snap?.consolidatedMid ?? null}
            height={430}
          />
        </div>

        <div className="card">
          <h2>Consolidated ladder</h2>
          <p className="sub">
            Every venue&apos;s levels by price, the book a smart router walks. Click a level to
            stage it as a limit in the ticket.
          </p>
          <div className="liquidity-pair__book">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                fontSize: "var(--fs-2xs)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "var(--text-muted)",
                padding: "0 6px 6px",
              }}
            >
              <span>Price</span>
              <span style={{ textAlign: "right" }}>Size</span>
              <span style={{ textAlign: "right" }}>Cum $</span>
            </div>
            {snap ? ladder(snap.merged.asks, "ask") : null}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "8px 6px",
                margin: "4px 0",
                borderTop: "1px solid var(--grid)",
                borderBottom: "1px solid var(--grid)",
              }}
            >
              <span className="num" style={{ fontSize: "var(--fs-h2)", fontWeight: 650 }}>
                {fmt(snap?.consolidatedMid, dp)}
              </span>
              <span className="num muted" style={{ fontSize: "var(--fs-body)" }}>
                spread {fmt(snap?.spreadBps, 2)} bps
              </span>
            </div>
            {snap ? ladder(snap.merged.bids, "bid") : <div className="muted" style={{ padding: 16, textAlign: "center" }}>waiting for book…</div>}
          </div>
        </div>
      </div>
    </>
  );
}
