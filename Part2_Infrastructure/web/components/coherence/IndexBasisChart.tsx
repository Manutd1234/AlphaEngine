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

/**
 * Minutes and hours in UTC, so the label does not depend on the reader's clock.
 *
 * Exported because `IndexPane` draws the same axis labels off the same tape and
 * had restated these three lines locally rather than call a module-private
 * helper. One definition, two call sites.
 */
export function clock(ms: number): string {
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
            ? `${points.length} sample(s) arrived and ${readable.length} parsed as a reading — not enough for a line; nothing is drawn rather than a line through one point.`
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
      ? `Latest reading ${latestValue ?? "—"}, ${windowMinutes}-minute average ${windowAverage ?? "—"}. One of the two is absent, so no basis is drawn — it is not zero.`
      : basis == null
        ? `Latest reading ${latestValue}, ${windowMinutes}-minute settlement average ${windowAverage}. The venue published no basis for this read, so none is drawn — it is not zero.`
        : `Latest reading ${latestValue}, ${windowMinutes}-minute settlement average ${windowAverage}: a position on the latest print carries ${basis} of basis in the index's own units.`;

  const notes = [
    points.length > kept.length
      ? `${points.length} per-minute samples thinned to ${kept.length} drawn points: each ${bucket}-sample bucket keeps its highest and lowest reading, so no peak is smoothed away.`
      : "",
    flagged.length
      ? `${flagged.length} sample(s) the feed flagged are marked ▲ and kept whatever bucket they fall in.`
      : "",
    drawClean
      ? "A second, dashed line excludes flagged minutes: the flags move the number today."
      : average == null
        ? "No window average was published, so no reference line is drawn."
        : "Excluding flagged minutes lands on the same number, so only one reference line is drawn.",
    points.length - readable.length
      ? `${points.length - readable.length} sample(s) did not parse as a reading and are drawn as gaps in the line, not as zero.`
      : "",
  ].filter(Boolean);

  return (
    <Figure
      caption={`The published index over ${points.length} minutes, against the ${windowMinutes}-minute average it settles on`}
      // The caption above carries the axes and the reading carries both
      // figures, so the aria describes the one thing left: the marks.
      ariaLabel="A per-minute line of published readings, with the settlement average drawn as a reference line."
      reading={reading}
      missing={notes.join(" ")}
    >
      <Plot
        height={HEIGHT}
        /* A CROSSHAIR over the drawn points. The only title this figure carried
           was on a flagged minute — a fact about one sample, reachable only by
           hitting a 14px tick — and every OTHER minute answered nothing at all.
           `positions` from the thinned points because the feed publishes per
           minute and a minute it skipped is a gap in the axis, not a closed-up
           step. `kept` and not `points`: the crosshair names the marks that are
           drawn, which is what a reader is pointing at. */
        sharedX={(width) => {
          const right = Math.max(MARGIN.left + 80, width - MARGIN.right);
          const x = (ts: number) => MARGIN.left + ((ts - first) / span) * (right - MARGIN.left);
          return {
            count: kept.length,
            x0: MARGIN.left,
            x1: right,
            positions: kept.map((point) => x(point.ts)),
            read: (index) => {
              const point = kept[index];
              return {
                title: `${clock(point.ts)} UTC`,
                rows: [
                  point.cc == null
                    ? { label: "Published", value: "—", raw: null }
                    : { label: "Published", value: plain(point.cc), raw: point.cc },
                  ...(point.cc == null
                    ? [{ label: "Why", value: "the feed published no reading for this minute" }]
                    : average == null
                      ? []
                      : [{
                        label: `Against the ${windowMinutes}-minute average`,
                        value: plain(Math.round(point.cc - average)),
                        raw: point.cc - average,
                      }]),
                  ...(point.flagged ? [{ label: "Feed", value: "▲ flagged degraded" }] : []),
                ],
              };
            },
            width: 300,
            arriveAt: "last",
          };
        }}
      >
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
              {/* Anchored to the band's RIGHT edge, not its left. Left-anchored
                  it ran past the plot and the final "s" was clipped by the
                  viewBox — the window sits at the newest end of the series, so
                  its label always has the whole chart to its left and nothing
                  to its right. Observed at 1512px against the live feed.
                  `coh-figure__key`, not `coh-ladder__tick`: this names what the
                  shading means — legend-rung furniture (13px), not an axis tick
                  numeral, and the tick class had left it at the 10px floor. */}
              <text x={right} y={MARGIN.top - 8} textAnchor="end" className="coh-figure__key">
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
                    basis {basis ?? "—"}
                  </text>
                  {/* A series value, so it borrows `coh-axis__label` — the
                      series-value rung (12px), secondary fill, tabular-nums —
                      the way ShellTree borrows `coh-ablation__value`. Rejected:
                      `coh-settle__basis-label`, whose primary fill and 640
                      weight would put this supporting figure level with the
                      basis reading it explains; and staying `coh-ladder__tick`,
                      which is the 10px floor reserved for axis tick numerals. */}
                  <text x={right + 18} y={(y(latest) + y(average)) / 2 + 11} className="coh-axis__label">
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
