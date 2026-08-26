"use client";

/**
 * Where a family's quotes SIT, as a distribution rather than as a list.
 *
 * THIS REPLACES `LegStrip`, AND THE REASON IS THE FIFTH REVIEW OF 2026-08-24:
 * "for the families tab, can we output as a vertical bar chart and x axis as
 * value of the money so we can see the distribution instead of scrolling
 * forever to see the other output." `LegStrip` handed every market to
 * `ValueStrip`, which draws one 22px SVG row each. The largest watched family
 * carries 188 markets, so that figure was 8 + 188 x 22 + 8 = 4,152px of plot —
 * and because nearly every leg of a crypto ladder is one-sided, 152 of those
 * rows printed the SAME sentence ("no resting bids on this side; the spread is
 * unknowable, not zero") beside a bar that was not there. One true sentence,
 * repeated until it read as noise.
 *
 * A row per outcome answers "what does leg 47 cost", which nobody asks of a
 * 188-leg ladder. What a reader wants off a family with no basket total is the
 * SHAPE: are these quotes pennies in the tails, or is real money spread across
 * the strikes. That is a histogram — price on x, count of outcomes on y — and
 * it does not grow with the family.
 *
 * THE UNQUOTED OUTCOMES ARE NOT ON THIS AXIS, and that is the whole honesty
 * argument. An outcome nobody offers has no price; drawing it in the leftmost
 * bucket would put it at zero, and zero is a LEGAL Kalshi price. So they are
 * counted out of the drawing and named once, in the footnote, in the gateway's
 * own words — `unquoted_reason` is server data (`views.py`), one distinct
 * sentence per distinct absence, and this is the one place the tab prints it.
 *
 * REJECTED: a log y axis. The measured shape of the default family is a spike
 * — most quoted legs of a crypto ladder are a cent — and a log axis flattens
 * exactly the fact the figure exists to show. The spike IS the reading.
 *
 * REJECTED: bucketing to each market's own `price_grid`. Two families on one
 * watchlist can be on different grids, and a figure whose bucket width changed
 * per family would make two families incomparable while looking identical.
 */

import { DOLLAR_CC, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceMarketView } from "@/lib/coherence/types";
import Figure, { FigureEmpty, Plot } from "./Figure";

/**
 * FIVE-CENT BUCKETS, so twenty columns over $0.00–$1.00.
 *
 * Kalshi's finest quote here is a cent, so a column per price is 100 columns.
 * The widest track this figure ever draws in is a full-width card — call the
 * plot 700px, less the 30px gutter and 10px of right inset, 660px — which is
 * 6.6px a column: narrower than a hover target and far narrower than two
 * columns a reader could compare. At 5c the same track gives 660 / 20 = 33px a
 * column, and the axis can label every fourth boundary in whole ten-cent steps.
 */
const BUCKET_CC = 500;
const BUCKETS = DOLLAR_CC / BUCKET_CC;

/**
 * The frame, derived — nothing in this suite has ever seen a pixel (CLAUDE.md,
 * fact 6).
 *
 * TOP 16: the y axis's own name sits above the plot on a 10px rung, so its
 * baseline is at 10 and its ascender reaches 10 - 7.4 = 2.6, inside the box.
 * BODY 132: one outcome standing against the tallest column has to read as
 * something rather than nothing. A 188-outcome family whose busiest bucket
 * holds ~50 needs 1/50 of the body to clear 2px, so the body must be at least
 * 100; 132 is the height of `.donut__ring`, so this figure and the Baskets
 * composition stand the same height when a reader moves between the views.
 * BOTTOM 22: one line of axis numerals, baseline 8px under the rule, plus the
 * 10px rung and 4px so a "$" descender never touches the caption below.
 * GUTTER 30: the count numerals run to three digits (188 is the largest family
 * on this watchlist); at the --fs-tick rung's 10px and this face's ~0.6 advance
 * that is 3 x 6 = 18px, plus 6px clear of the axis rule and 6px of inset.
 */
const TOP = 16;
const BODY = 132;
const BOTTOM = 22;
const HEIGHT = TOP + BODY + BOTTOM;
const GUTTER = 30;
const RIGHT = 10;
/** Every fourth boundary is labelled: 0, 4, 8, 12, 16, 20 — six in ten-cent
 *  steps. Each is five characters, ~30px at the tick rung, so the six spend
 *  180px of ink over a track that is never under 120px + 20 columns; the ends
 *  are anchored inward so neither overhangs the frame. */
const LABEL_EVERY = 4;

/** A band boundary in cents — every one here is a whole number of them, so
 *  the division is exact and the label matches how BasketSize names the same
 *  bands ("5c to 10c"). Until 2026-08-26 this was a `$0.05` built by hand,
 *  the one `$` template on the engine that was not the reader's own slider. */
const cents = (cc: number): string => `${cc / 100}c`;

export interface PriceHistogramProps {
  markets: CoherenceMarketView[];
  caption: string;
}

export default function PriceHistogram({ markets, caption }: PriceHistogramProps) {
  const counts = new Array<number>(BUCKETS).fill(0);
  let quoted = 0;
  const reasons: string[] = [];
  for (const market of markets) {
    const ask = toCenticents(market.yes_ask);
    if (ask == null) {
      const reason = market.unquoted_reason ?? "no ask is quoted on this outcome";
      if (!reasons.includes(reason)) reasons.push(reason);
      continue;
    }
    // Clamped rather than dropped: a quote above the dollar is a real quote and
    // belongs in the top bucket, not off the figure.
    counts[Math.min(BUCKETS - 1, Math.max(0, Math.floor(ask / BUCKET_CC)))] += 1;
    quoted += 1;
  }

  const absent = markets.length - quoted;
  const missing = absent
    ? `${absent} of ${markets.length} outcomes carry no ask, so they are counted off this axis rather than `
      + `drawn at zero — zero is a legal Kalshi price. Why they are absent: ${reasons.join("; ")}.`
    : null;

  if (!quoted) {
    return (
      <Figure
        caption={caption}
        missing={missing}
        ariaLabel="No outcome of this family carries an ask, so no price distribution can be drawn"
      >
        <FigureEmpty reason="No outcome of this family carries an ask: an axis drawn over nothing would read as a family quoted at nothing." />
      </Figure>
    );
  }

  const max = Math.max(...counts);
  const peak = counts.indexOf(max);
  // A tie is SAID rather than resolved by taking the leftmost silently: two
  // bands of equal height is a different shape from one mode, and naming only
  // the first would be the figure choosing a reading the drawing does not make.
  const tied = counts.filter((count) => count === max).length;
  const reading = `${quoted} of ${markets.length} outcomes carry an ask, and the busiest five-cent band holds `
    + `${max} of them, from ${cents(peak * BUCKET_CC)} to ${cents((peak + 1) * BUCKET_CC)}`
    + `${tied > 1 ? `, one of ${tied} bands that tall` : ""}.`;
  const ariaLabel = counts
    .map((count, index) => `${cents(index * BUCKET_CC)} to ${cents((index + 1) * BUCKET_CC)}: ${count}`)
    .join(". ");

  return (
    <Figure caption={caption} reading={reading} missing={missing} ariaLabel={ariaLabel}>
      <Plot height={HEIGHT}>
        {(width) => {
          const plotW = Math.max(120, width - GUTTER - RIGHT);
          const colW = plotW / BUCKETS;
          const base = TOP + BODY;
          const yOf = (count: number) => base - (count / max) * BODY;
          return (
            <>
              {/* The ceiling rule first, so a column reads as a share of a
                  stated maximum rather than as a length on its own. */}
              <line x1={GUTTER} x2={GUTTER + plotW} y1={TOP} y2={TOP} stroke="var(--border)" strokeDasharray="3 3" />
              <text x={GUTTER - 6} y={TOP + 3} textAnchor="end" className="coh-axis__label">{max}</text>
              <text x={GUTTER - 6} y={base + 3} textAnchor="end" className="coh-axis__label">0</text>
              <text x={0} y={TOP - 6} className="coh-axis__label">outcomes</text>

              {counts.map((count, index) => {
                if (!count) return null;
                const top = yOf(count);
                const lo = cents(index * BUCKET_CC);
                const hi = cents((index + 1) * BUCKET_CC);
                return (
                  <rect
                    key={lo}
                    x={GUTTER + index * colW + 0.5}
                    y={top}
                    width={Math.max(1, colW - 1)}
                    // Floored at a hairline so a single outcome under a tall
                    // mode is visible as one rather than as none.
                    height={Math.max(1, base - top)}
                    className="coh-ablation__bar"
                  >
                    <title>{`${count} ${count === 1 ? "outcome" : "outcomes"} quoted from ${lo} up to ${hi}`}</title>
                  </rect>
                );
              })}

              <line x1={GUTTER} x2={GUTTER + plotW} y1={base} y2={base} stroke="var(--border)" />
              {Array.from({ length: BUCKETS / LABEL_EVERY + 1 }, (_, step) => {
                const index = step * LABEL_EVERY;
                const x = GUTTER + index * colW;
                return (
                  <text
                    key={index}
                    x={x}
                    y={base + 14}
                    textAnchor={index === 0 ? "start" : index === BUCKETS ? "end" : "middle"}
                    className="coh-axis__label"
                  >
                    {cents(index * BUCKET_CC)}
                  </text>
                );
              })}
              <text x={GUTTER + plotW} y={TOP - 6} textAnchor="end" className="coh-axis__label">
                YES ask
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
