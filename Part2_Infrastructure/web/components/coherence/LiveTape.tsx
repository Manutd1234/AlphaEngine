"use client";

/**
 * What this reader has watched happen, since they opened the tab.
 *
 * The one figure on the engine with a time axis that is not the gateway's tape.
 * `IndexPane` and `CalibrationTrend` draw what the RECORDER wrote, which runs
 * back weeks and exists whether or not anyone is looking; this draws what THIS
 * browser has seen, which starts when the tab opens and is gone on reload.
 * They are different objects and the caption says which this is on every
 * mount — an x-axis that appears to mean "the last hour" and means "the four
 * minutes you have been here" is the worst kind of chart, because it is read
 * correctly and understood wrongly.
 *
 * WHY IT IS WORTH DRAWING AT ALL, given the tape exists: the tape is per-market
 * and per-poll and the gateway does not aggregate it. Whether the WATCHLIST's
 * basket has been over a dollar all afternoon, whether the implied mass is
 * drifting, whether the fee share moved when the example changed — those are
 * questions about a figure this desk computes, not about a number the exchange
 * publishes, and no route answers them. The polls are already arriving; this
 * keeps them.
 *
 * A GAP IS DRAWN AS A GAP. `linePath` breaks at nulls rather than bridging
 * them, so a read that failed leaves a hole the width of the time it took —
 * which is the whole argument `GappedSparkline` was written for, applied to a
 * figure that has a real axis rather than a 128px strip.
 *
 * THE REFERENCE IS DRAWN OVER THE SERIES, as everywhere on this tab: the dollar
 * line, the zero, the window mean is the only thing the reader is being asked
 * to judge against and nothing may occlude it.
 *
 * BELOW TWO READINGS IT DRAWS NOTHING AND SAYS SO. One point is a dot, and a
 * dot on a time axis reads as a flat line at that value — a measurement of
 * stability that has not been made. `FigureEmpty` names how many readings are
 * in hand so the reader knows to wait rather than to press something.
 */

import { extent, linePath, linearScale, ticks } from "@/components/chart-kit";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import type { LivePoint } from "@/lib/coherence/use-live-series";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 132;
const MARGIN = { top: 12, right: 14, bottom: 20, left: 8 };

export interface LiveTapeProps {
  points: readonly LivePoint[];
  /** What the series IS, as a sentence fragment. The caption adds the scope. */
  caption: string;
  ariaLabel: string;
  /** A line the reader judges against — a dollar, a zero, a window mean. */
  reference?: { value: number; label: string } | null;
  /** How to print a value on the axis and in a mark's own words. */
  format?: (value: number) => string;
  /** The reading under the figure, when the caller has one to make. */
  reading?: string | null;
  /** What the drawing cannot say. */
  missing?: string | null;
}

const DEFAULT_FORMAT = (value: number) => value.toFixed(4);

/** "3m 20s", for the span a tape actually covers. Never a bare second count
 *  past a minute, which is the one number a reader has to convert by hand. */
function spanLabel(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export default function LiveTape({
  points, caption, ariaLabel, reference = null, format = DEFAULT_FORMAT, reading = null, missing = null,
}: LiveTapeProps) {
  const measured = points.filter((point) => point.value != null);
  const gaps = points.length - measured.length;
  // The scope, said in the caption itself rather than in a footnote, because it
  // is what the axis MEANS and a reader who misses it misreads the figure
  // rather than merely learning less from it.
  const span = points.length > 1 ? spanLabel(points[points.length - 1].at - points[0].at) : null;
  const scope = points.length
    ? `since this tab opened, ${points.length} ${points.length === 1 ? "read" : "reads"}${span ? ` over ${span}` : ""}`
    : "since this tab opened";
  const full = `${caption} — ${scope}`;

  if (measured.length < 2) {
    return (
      <Figure caption={full} ariaLabel={ariaLabel}>
        <FigureEmpty
          reason={
            points.length === 0
              ? "No poll has landed yet, so there is nothing to plot against time."
              : `Only ${measured.length} of ${points.length} ${points.length === 1 ? "read has" : "reads have"} `
                + "carried this figure; a line needs two. It fills in as the desk polls."
          }
        />
      </Figure>
    );
  }

  const values = points.map((point) => point.value);
  const [lo, hi] = extent(reference ? [...values, reference.value] : values);
  const first = points[0].at;
  const last = points[points.length - 1].at;

  return (
    <Figure
      caption={full}
      ariaLabel={ariaLabel}
      reading={reading}
      missing={
        missing
        ?? (gaps
          ? `${gaps} of ${points.length} reads carried no figure and are drawn as breaks, not bridged — `
            + "a poll that answered nothing is not a value between its neighbours."
          : null)
      }
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const right = width - MARGIN.right - advancePx(format(hi), DIAGRAM_LABEL_PX) - 6;
          const x = linearScale(first, last, MARGIN.left, Math.max(MARGIN.left + 1, right));
          const y = linearScale(lo, hi, HEIGHT - MARGIN.bottom, MARGIN.top);
          const path = linePath(points.map((point) => ({ x: x(point.at), y: point.value == null ? null : y(point.value) })));
          const axis = ticks(lo, hi, 3);
          const refY = reference ? y(reference.value) : null;
          const latest = measured[measured.length - 1];

          return (
            <g>
              {axis.map((value) => (
                <g key={value}>
                  <line
                    className="coh-tape__grid"
                    x1={MARGIN.left}
                    x2={Math.max(MARGIN.left + 1, right)}
                    y1={y(value)}
                    y2={y(value)}
                  />
                  <text className="coh-tape__tick" x={Math.max(MARGIN.left + 1, right) + 4} y={y(value) + 4}>
                    {format(value)}
                  </text>
                </g>
              ))}

              {/* Over the series, never under it. */}
              {refY != null && reference ? (
                <>
                  <line
                    className="coh-tape__reference"
                    x1={MARGIN.left}
                    x2={Math.max(MARGIN.left + 1, right)}
                    y1={refY}
                    y2={refY}
                  />
                  <text className="coh-tape__reference-label" x={MARGIN.left + 2} y={refY - 4}>
                    {reference.label}
                  </text>
                </>
              ) : null}

              <path className="coh-tape__line" d={path} />

              {/* The newest reading, marked, because "what is it now" is the
                  question a live figure is asked first and a line's right-hand
                  end is not obviously the answer when the tape has gaps. */}
              <circle className="coh-tape__latest" cx={x(latest.at)} cy={y(latest.value!)} r={3}>
                <title>{`Latest, ${format(latest.value!)}`}</title>
              </circle>

              <text className="coh-tape__tick" x={MARGIN.left} y={HEIGHT - 5}>
                {`${spanLabel(last - first)} ago`}
              </text>
              <text className="coh-tape__tick coh-tape__tick--end" x={Math.max(MARGIN.left + 1, right)} y={HEIGHT - 5}>
                now
              </text>
            </g>
          );
        }}
      </Plot>
    </Figure>
  );
}
