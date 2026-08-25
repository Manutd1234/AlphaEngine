"use client";

/**
 * How far the best available basket fell short, on an axis that can show it.
 *
 * "Redo the basket subtab diagrams, why is it just a straight line."
 *
 * IT WAS LITERALLY A STRAIGHT LINE, and on the ordinary answer it had to be.
 * `MarginAxis` draws the programme's optimum against the smallest edge worth
 * taking, on a linear axis, with a mark. On a coherent family the optimum is
 * `-0.000000` and the threshold is `0.0001` — four decades apart, and on a
 * linear axis over that span, the same pixel. So the figure was an axis, a
 * threshold rule, and a mark sitting on it: one horizontal line, every time,
 * on the answer the exchange gives almost always.
 *
 * A LOG AXIS IS WHAT MAKES THE DISTANCE VISIBLE. Four decades is four ticks,
 * and the reading a reader wants — "the best guarantee available is nowhere
 * near tradable" — becomes a length rather than a coincidence of rounding. The
 * same figure shows an INCOHERENT family without changing shape: the optimum's
 * mark simply lands to the right of the threshold's, which is the verdict.
 *
 * FOUR ROWS, NOT ONE, which is the other half of "just a straight line". A
 * single mark on a rule is a scalar drawn as a picture of itself. The
 * quantities this section is about are a family of magnitudes — what the
 * programme found, what would be worth taking, what the venue can even express,
 * and what a state pays — and a reader who cannot see them together cannot see
 * that three of them are orders apart.
 *
 * `MarginAxis` STAYS on the Coherence test's verdict view, where it is read
 * beside the check ladder and answers a yes/no rather than a how-far; and
 * `coherence-thresholds.test.ts` pins its shape. This one fetches nothing
 * either: every figure below comes off the certificate the section has read.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import { MEANINGFUL_EDGE } from "@/lib/coherence/thresholds";
import { DOLLAR_CC, toCenticents } from "@/lib/coherence/fixed-point";

const HEIGHT = 186;
/**
 * Reserved rather than assumed, because this figure lives in a `.coh-figpair`.
 *
 * `MARGIN.left` was a constant 168 and the row labels are right-anchored inside
 * it — which held at the 720px default width and clipped every label at the
 * half-width column the pair actually gives it: "Best guarantee found" rendered
 * as "t guarantee found". A gutter is a measurement, so it is measured.
 */
const MARGIN = { top: 22, bottom: 34 };
const ROW_H = 30;
/** The hatched band for anything under a tick, and its gap to the scale. */
const UNDER_W = 34;
const UNDER_GAP = 10;

/**
 * The smallest magnitude the axis can place, in centicents.
 *
 * One centicent is the exchange's own tick, so nothing under it is a price that
 * could be quoted. A log axis has no zero to place, and pretending otherwise —
 * clamping a zero onto the first tick — would draw "nothing at all" and "the
 * smallest thing there is" at the same position. Anything below sits in a named
 * band off the left of the scale instead.
 */
const FLOOR_CC = 1;
/** The top of the scale: what one state pays. */
const CEILING_CC = DOLLAR_CC;

interface Row {
  label: string;
  /** Magnitude in centicents, or null when the certificate did not report one. */
  value: number | null;
  /** The figure as the wire wrote it, so nothing is re-rounded for display. */
  text: string;
  meaning: string;
  emphasis?: boolean;
}

/**
 * The one sentence under the figure, and there are four of them.
 *
 * Lifted out of the JSX because it was a four-deep ternary inside a prop, which
 * is where the zero case got lost: `decadesBetween` floors its input so the
 * logarithm has something to take, so an optimum of `-0.000000` came back as
 * "9.0 orders of magnitude below" — nine being log10(1 / 1e-9), a property of
 * the clamp and not of the family.
 */
function readingFor({ clears, nothingFound, shortfall, verdict }: {
  clears: boolean;
  nothingFound: boolean;
  shortfall: number | null;
  verdict: string;
}): string {
  if (clears) {
    return "The optimum clears the threshold, so this family admits no probability measure and the basket below is the trade.";
  }
  if (nothingFound) {
    return "The programme found no guarantee at all: the best portfolio available to it is worth exactly nothing, "
      + `against a threshold of ${MEANINGFUL_EDGE.toFixed(4)}.`;
  }
  if (shortfall == null) {
    return `The programme reported no optimum for this ${verdict} family, so the shortfall cannot be placed.`;
  }
  if (shortfall >= 1) {
    return `The best guarantee available is ${shortfall.toFixed(1)} orders of magnitude below the smallest edge that could be quoted at all.`;
  }
  return "The best guarantee available is under the smallest quotable edge, though within an order of magnitude of it.";
}

/** Decades between two magnitudes, for the reading under the figure. */
function decadesBetween(low: number, high: number): number {
  return Math.max(0, Math.log10(high / Math.max(low, 1e-9)));
}

export default function ShortfallScale({ margin, verdict, engine }: {
  /** The programme's own optimum, signed, as the gateway wrote it. */
  margin: string | null;
  verdict: string;
  engine: string;
}) {
  const optimum = toCenticents(margin);
  const threshold = Math.round(MEANINGFUL_EDGE * DOLLAR_CC);
  const magnitude = optimum == null ? null : Math.abs(optimum);
  const clears = magnitude != null && optimum != null && optimum > threshold;

  const rows: Row[] = [
    {
      label: "Best guarantee",
      value: magnitude,
      text: margin ?? "—",
      meaning: "what the programme's optimum pays in the worst state it can be held to",
      emphasis: true,
    },
    {
      label: "Worth taking above",
      value: threshold,
      text: MEANINGFUL_EDGE.toFixed(4),
      meaning: "below this the optimum is smaller than any price that could express it",
    },
    {
      label: "One tick here",
      value: FLOOR_CC,
      text: "0.0001",
      meaning: "the exchange's own smallest increment, and the floor of this scale",
    },
    {
      label: "One state pays",
      value: CEILING_CC,
      text: "1.0000",
      meaning: "a contract settles at a dollar, which is what any basket is measured against",
    },
  ];

  if (engine !== "highs" && optimum == null) {
    return (
      <Figure
        caption="How far the best available basket fell short, by order of magnitude"
        ariaLabel="The programme did not run, so there is no optimum to place"
      >
        <FigureEmpty reason={`The linear programme did not run on this family — the verdict came from ${engine}, which reports no optimum to measure.`} />
      </Figure>
    );
  }

  // ZERO IS NOT A MAGNITUDE, and reporting it as one printed a number that was
  // pure clamp. `decadesBetween` floors its input at 1e-9 so the logarithm has
  // something to take, and an optimum of `-0.000000` therefore came out as
  // "9.0 orders of magnitude below" — nine being log10(1 / 1e-9) and nothing to
  // do with the family. The programme found no guarantee at all here, which is
  // a different sentence, and the figure says that one.
  const nothingFound = magnitude != null && magnitude === 0;
  const shortfall = magnitude == null || nothingFound ? null : decadesBetween(magnitude, threshold);

  return (
    <Figure
      caption="How far the best available basket fell short, by order of magnitude"
      ariaLabel={
        "Four magnitudes on a logarithmic scale from one tick to a dollar: the optimum "
        + `the programme found (${margin ?? "unreported"}), the ${MEANINGFUL_EDGE.toFixed(4)} threshold, one tick, and a dollar`
      }
      reading={readingFor({ clears, nothingFound, shortfall, verdict })}
      missing={
        nothingFound
          ? "An optimum of nothing has no place on a logarithmic scale, so its mark sits in the band off the left rather than on the first tick — those are different readings and the tick is already taken."
          : magnitude != null && magnitude < FLOOR_CC
            ? "The optimum is smaller than one tick, so it sits in the band off the left of the scale rather than on it — a logarithmic axis has no zero to place it at."
            : null
      }
      notes={[
        "A linear axis over the same four quantities puts three of them on one pixel, which is what this "
        + "replaced: an optimum of -0.000000 and a threshold of 0.0001 are four decades apart and were "
        + "drawn touching.",
        "Every figure here is the certificate's own, unrounded. The scale is logarithmic; the numbers "
        + "beside each mark are not.",
      ]}
    >
      <Plot height={HEIGHT}>
        {(width: number) => {
          // MEASURED, NOT ASSUMED. This figure sits in a `.coh-figpair`, so its
          // measured width is about half what a full-width plot gets — and a
          // constant left margin clipped every row label there while looking
          // right at the default. The gutter is the longest label's own advance
          // plus the hatched band it has to clear.
          const gutter = Math.max(...rows.map((row) => advancePx(row.label, DIAGRAM_LABEL_PX)));
          // The right-hand gutter is measured too, and for the same reason the
          // left one is: "-0.000000" is nine glyphs of tabular figures, and a
          // constant 78 clipped its last character at this column's width.
          const values = Math.max(...rows.map((row) => advancePx(row.text, DIAGRAM_LABEL_PX))) + 14;
          const underX = gutter + 8;
          const x0 = underX + UNDER_W + UNDER_GAP;
          const x1 = width - values;
          const track = Math.max(40, x1 - x0);
          const decades = Math.log10(CEILING_CC / FLOOR_CC);
          const x = (cc: number) => x0 + (Math.log10(Math.max(cc, FLOOR_CC) / FLOOR_CC) / decades) * track;
          const ticks = [1, 10, 100, 1000, 10000];

          return (
            <>
              {/* The band for anything under one tick. Named, because a
                  logarithmic axis cannot place it and a mark clamped onto the
                  first tick would say "the smallest thing there is" about
                  something that is nothing at all. */}
              <rect x={underX} y={MARGIN.top} width={UNDER_W} height={rows.length * ROW_H} className="coh-decade__under" />
              {/* ABOVE the band, not under it. Under it the words sat on the
                  same baseline as the first decade tick and the two printed
                  over each other — "under a tick" and "0.0001" are eleven
                  pixels apart at that width. */}
              <text x={underX + UNDER_W / 2} y={MARGIN.top - 7} textAnchor="middle" className="coh-decade__tick">
                nil
              </text>

              {ticks.map((cc) => (
                <g key={cc}>
                  <line x1={x(cc)} x2={x(cc)} y1={MARGIN.top} y2={MARGIN.top + rows.length * ROW_H} className="coh-decade__rule" />
                  <text x={x(cc)} y={MARGIN.top + rows.length * ROW_H + 14} textAnchor="middle" className="coh-decade__tick">
                    {(cc / DOLLAR_CC).toFixed(4)}
                  </text>
                </g>
              ))}

              {rows.map((row, index) => {
                const y = MARGIN.top + index * ROW_H + ROW_H / 2;
                const under = row.value != null && row.value < FLOOR_CC;
                const at = row.value == null ? null : under ? underX + UNDER_W / 2 : x(row.value);
                return (
                  <g key={row.label}>
                    <text x={gutter} y={y + 4} textAnchor="end" className="coh-decade__label">
                      {row.label}
                    </text>
                    {at == null ? (
                      <text x={x0} y={y + 4} className="coh-decade__withheld">
                        not reported
                      </text>
                    ) : (
                      <>
                        {/* NO STEM FOR A MARK IN THE NIL BAND. The stem runs
                            from the scale's origin to the mark, and a mark that
                            is not on the scale would draw it backwards — a
                            short segment pointing away from the dot, which
                            reads as a second mark. */}
                        {under ? null : (
                          <line x1={x0} x2={at} y1={y} y2={y} className={`coh-decade__stem${row.emphasis ? " is-subject" : ""}`} />
                        )}
                        <circle
                          cx={at} cy={y} r={row.emphasis ? 5 : 3.5}
                          className={`coh-decade__dot${row.emphasis ? " is-subject" : ""}${clears && row.emphasis ? " is-clearing" : ""}`}
                        >
                          <title>{`${row.label}: ${row.text} — ${row.meaning}`}</title>
                        </circle>
                      </>
                    )}
                    <text x={x1 + 12} y={y + 4} className="coh-decade__value">
                      {row.text}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
