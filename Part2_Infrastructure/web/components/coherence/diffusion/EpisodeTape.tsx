"use client";

/**
 * How close the quotes have come to a violation, and that they have not crossed.
 *
 * THE TWO EPISODE VIEWS USED TO DRAW THE SAME THING. On a deployment whose tape
 * holds nothing closed — which is this one, and most — both Survival and
 * Episodes fell through to the same watch figure, so the switcher offered two
 * buttons for one drawing. Two views that answer one question is a broken
 * control, and the answer was not to hide one of them: it was to give the
 * second view the question it was always for.
 *
 * SURVIVAL asks how long a violation LASTS once it exists. This asks whether
 * one is anywhere near existing, off the coherence index the recorder writes on
 * every poll — 199 measured readings across two families on the tape today, one
 * per family per observation. It is the precursor the episode ledger is
 * downstream of, and it is live where the episode ledger is empty.
 *
 * WHAT AN INDEX READING IS NOT. `ci` is the distance from a set of quotes that
 * admits a probability; it is not an episode and a positive reading is not a
 * trade. An episode is opened only when that failure is also CERTIFIED and
 * worth doing after fees, which is a stricter test than "the index moved" — so
 * this figure says how close the book has come and stops there rather than
 * implying the difference is timing.
 */

import Figure, { FigureEmpty, Plot, StateChip } from "../Figure";
import type { CoherenceIndexPoint } from "@/lib/coherence/types";

const HEIGHT = 260;
// `top` carries two stacked legend rows above the plot, each on the 14px
// legend rung, so it is their height rather than a round number.
const MARGIN = { top: 44, right: 20, bottom: 30, left: 46 };

/** The reading, as a number, or null where the poll could not measure one. */
function value(point: CoherenceIndexPoint): number | null {
  if (point.ci == null) return null;
  const parsed = Number(point.ci);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function EpisodeTape({ points, series }: {
  points: CoherenceIndexPoint[];
  series: string[];
}) {
  const measured = points.filter((point) => value(point) != null);
  const unmeasured = points.length - measured.length;
  const peak = measured.reduce<{ ci: number; point: CoherenceIndexPoint } | null>((best, point) => {
    const ci = value(point) as number;
    return best == null || ci > best.ci ? { ci, point } : best;
  }, null);

  const families = series.length ? series : [...new Set(points.map((p) => p.series_ticker))];

  return (
    <>
      <div className="coh-status__chips">
        <StateChip mark="●" word="Index readings" value={String(points.length)} tone="muted" />
        <StateChip mark="→" word="Families" value={families.join(", ") || "—"} tone="muted" />
        <StateChip
          mark={peak ? "▲" : "◌"}
          word="Furthest from coherent"
          value={peak ? peak.ci.toFixed(4) : "—"}
          tone="muted"
        />
        <StateChip
          mark={unmeasured ? "◌" : "✓"}
          word="Unmeasurable polls"
          value={String(unmeasured)}
          tone="muted"
        />
      </div>

      <Figure
        caption="How far the quotes have sat from admitting a probability, poll by poll"
        ariaLabel={
          measured.length
            ? `Coherence index over ${measured.length} measured readings across ${families.length} families,`
              + ` peaking at ${peak?.ci.toFixed(4)}`
            : "No index reading has been measured yet"
        }
        reading={
          peak
            ? `The furthest these books have sat from coherent is ${peak.ci.toFixed(4)}, on ${peak.point.series_ticker}.`
              + " An episode is opened only when a failure is also certified worth taking after fees, which is a"
              + " stricter test than a reading above zero — so this is how close the tape has come, not a count of misses."
            : null
        }
        missing={
          unmeasured
            ? `${unmeasured} poll${unmeasured === 1 ? "" : "s"} could not be measured at all and ${unmeasured === 1 ? "is" : "are"} drawn as a gap rather than as zero: no reading is not a reading of nought.`
            : null
        }
      >
        {measured.length >= 2 ? (
          <Plot height={HEIGHT}>
            {(width) => {
              const x0 = MARGIN.left;
              const x1 = Math.max(x0 + 60, width - MARGIN.right);
              const base = HEIGHT - MARGIN.bottom;
              const top = MARGIN.top;
              const hi = Math.max(peak?.ci ?? 0, 0.0001);
              const stamps = points.map((p) => Number(p.ts_ns));
              const lo = Math.min(...stamps);
              const span = Math.max(1, Math.max(...stamps) - lo);
              const x = (ts: number) => x0 + ((ts - lo) / span) * (x1 - x0);
              const y = (ci: number) => base - (ci / hi) * (base - top);

              return (
                <>
                  <line className="coh-ladder__axis" x1={x0} x2={x1} y1={base} y2={base} />
                  <text className="coh-ladder__tick" x={x0 - 6} y={base + 4} textAnchor="end">0</text>
                  <text className="coh-ladder__tick" x={x0 - 6} y={top + 4} textAnchor="end">{hi.toFixed(3)}</text>
                  <text className="coh-svg-note" x={x0} y={top - 10}>distance from coherent</text>

                  {families.map((family, index) => {
                    // Broken at gaps rather than bridged: a poll that could not
                    // be measured is a hole in the record, and a line drawn
                    // across it asserts a reading nobody took.
                    let d = "";
                    let open = false;
                    for (const point of points) {
                      if (point.series_ticker !== family) continue;
                      const ci = value(point);
                      if (ci == null) { open = false; continue; }
                      d += `${open ? "L" : "M"}${x(Number(point.ts_ns)).toFixed(1)},${y(ci).toFixed(1)}`;
                      open = true;
                    }
                    return (
                      <path
                        key={family}
                        className={index === 0 ? "diff-curve__release" : "diff-curve__call"}
                        d={d}
                        fill="none"
                      >
                        <title>{`${family}: the coherence index on every poll of this family`}</title>
                      </path>
                    );
                  })}

                  {peak ? (
                    <g>
                      <circle className="coh-model__point" cx={x(Number(peak.point.ts_ns))} cy={y(peak.ci)} r={3.5}>
                        <title>
                          {`Furthest from coherent: ${peak.ci.toFixed(4)} on ${peak.point.series_ticker}`
                            + `${peak.point.detail ? ` — ${peak.point.detail}` : ""}`}
                        </title>
                      </circle>
                      <text className="coh-ladder__tick" x={x(Number(peak.point.ts_ns))} y={y(peak.ci) - 8} textAnchor="middle">
                        {peak.ci.toFixed(3)}
                      </text>
                    </g>
                  ) : null}

                  {/* Right-aligned: the axis note and the top tick both live at
                      the left, and a legend stacked under them read as a third
                      label on the same corner. */}
                  {families.map((family, index) => (
                    <text
                      key={family}
                      className={index === 0 ? "diff-curve__key diff-curve__key--release" : "diff-curve__key diff-curve__key--call"}
                      x={x1}
                      // 17, not 14: a 14px key's box is 17px tall, and at 14 the two
                      // family lines printed through each other by under a pixel at
                      // every desk width — found by the 2026-08-26 sweep, invisible by
                      // eye, real to a reader who cannot separate two hues.
                      y={top - 13 + index * 17}
                      textAnchor="end"
                    >
                      <tspan aria-hidden="true">{index === 0 ? "●" : "▲"}</tspan> {family}
                    </text>
                  ))}
                </>
              );
            }}
          </Plot>
        ) : (
          <FigureEmpty reason="Fewer than two measured readings is not a tape." />
        )}
      </Figure>
    </>
  );
}
