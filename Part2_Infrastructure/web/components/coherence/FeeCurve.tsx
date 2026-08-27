"use client";

/**
 * What a position ACTUALLY costs at every price — measured, not modelled.
 *
 * `FeeParabola` draws `rate × C × p × (1 − p)`: the trade fee, smooth, peaking
 * at fifty cents. That curve is the tab's thesis and it stays. What it cannot
 * show is the thing this whole section exists to report — that on Kalshi's own
 * worked example the ROUNDING component is nineteen times the trading one, and
 * rounding is a step function, not a parabola. A reader met the smooth curve,
 * met the sentence, and had no way to see the two together.
 *
 * So this draws the net fee the gateway actually computes at every price the
 * venue quotes, with the trade fee under it. The gap between them is the
 * rounding, and its staircase is visible rather than asserted.
 *
 * COMPUTED ON THE GATEWAY, WHICH IS THE POINT. `FeeParabola` evaluates the
 * trade-fee formula in TypeScript, and that is defensible for one closed-form
 * curve. The full three-component fee is not closed form — it depends on the
 * fill count, the balance precision and an accumulator that partly gives the
 * rounding back — and writing it here would be a THIRD implementation of
 * arithmetic this codebase keeps in Python as its reference, held to parity by
 * fixture. `/api/coherence/fees/curve` runs the same kernel the worked example
 * runs, ninety-nine times, in one read with no venue call.
 *
 * THE FILL COUNT IS IN THE CAPTION, because it is the parameter nobody models
 * and the one that moves this figure most: the same size in one fill and in
 * twenty costs materially different amounts, and a curve that did not say which
 * it was drawn at would be a fact about an unstated position.
 */

import { linePath, linearScale, ticks } from "@/components/chart-kit";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import type { CoherenceFeeCurve } from "@/lib/coherence/types-history";
import { toUnit } from "@/lib/coherence/decimals";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 200;

/**
 * The points the curve can actually draw: those whose price, net and trade fee
 * all parse. Exported because the modelled parabola beside it is sampled at
 * exactly these prices — that is what makes one index name one price on both
 * figures, which is the condition `linked-x` puts on sharing a key. Derived
 * once, here, so the two cannot drift apart.
 */
export function drawableFeePoints(curve: CoherenceFeeCurve | null) {
  if (!curve || curve.state !== "ok") return [];
  return curve.points.flatMap((point) => {
    const p = toUnit(point.price);
    const n = toUnit(point.net);
    const t = toUnit(point.trade_fee);
    return p === null || n === null || t === null ? [] : [{ point, p, n, t }];
  });
}
const MARGIN = { top: 16, right: 16, bottom: 34, left: 46 };

export default function FeeCurve({ curve, error }: {
  curve: CoherenceFeeCurve | null;
  error: string | null;
}) {
  const caption = "What the position costs at every price the venue quotes";
  const aria = "Net fee and trade fee against contract price";

  if (error && !curve) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason={`The curve could not be read: ${error}. That is a gateway failure, not an answer about the fee.`} />
      </Figure>
    );
  }
  if (!curve) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason="Pricing the fee at every price…" />
      </Figure>
    );
  }
  if (curve.state !== "ok" || curve.points.length < 2) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty
          reason={curve.notes[0] ?? "The gateway returned no curve, so there is nothing to draw against price."}
        />
      </Figure>
    );
  }

  const points = curve.points;
  /* A point is drawn only when all three of its wire strings parse. Before
     2026-08-26 a null here became 0 — a price at zero, a fee at zero — and the
     line ran through a value the wire never carried. Withheld points are
     counted in `missing` instead, and a curve with fewer than two draws its
     empty branch. */
  const drawable = drawableFeePoints(curve);
  const withheld = points.length - drawable.length;
  if (drawable.length < 2) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason={`${withheld} of ${points.length} points carried no readable price, net or trade fee, and a line needs two.`} />
      </Figure>
    );
  }
  const price = drawable.map((d) => d.p);
  const net = drawable.map((d) => d.n);
  const trade = drawable.map((d) => d.t);
  const peak = Math.max(...net, ...trade);
  /* The right-hand gutter the tallest tick numeral needs. Hoisted out of the
     two layout passes (the crosshair's and the drawing's) so the axis is
     measured once from one string rather than each pass re-deriving it. */
  const tickGutter = advancePx(peak.toFixed(4), DIAGRAM_LABEL_PX) + 4;
  /* Where the two lines are furthest apart, which is the reading this figure
     adds — and the gap is NOT the rounding fee, which is the mistake the first
     version of this sentence made. `net` is `max(0, trade + rounding − rebate)`,
     so the distance between the curves is what rounding adds AFTER the
     accumulator has given part of it back. Quoting `rounding_fee` beside a
     price chosen by the gap put two different quantities in one sentence and
     they disagreed: the widest gap is at 0.2100 and the largest raw rounding at
     0.3200. The gap is what the figure draws, so the gap is what it reports. */
  let widest = 0;
  let widestAt = drawable[0].point;
  drawable.forEach(({ point, n, t }) => {
    const gap = n - t;
    if (gap > widest) { widest = gap; widestAt = point; }
  });

  return (
    <Figure
      caption={`${caption} — ${curve.contracts} contracts in ${curve.fills} ${curve.fills === 1 ? "fill" : "fills"}`}
      ariaLabel={aria}
      reading={
        widest > 0
          ? `The gap between the two lines is what rounding adds after the rebate returns part of it. It is `
            + `widest at ${widestAt.price}, where it takes a trade fee of ${widestAt.trade_fee} to a net `
            + `${widestAt.net} — and it is a sawtooth rather than a curve, because rounding is a step and the `
            + "trade fee is not."
          : "At this size and fill count the rounding adds nothing: the two lines coincide, and the fee is the "
            + "trade fee alone."
      }
      missing={`Drawn at the taker rate ${curve.multiplier} and a balance precision of ${curve.balance_precision}; `
        + "a resting order pays the maker rate and is not on this figure."
        + (withheld > 0 ? ` ${withheld} of ${points.length} points carried no readable price, net or trade fee and are not drawn.` : "")}
      notes={[
        "Computed by the gateway's own fee kernel — the same one the worked example above runs — rather than "
        + "from a formula in the browser. The three-component fee is not closed form: it depends on the fill "
        + "count and on an accumulator that partly returns the rounding.",
        "Both ends are excluded because a contract at zero or at a dollar is settled rather than quoted, so a "
        + "fee there would describe a trade nobody can make.",
      ]}
    >
      <Plot
        height={HEIGHT}
        /* A CROSSHAIR at the venue's own prices. The two titles this replaced
           named the LINES — the trade fee's closed form, the kernel's net —
           and the question the figure is built to answer is what BOTH cost at
           one price, which is a fact about a position. `positions` because the
           gateway prices its own grid: the points are where it computed, not
           an even sweep, and a cursor stepped evenly would name a price the
           kernel never quoted. Both numbers are printed from the wire strings
           they arrived as, never re-derived through a float. */
        sharedX={(width) => {
          const right = width - MARGIN.right - tickGutter;
          const x = linearScale(0, 1, MARGIN.left, Math.max(MARGIN.left + 1, right));
          return {
            count: drawable.length,
            x0: MARGIN.left,
            x1: Math.max(MARGIN.left + 1, right),
            positions: price.map((p) => x(p)),
            read: (index) => {
              const { point, n, t } = drawable[index];
              return {
                title: point.price,
                rows: [
                  { label: "Trade fee", value: point.trade_fee, raw: t },
                  { label: "Net fee, rounding included", value: point.net, raw: n },
                ],
              };
            },
            width: 280,
            arriveAt: "first",
            // The modelled parabola is drawn at these same prices, so walking
            // one walks the other: at a position a reader sees what the fee
            // kernel charges and what the closed form says it should.
            link: "fee-price",
          };
        }}
      >
        {(width) => {
          const right = width - MARGIN.right - tickGutter;
          const x = linearScale(0, 1, MARGIN.left, Math.max(MARGIN.left + 1, right));
          const y = linearScale(0, peak || 1, HEIGHT - MARGIN.bottom, MARGIN.top);

          return (
            <g>
              {ticks(0, peak || 1, 4).map((value) => (
                <g key={value}>
                  <line className="coh-tape__grid" x1={MARGIN.left} x2={Math.max(MARGIN.left + 1, right)} y1={y(value)} y2={y(value)} />
                  <text className="coh-tape__tick" x={MARGIN.left - 6} y={y(value) + 4} textAnchor="end">
                    {value.toFixed(4)}
                  </text>
                </g>
              ))}
              {[0, 0.25, 0.5, 0.75, 1].map((value) => (
                <text key={value} className="coh-tape__tick" x={x(value)} y={HEIGHT - 20} textAnchor="middle">
                  {value.toFixed(2)}
                </text>
              ))}

              {/* The trade fee under, the net over: the reader is being asked
                  to judge the GAP, so the smaller curve is drawn first and the
                  one that includes it sits on top. */}
              {/* Untitled: both names are the crosshair's row labels now, read
                  beside the numbers they belong to rather than as a tooltip on
                  a line a reader has to hit. */}
              <path
                className="coh-fee-curve__trade"
                d={linePath(price.map((p, i) => ({ x: x(p), y: y(trade[i]) })))}
              />
              <path
                className="coh-fee-curve__net"
                d={linePath(price.map((p, i) => ({ x: x(p), y: y(net[i]) })))}
              />

              <text className="coh-tape__tick" x={(MARGIN.left + right) / 2} y={HEIGHT - 5} textAnchor="middle">
                contract price
              </text>
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
