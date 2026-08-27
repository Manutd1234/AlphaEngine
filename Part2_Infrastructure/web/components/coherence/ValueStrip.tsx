"use client";

/**
 * One row of labelled bars — the drawing a table-only view was missing.
 *
 * The 2026-08-24 desk review asked for "an interactive diagram and visual
 * representation of the numbers" on every subtab. Several views on this tab
 * opened on a bare table: the verdict's arithmetic, the replay per
 * configuration, the score's headline figures, the per-band deviations. Each
 * of those tables has ONE decisive column, and this component draws that
 * column as labelled bars against a zero rule so the comparison the table
 * asks for is answered by looking. The table stays; the strip is its reading.
 *
 * One component for all of them rather than a drawing per view, because the
 * tab's figures share a grammar (`Figure`) and its readers should not relearn
 * the furniture per section — and because every mark here reuses classes 10b
 * and 10f already declare (`coh-ablation__bar`, `coh-calib__zero`,
 * `coh-calib__perfect`), so no new CSS and no dead-css delta.
 *
 * Three ways this strip refuses to lie:
 *
 * **A row may decline its bar, with a reason.** A count of markets and a time
 * in seconds are not lengths on the same axis as a score; a null is not a
 * zero. `noBar` prints the figure and the reason instead of a length, so a
 * mixed table keeps all its rows without drawing a comparison that does not
 * exist.
 *
 * **A sub-pixel bar is floored and SAID.** The MurphyBars precedent: a value
 * orders of magnitude under its neighbour draws at a hairline and the
 * footnote names it, so nobody reads the floor as the measurement.
 *
 * **Labels ellipsise at the END, full string in the hover.** The Baskets
 * review caught a mid-word cut ("Highest temperature i…ity"); the budget here
 * derives from the 12px diagram-label rung (14r) and a slice keeps the head
 * of the string, with the whole of it in the row's <title>.
 *
 * REJECTED: scaling each row to its own maximum. Every bar comes out
 * full-length, which is a legend, not a measurement — the strip exists for
 * the comparison DOWN the rows, so one shared domain or no bar at all.
 */

import { DIAGRAM_LABEL_PX, advancePx, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import Figure, { Plot } from "./Figure";

const ROW = 22;
const PAD = { top: 8, bottom: 8, right: 64 };
const BAR_H = 12;
const GUTTER_MIN = 72;
const GUTTER_MAX = 300;
/** Under this many pixels a bar is drawn at a hairline and named below. */
const FLOOR_PX = 1;

export interface StripRow {
  label: string;
  /** Geometry only; every printed figure is `text`, cut from the wire. */
  value: number | null;
  text: string;
  /** The row's hover line — the interactive floor every mark carries. */
  title: string;
  /** When set, the row prints its figure but draws no bar, for this reason. */
  noBar?: string;
}

export default function ValueStrip({
  caption,
  ariaLabel,
  reading,
  missing,
  notes,
  rows,
  mark,
  anchorOnMark = false,
}: {
  caption: string;
  ariaLabel: string;
  reading?: string | null;
  missing?: string | null;
  /**
   * Passed through to `Figure`, which folds it and counts it in the summary.
   *
   * A strip's own floor note is appended to `missing` below and stays visible,
   * because it is a statement about the LENGTHS a reader is looking at — a
   * hairline bar that nobody is told is a hairline is the one way this figure
   * can mislead. Everything a caller sends here is a caveat about the data
   * instead, and those fold.
   */
  notes?: readonly string[] | null;
  rows: StripRow[];
  /** An optional dashed reference rule with its own meaning, e.g. 1. */
  mark?: { at: number; label: string };
  /**
   * Measure each bar FROM the mark rather than from zero.
   *
   * Zero is the right anchor when zero is the meaningful value — a signed edge,
   * a deviation, money. It is the wrong one when the reading is distance from
   * something else, and the Corpus slope strip is the case that exposed it: its
   * own docstring says "the rule at one is the whole reading… the distance from
   * the rule is what the eye takes", and with slopes clustered near 1 against a
   * domain running from 0, every bar filled 85 to 100 per cent of the track and
   * the eye took distance from ZERO. The figure could not show the thing it was
   * built to show.
   *
   * With this set the domain is centred on the mark and a bar runs from the
   * rule to its value, so a slope of 1.03 is a short bar to the right and 0.97
   * a short bar to the left — which is the comparison the caption promises.
   */
  anchorOnMark?: boolean;
}) {
  const drawable = rows.filter((row) => row.value != null && !row.noBar);
  const values = drawable.map((row) => row.value as number);
  // The anchor is the mark when the caller says so, zero otherwise. A domain
  // padded symmetrically about the anchor is what makes equal distances either
  // side of it read as equal lengths.
  const anchor = anchorOnMark && mark ? mark.at : 0;
  const reach = Math.max(...values.map((v) => Math.abs(v - anchor)), 0);
  const lo = anchorOnMark && mark ? anchor - reach : Math.min(0, mark?.at ?? 0, ...values);
  const hi = anchorOnMark && mark ? anchor + reach : Math.max(0, mark?.at ?? 0, ...values);
  const span = hi - lo || 1;
  const height = PAD.top + rows.length * ROW + PAD.bottom;

  const floored = drawable
    .filter((row) => {
      const share = Math.abs(row.value as number) / span;
      return (row.value as number) !== 0 && share < 0.002;
    })
    .map((row) => row.label);
  const floorNote = floored.length
    ? `${floored.join(", ")} drawn at a hairline against this scale — read the number, not the length.`
    : null;
  const note = [missing, floorNote].filter(Boolean).join(" ") || null;

  return (
    <Figure caption={caption} ariaLabel={ariaLabel} reading={reading} missing={note} notes={notes}>
      <Plot height={height}>
        {(width) => {
          // The per-glyph advance moved to `lib/coherence/label-metrics.ts` on
          // 2026-08-25. It was 7.28px here — 13px times a 0.56 em ratio — and
          // 0.56 is what MIXED-CASE prose measures; this strip also carries
          // uppercase tickers and tabular amounts, which set 23% wider, so the
          // labels that overran were exactly the ones a reader most needed
          // whole. The shared module classifies the string instead of making
          // one ratio serve three.
          const gutter = gutterFor(rows.map((row) => row.label), width, DIAGRAM_LABEL_PX, {
            min: GUTTER_MIN, max: GUTTER_MAX, maxFraction: 0.38, clearance: 14,
          });
          // `gutter` is already `Math.round(widest + clearance)` from
          // `gutterFor` — it rounds UP the space a label needs, so budgeting
          // `gutter - 14` here re-subtracts the same 14px clearance a second
          // time and floors one glyph off a label that measures its own
          // gutter exactly. Measured: an 18-glyph ticker label rounds to a
          // gutter of 175, budgets to 161, and `glyphsWithin` floors 161px to
          // 17 glyphs — eliding a label with 14px of real room to spare. One
          // pixel less of the double-subtraction (13, not 14) is real slack,
          // not slack borrowed from the track: the label still ends 8px
          // before it (`x={gutter - 8}` below).
          const short = (text: string) => truncateMiddle(text, gutter - 13, DIAGRAM_LABEL_PX);
          const plotW = Math.max(80, width - gutter - PAD.right);
          const x = (value: number) => gutter + ((value - lo) / span) * plotW;
          const zero = x(anchor);

          return (
            <>
              {rows.map((row, index) => {
                const y = PAD.top + index * ROW;
                const cy = y + BAR_H / 2;
                const v = row.value;
                const barless = v == null || row.noBar;
                const w = barless ? 0 : Math.max(FLOOR_PX, Math.abs(x(v as number) - zero));
                const bx = barless || (v as number) >= 0 ? zero : zero - w;
                // The figure prints on the bar's own side, and the clamp is on
                // the text's FAR edge rather than its anchor.
                //
                // It used to clamp the start: `Math.min(width - 4, …)` put the
                // first glyph inside the plot and let the rest run out of the
                // viewBox, because start-anchored text extends rightward from
                // the point being clamped. A bar reaching the end of the track
                // then printed its value past the card — reported on Fees →
                // Worked example, where "0.010097" is about 68px against the
                // 64px `PAD.right` reserves. The mirror image applies to a
                // negative bar, whose end-anchored value extends LEFT and could
                // cross into the label gutter.
                const valueText = row.noBar ? `${row.text} — ${row.noBar}` : row.text;
                const valueW = advancePx(valueText, DIAGRAM_LABEL_PX);
                const negative = !barless && (v as number) < 0;
                const wanted = barless ? zero + 6 : negative ? bx - 5 : bx + w + 5;
                const tx = negative
                  ? Math.max(gutter + 2 + valueW, Math.min(wanted, width - 4))
                  : Math.max(gutter + 2, Math.min(wanted, width - 4 - valueW));
                const anchor = negative ? "end" : "start";
                return (
                  <g key={`${index}-${row.label}`}>
                    <title>{row.title}</title>
                    <text x={gutter - 8} y={cy + 3.5} textAnchor="end" className="coh-ablation__label">
                      {short(row.label)}
                    </text>
                    {barless ? null : (
                      <rect x={bx} y={y} width={w} height={BAR_H} className="coh-ablation__bar" />
                    )}
                    <text x={tx} y={cy + 3.5} textAnchor={anchor} className="coh-ablation__value">
                      {valueText}
                    </text>
                  </g>
                );
              })}

              {/* References over the data, never under it — the house rule
                  every figure on this tab follows. */}
              {mark ? (
                <>
                  <line
                    x1={x(mark.at)}
                    x2={x(mark.at)}
                    y1={PAD.top - 4}
                    y2={height - PAD.bottom + 2}
                    className="coh-calib__perfect"
                  />
                  <text x={x(mark.at) + 4} y={PAD.top + 4} className="coh-ablation__label">
                    {mark.label}
                  </text>
                </>
              ) : null}
              <line
                x1={zero}
                x2={zero}
                y1={PAD.top - 4}
                y2={height - PAD.bottom + 2}
                className="coh-calib__zero"
              />
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
