"use client";

/**
 * The published index over time, against the average the contract settles on.
 *
 * The whole point of the figure is the vertical gap at the right-hand edge. A
 * temperature contract does not resolve against the number the feed printed a
 * moment ago; it resolves against the mean of the settlement window, and those
 * two are not the same reading. Whoever trades the latest print is carrying
 * exactly that difference as basis, so the difference is drawn as a bracket
 * with its own label rather than left for the reader to subtract by eye.
 *
 * The reference is drawn OVER the series, as everywhere on this tab: the
 * window average is the only line the reader is being asked to judge against,
 * so nothing may occlude it.
 *
 * A per-minute feed produces far more samples than a browser-width plot has
 * pixels, so the series is thinned. It is thinned by keeping the highest and
 * lowest reading in each bucket rather than by sampling every nth minute,
 * which is the difference between a smaller picture and a smoothed one — an
 * every-nth rule quietly deletes the spikes, and a spike in a settlement feed
 * is the thing worth seeing. Flagged minutes and unreadable ones are never
 * thinned away whatever bucket they fall in, and the footnote states the rule.
 */

import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceWeatherSample } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "./Figure";

const HEIGHT = 240;
const MARGIN = { top: 22, right: 112, bottom: 34, left: 58 };

/** Roughly one bucket per two pixels of a full-width plot. */
const TARGET_BUCKETS = 240;

export interface IndexPoint {
  ts: number;
  /** The reading in integer ten-thousandths, or null where it would not parse. */
  cc: number | null;
  flagged: boolean;
}

/** Exact, and without the four trailing decimals a price would want. */
function plain(cc: number | null): string {
  const text = fromCenticents(cc);
  if (text == null) return "—";
  return text.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/** Minutes and hours in UTC, so the label does not depend on the reader's clock. */
function clock(ms: number): string {
  const at = new Date(ms);
  return `${String(at.getUTCHours()).padStart(2, "0")}:${String(at.getUTCMinutes()).padStart(2, "0")}`;
}

export function thin(points: IndexPoint[]): { kept: IndexPoint[]; bucket: number } {
  if (points.length <= TARGET_BUCKETS * 2) return { kept: points, bucket: 1 };
  const bucket = Math.ceil(points.length / TARGET_BUCKETS);
  const keep = new Set<number>([0, points.length - 1]);
  for (let start = 0; start < points.length; start += bucket) {
    const end = Math.min(points.length, start + bucket);
    let lowest = -1;
    let highest = -1;
    for (let index = start; index < end; index += 1) {
      const point = points[index];
      // A flagged minute is evidence about the feed, and an unreadable one is a
      // hole in the record. Neither may be dropped to make the line shorter.
      if (point.flagged || point.cc == null) keep.add(index);
      if (point.cc == null) continue;
      if (lowest < 0 || (points[lowest].cc as number) > point.cc) lowest = index;
      if (highest < 0 || (points[highest].cc as number) < point.cc) highest = index;
    }
    if (lowest >= 0) keep.add(lowest);
    if (highest >= 0) keep.add(highest);
  }
  const kept = [...keep].sort((a, b) => a - b).map((index) => points[index]);
  return { kept, bucket };
}

export interface IndexBasisChartProps {
  samples: CoherenceWeatherSample[];
  windowMinutes: number;
  windowAverage: string | null;
  windowAverageClean: string | null;
  latestValue: string | null;
  spotMinusWindow: string | null;
}

export default function IndexBasisChart({
  samples,
  windowMinutes,
  windowAverage,
  windowAverageClean,
  latestValue,
  spotMinusWindow,
}: IndexBasisChartProps) {
  const points: IndexPoint[] = samples.map((sample) => ({
    ts: sample.ts_ms,
    cc: toCenticents(sample.value),
    flagged: sample.status !== "normal",
  }));
  const readable = points.filter((point) => point.cc != null);

  if (readable.length < 2) {
    return (
      <Figure
        caption="The published index over time, against the average it settles on"
        ariaLabel="The published settlement index could not be drawn"
        missing={
          points.length
            ? `${points.length} sample(s) arrived and ${readable.length} of them parsed as a reading, which is not enough to draw a line. Nothing is drawn rather than a line through one point.`
            : null
        }
      >
        <FigureEmpty reason="No readable sample in this feed." />
      </Figure>
    );
  }

  const { kept, bucket } = thin(points);
  const average = toCenticents(windowAverage);
  const clean = toCenticents(windowAverageClean);
  const latest = toCenticents(latestValue);
  const drawClean = clean != null && average != null && clean !== average;

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = Math.max(1, last - first);
  // Clamped at both ends: a window longer than the feed starts at its first
  // sample, and a window of zero minutes still has to land on a real one.
  const windowIndex = Math.min(points.length - 1, Math.max(0, points.length - windowMinutes));
  const windowStart = points[windowIndex].ts;

  const domain = [
    ...readable.map((point) => point.cc as number),
    ...(average == null ? [] : [average]),
    ...(clean == null ? [] : [clean]),
  ];
  const low = Math.min(...domain);
  const high = Math.max(...domain);
  const pad = Math.max((high - low) * 0.08, 1_000);
  const floor = low - pad;
  const ceiling = high + pad;

  const flagged = points.filter((point) => point.flagged);
  const basis = spotMinusWindow ?? null;
  const reading =
    latest == null || average == null
      ? `The latest reading is ${latestValue ?? "—"} and the ${windowMinutes}-minute average is ${windowAverage ?? "—"}. One of the two is absent, so no basis is drawn — it is not zero.`
      : `The latest published reading is ${latestValue}; the ${windowMinutes}-minute settlement average is ${windowAverage}. The contract resolves against the average, so a position taken on the latest print carries ${basis ?? plain(latest - average)} of basis in the index's own units.`;

  const notes = [
    points.length > kept.length
      ? `${points.length} per-minute samples thinned to ${kept.length} drawn points: the series is cut into ${bucket}-sample buckets and the highest and lowest reading in each is kept, so no peak is smoothed away.`
      : `All ${points.length} samples are drawn; no thinning was needed.`,
    flagged.length
      ? `${flagged.length} sample(s) the feed flagged are marked ▲ and are kept whatever bucket they fall in.`
      : "No sample in this feed is flagged.",
    drawClean
      ? "The average excluding flagged minutes is drawn as a second, dashed line: the flags move the number today."
      : average == null
        ? "No window average was published, so no reference line is drawn."
        : "The average excluding flagged minutes lands on the same number, so only one reference line is drawn.",
    points.length - readable.length
      ? `${points.length - readable.length} sample(s) did not parse as a reading and are drawn as gaps in the line, not as zero.`
      : "",
  ].filter(Boolean);

  return (
    <Figure
      caption={`The published index over the last ${points.length} minutes, against the ${windowMinutes}-minute average it settles on`}
      ariaLabel={`A line of the published settlement index across ${points.length} minutes, with the ${windowMinutes}-minute settlement average drawn as a horizontal reference. The latest reading is ${latestValue ?? "absent"} and the average is ${windowAverage ?? "absent"}.`}
      reading={reading}
      missing={notes.join(" ")}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const right = Math.max(MARGIN.left + 80, width - MARGIN.right);
          const base = HEIGHT - MARGIN.bottom;
          const x = (ts: number) => MARGIN.left + ((ts - first) / span) * (right - MARGIN.left);
          const y = (cc: number) => base - ((cc - floor) / (ceiling - floor)) * (base - MARGIN.top);

          let path = "";
          let open = false;
          for (const point of kept) {
            if (point.cc == null) {
              open = false;
              continue;
            }
            path += `${open ? "L" : "M"}${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`;
            open = true;
          }

          return (
            <>
              <rect
                x={x(windowStart)}
                y={MARGIN.top}
                width={Math.max(0, right - x(windowStart))}
                height={base - MARGIN.top}
                className="coh-settle__window"
              />
              <text x={x(windowStart) + 4} y={MARGIN.top - 8} className="coh-ladder__tick">
                settlement window, last {windowMinutes} minutes
              </text>

              <line x1={MARGIN.left} x2={right} y1={base} y2={base} className="coh-ladder__axis" />
              <path d={path} className="coh-settle__line" fill="none" />

              {flagged.map((point) =>
                point.cc == null ? null : (
                  <g key={point.ts}>
                    <line
                      x1={x(point.ts)}
                      x2={x(point.ts)}
                      y1={y(point.cc) - 14}
                      y2={y(point.cc)}
                      className="coh-settle__flag"
                    />
                    <text x={x(point.ts)} y={y(point.cc) - 16} textAnchor="middle" className="coh-settle__flag-mark">
                      ▲
                    </text>
                    <title>{`flagged degraded at ${clock(point.ts)} UTC, ${plain(point.cc)}`}</title>
                  </g>
                ),
              )}

              {drawClean && clean != null ? (
                <line x1={MARGIN.left} x2={right} y1={y(clean)} y2={y(clean)} className="coh-settle__avg-clean" />
              ) : null}

              {/* Drawn last, over the series: it is the only reference the
                  reader is asked to judge the line against. */}
              {average == null ? null : (
                <>
                  <line x1={MARGIN.left} x2={right} y1={y(average)} y2={y(average)} className="coh-settle__avg" />
                  <text x={MARGIN.left + 4} y={y(average) - 5} className="coh-settle__avg-label">
                    {windowMinutes}-minute average {windowAverage}
                  </text>
                </>
              )}

              {latest == null ? null : (
                <circle cx={right} cy={y(latest)} r={3} className="coh-settle__dot" />
              )}
              {latest != null && average != null ? (
                <>
                  <line x1={right + 10} x2={right + 10} y1={y(latest)} y2={y(average)} className="coh-settle__basis" />
                  <line x1={right + 6} x2={right + 14} y1={y(latest)} y2={y(latest)} className="coh-settle__basis" />
                  <line x1={right + 6} x2={right + 14} y1={y(average)} y2={y(average)} className="coh-settle__basis" />
                  <text x={right + 18} y={(y(latest) + y(average)) / 2 - 2} className="coh-settle__basis-label">
                    basis {basis ?? plain(latest - average)}
                  </text>
                  <text x={right + 18} y={(y(latest) + y(average)) / 2 + 11} className="coh-ladder__tick">
                    latest {latestValue}
                  </text>
                </>
              ) : null}

              <text x={MARGIN.left - 6} y={MARGIN.top + 4} textAnchor="end" className="coh-ladder__tick">
                {plain(Math.round(ceiling))}
              </text>
              <text x={MARGIN.left - 6} y={base} textAnchor="end" className="coh-ladder__tick">
                {plain(Math.round(floor))}
              </text>
              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-ladder__tick">
                {clock(first)} UTC
              </text>
              <text x={right} y={HEIGHT - 8} textAnchor="end" className="coh-ladder__tick">
                {clock(last)} UTC
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
