"use client";

/**
 * Whether the basket can actually be put on: each leg's size against the
 * contracts outstanding at that strike.
 *
 * The certificate answers "does a portfolio exist that pays in every state",
 * and the desk drew that answer three ways — the payoff per state, the
 * covering, the fee ladder — without ever asking the question a reader asks
 * next, which is whether the thing can be BOUGHT. A basket needing four times
 * the open interest of one leg is a certificate and not a trade.
 *
 * SHARE OF WHAT IS OUTSTANDING, and the rule at one is the whole of it. A
 * column above the rule is a leg the solver sized past everything anybody
 * holds. Open interest is not depth — it says how much has been held, never
 * how much can be traded now — so this is a floor on the difficulty rather
 * than an estimate of it, and the note says so.
 *
 * WHAT IT REFUSES. A leg whose market reports no open interest is not drawn at
 * zero: the venue stopped sending the field, which is a protocol change and
 * not a market nobody holds, and a share against a missing denominator is not
 * a number. A leg naming a market outside this family is counted as off-board
 * rather than dropped, because dropping it would draw a smaller basket than
 * the solver built.
 *
 * Traded volume rides along as a hollow tick on the same column: the same size
 * read against what has actually changed hands, which is a different and
 * usually harsher denominator. It is a second reading of one column, never a
 * second bar.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { money } from "@/lib/coherence/strike-axis";
import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { pct } from "@/lib/format";

const HEIGHT = 196;
const MARGIN = { top: 26, right: 12, bottom: 44, left: 40 };
const MAX_BAR = 46;
/** The height a share of exactly zero draws at, so a measured zero is a mark. */
const FLOOR = 2;
const CAPTION = "What the basket needs, against what is outstanding at each leg";

interface Column {
  label: string;
  ticker: string;
  size: number | null;
  openInterest: number | null;
  volume: number | null;
  /** Size as a share of the open interest; null when either side is unreadable. */
  share: number | null;
  tradedShare: number | null;
}

export default function BasketFootprint({ certificate, event }: {
  certificate: CoherenceCertificate;
  /** The family, for the open interest each leg's market reports. Null while it is unread. */
  event: CoherenceEventView | null;
}) {
  const markets = event?.markets ?? [];
  let offBoard = 0;
  const columns: Column[] = certificate.legs.map((leg) => {
    const market = markets.find((market) => market.ticker === leg.ticker) ?? null;
    if (market === null) offBoard += 1;
    const size = money(leg.size);
    const openInterest = market === null ? null : money(market.open_interest);
    const volume = market === null ? null : money(market.volume);
    return {
      label: leg.label || leg.ticker,
      ticker: leg.ticker,
      size,
      openInterest,
      volume,
      share: size === null || openInterest === null || openInterest === 0 ? null : size / openInterest,
      tradedShare: size === null || volume === null || volume === 0 ? null : size / volume,
    };
  });

  const drawn = columns.map((column) => column.share).filter((share): share is number => share !== null);

  if (!columns.length || !drawn.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No leg of this basket can be measured against an open interest"
        missing={
          !columns.length
            ? "This test returned no portfolio, so there is nothing to size."
            : `No leg can be sized: ${offBoard ? `${offBoard} name a market outside this family, and ` : ""}`
              + "the rest report no open interest — the venue stopped sending the field, which is a protocol"
              + " change rather than a market nobody holds."
        }
      >
        <FigureEmpty reason="Nothing to size against — no leg reports an open interest." />
      </Figure>
    );
  }

  // The axis reaches past the rule whenever a leg does, so a basket bigger than
  // the book is drawn as bigger rather than clipped at it.
  const ceiling = Math.max(1.2, ...drawn) * 1.05;
  const unmeasured = columns.length - drawn.length;
  const over = drawn.filter((share) => share > 1).length;

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${columns.length} legs, ${drawn.length} of them sized against the contracts outstanding at their strike, `
        + `on an axis whose rule is the whole open interest`
      }
      reading={
        over
          ? `${over} of ${columns.length} legs need more than the whole open interest at their strike, so this basket`
            + " is a certificate before it is a trade."
          : `Every measured leg sits under the rule: the largest needs ${pct(Math.max(...drawn))} of what is`
            + " outstanding at its strike."
      }
      missing={
        unmeasured
          ? `${unmeasured} of ${columns.length} legs are not drawn`
            + `${offBoard ? `, ${offBoard} of them naming a market outside this family` : ""}`
            + " — a share against an open interest the venue did not report is not a number, and a zero there"
            + " would read as a leg nobody holds."
          : null
      }
      notes={[
        "Open interest is contracts OUTSTANDING, not depth: it says how much has been held, never how much can"
        + " be traded now. A leg under the rule is therefore a floor on the difficulty rather than an estimate"
        + " of it — the resting size at that strike can be a fraction of what is held.",
        "The hollow tick is the same size read against contracts TRADED, which is usually the harsher"
        + " denominator: a strike can carry a large position that nobody has moved in a week.",
        "Sizes are the solver's own. It sizes to prove the theorem, not to fill — so a leg over the rule is a"
        + " statement about the quotes rather than an order anyone would send.",
      ]}
    >
      <Plot
        height={HEIGHT}
        // THE RULE IS THE WHOLE OPEN INTEREST, painted under every column by
        // the plot itself so nothing can occlude the one line the reader is
        // asked to judge against.
        reference={(width: number) => ({
          y: (HEIGHT - MARGIN.bottom) - (1 / ceiling) * (HEIGHT - MARGIN.bottom - MARGIN.top),
          x0: MARGIN.left,
          x1: width - MARGIN.right,
          label: "the whole open interest",
        })}
      >
        {(width) => {
          const inner = Math.max(1, width - MARGIN.left - MARGIN.right);
          const slot = inner / columns.length;
          const bar = Math.min(MAX_BAR, slot * 0.6);
          const base = HEIGHT - MARGIN.bottom;
          const y = (share: number) => base - (Math.min(share, ceiling) / ceiling) * (base - MARGIN.top);
          const budget = Math.max(3, Math.floor(slot / 7.28));
          const short = (text: string) => (text.length > budget ? `${text.slice(0, budget - 1)}…` : text);
          return (
            <>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-surface__axis" />
              {columns.map((column, index) => {
                const cx = MARGIN.left + slot * (index + 0.5);
                if (column.share === null) {
                  return (
                    <g key={column.ticker}>
                      <title>
                        {`${column.label}: ${column.openInterest === null
                          ? "open interest not reported — the venue stopped sending the field"
                          : "open interest is zero, so a share of it is not a number"}`}
                      </title>
                      <text x={cx} y={(MARGIN.top + base) / 2} textAnchor="middle" className="coh-surface__unread">
                        ◌
                      </text>
                      <text x={cx} y={base + 16} textAnchor="middle" className="coh-footprint__label">
                        {short(column.label)}
                      </text>
                    </g>
                  );
                }
                const top = y(column.share);
                return (
                  <g key={column.ticker}>
                    <title>
                      {`${column.label}: ${column.size} contracts against ${column.openInterest} outstanding`
                        + ` — ${pct(column.share)} of the open interest`
                        + `${column.tradedShare === null
                          ? "; traded volume not reported"
                          : `, ${pct(column.tradedShare)} of what has traded`}`}
                    </title>
                    <rect
                      x={cx - bar / 2}
                      y={top}
                      width={bar}
                      height={Math.max(FLOOR, base - top)}
                      className={`coh-footprint__bar${column.share > 1 ? " is-over" : ""}`}
                    />
                    {column.tradedShare === null ? null : (
                      <line
                        x1={cx - bar / 2}
                        x2={cx + bar / 2}
                        y1={y(column.tradedShare)}
                        y2={y(column.tradedShare)}
                        className="coh-footprint__traded"
                      />
                    )}
                    <text x={cx} y={base + 16} textAnchor="middle" className="coh-footprint__label">
                      {short(column.label)}
                    </text>
                  </g>
                );
              })}
              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-svg-note">
                ▬ share of the open interest, ─ share of what has traded
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
