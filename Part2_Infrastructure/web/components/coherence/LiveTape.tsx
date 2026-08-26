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
import NumberTicker from "@/components/common/NumberTicker";
import { useBufferedValue } from "@/lib/coherence/use-buffered-value";

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
  /* THE NUMBER THAT MOVES. Until now the latest reading lived only in the
     latest mark's `<title>` — reachable by hovering one circle — and every
     poll repainted it as a cut. Buffered into one 300ms window with every
     other tape on the desk, then handed to the ticker, which counts to it and
     reserves its width so the count cannot reflow the caption beside it.
     Keyed like the series, so two tapes never share a window slot.

     ABOVE THE EMPTY BRANCH, and that is not a style choice. A hook below a
     conditional return is invisible on a warm cache — the branch never fires,
     React sees the same hook count every render, and a browser check passes.
     On a COLD load it sees fewer hooks then more, throws #310, and tears down
     the whole dashboard rather than this section. `engine-hook-order` caught
     it in the working tree; a browser had already said it was fine. */
  const latestValue = measured.length ? measured[measured.length - 1].value : null;
  const shown = useBufferedValue(`${caption}:latest`, latestValue);
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
      readout={
        shown == null
          ? null
          : <NumberTicker value={shown} format={format} className="coh-tape__now num" />
      }
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
      <Plot
        height={HEIGHT}
        /* A CROSSHAIR, not a title per mark. A tape's question is "what was it
           THEN", which is a fact about a position on the axis, and the only
           title this figure carried named the latest point — a fact the
           readout beside the caption already shows, live. `positions` because
           polls are not evenly spaced: a read that took a second longer sits a
           second further along, and a poll that failed leaves the width it
           took rather than closing up. Even spacing would put the cursor
           between the marks it names, worst exactly where the tape stuttered. */
        sharedX={(width) => {
          const right = width - MARGIN.right - advancePx(format(hi), DIAGRAM_LABEL_PX) - 6;
          const x = linearScale(first, last, MARGIN.left, Math.max(MARGIN.left + 1, right));
          return {
            count: points.length,
            x0: MARGIN.left,
            x1: Math.max(MARGIN.left + 1, right),
            positions: points.map((point) => x(point.at)),
            read: (index) => {
              const point = points[index];
              const when = index === points.length - 1 ? "now" : `${spanLabel(last - point.at)} ago`;
              return {
                title: when,
                rows: point.value == null
                  ? [{ label: "Reading", value: "—", raw: null },
                     { label: "Why", value: "this poll carried no figure" }]
                  : [{ label: "Reading", value: format(point.value), raw: point.value }],
              };
            },
            width: 200,
            arriveAt: "last",
          };
        }}
        /* UNDER the series now, not over it, and the reversal is deliberate.
           "Over the series, never under it" was this figure's own rule, on the
           reasoning that a reference hidden behind a line is no reference. But
           a dashed hairline painted first shows through a one-pixel series,
           while a hairline painted LAST can sit exactly on the tape's latest
           point and hide the one mark a reader came for. The plot paints the
           reference before every mark for that reason, and it is one rule for
           every figure with a baseline rather than one per figure. */
        reference={(width) => {
          if (!reference) return null;
          const right = width - MARGIN.right - advancePx(format(hi), DIAGRAM_LABEL_PX) - 6;
          const y = linearScale(lo, hi, HEIGHT - MARGIN.bottom, MARGIN.top);
          return { y: y(reference.value), x0: MARGIN.left, x1: Math.max(MARGIN.left + 1, right), label: reference.label };
        }}
      >
        {(width) => {
          const right = width - MARGIN.right - advancePx(format(hi), DIAGRAM_LABEL_PX) - 6;
          const x = linearScale(first, last, MARGIN.left, Math.max(MARGIN.left + 1, right));
          const y = linearScale(lo, hi, HEIGHT - MARGIN.bottom, MARGIN.top);
          const path = linePath(points.map((point) => ({ x: x(point.at), y: point.value == null ? null : y(point.value) })));
          const axis = ticks(lo, hi, 3);
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

              <path className="coh-tape__line" d={path} />

              {/* The newest reading, marked, because "what is it now" is the
                  question a live figure is asked first and a line's right-hand
                  end is not obviously the answer when the tape has gaps. */}
              {/* Still marked — "what is it now" is the question a live figure
                  is asked first — but no longer titled: a title here would make
                  the mark readout interactive beside the crosshair, two tab
                  stops and two voices on one figure. The value it named is the
                  live readout beside the caption. */}
              <circle className="coh-tape__latest" cx={x(latest.at)} cy={y(latest.value!)} r={3} />

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
