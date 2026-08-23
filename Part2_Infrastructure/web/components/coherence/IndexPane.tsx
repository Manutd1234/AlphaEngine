"use client";

/**
 * The Coherence Index over time — pricing efficiency, from first principles.
 *
 * The Dutch-book test answers yes or no and almost always says no. This is the
 * continuous version: how far a family's quotes sit from the nearest set that
 * admits a probability, measured on every poll. That turns a rare binary event
 * into a series, and a series is the thing nobody publishes for this exchange.
 *
 * Unmeasurable readings are drawn as gaps rather than dropped or zeroed. A
 * series that is often unmeasurable is telling you something real about its
 * books — one-sided quotes in the tails — and a line that closes over those
 * gaps would claim continuity that was never observed.
 */

import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexSeries } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";

const HEIGHT = 160;
const MARGIN = { top: 12, right: 4, bottom: 22, left: 4 };

function Chart({ data }: { data: CoherenceIndexSeries }) {
  const points = data.points.map((point) => ({
    ts: point.ts_ns,
    cc: toCenticents(point.ci),
    series: point.series_ticker,
  }));
  const measured = points.filter((point) => point.cc != null);

  if (!measured.length) {
    return (
      <Figure
        caption="Distance from the nearest coherent price vector"
        ariaLabel="No index reading could be measured"
        missing={
          data.points.length
            ? `All ${data.points.length} readings so far were unmeasurable — every one of these families had a market quoted on one side only, and reading a one-sided quote as a probability overstates it by half the spread.`
            : null
        }
      >
        <FigureEmpty reason="Nothing measurable recorded yet." />
      </Figure>
    );
  }

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = Math.max(1, last - first);
  const peak = Math.max(...measured.map((point) => point.cc as number), 1);

  const plotWidth = 100 - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (ts: number) => MARGIN.left + ((ts - first) / span) * plotWidth;
  const y = (cc: number) => base - (cc / peak) * (base - MARGIN.top);

  // Broken at gaps, never bridged: an unmeasurable poll is a hole in the
  // record, and a line drawn through it asserts a reading nobody took.
  const segments: string[] = [];
  let current = "";
  for (const point of points) {
    if (point.cc == null) {
      if (current) segments.push(current);
      current = "";
      continue;
    }
    current += `${current ? "L" : "M"}${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`;
  }
  if (current) segments.push(current);

  return (
    <Figure
      caption="Distance from the nearest coherent price vector, over time"
      ariaLabel={`${measured.length} measured readings, peaking at ${fromCenticents(peak)}`}
      reading={`Peak distance ${fromCenticents(peak)}. A reading of zero means the quoted prices admit a probability exactly; the further above, the more the family is pricing against itself.`}
      missing={
        data.unmeasurable
          ? `${data.unmeasurable} of ${data.points.length} readings could not be measured and are drawn as gaps, not as zero.`
          : null
      }
    >
      <svg viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" className="coh-index">
        <line x1={MARGIN.left} x2={100 - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        {segments.map((path) => (
          <path key={path.slice(0, 24)} d={path} className="coh-index__line" fill="none" />
        ))}
        <text x={MARGIN.left} y={MARGIN.top - 2} className="coh-ladder__tick">
          {fromCenticents(peak)}
        </text>
        <text x={MARGIN.left} y={HEIGHT - 6} className="coh-ladder__tick">
          oldest
        </text>
        <text x={100 - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          newest
        </text>
      </svg>
    </Figure>
  );
}

export default function IndexPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<CoherenceIndexSeries>("/api/gateway/coherence/index?limit=2000", active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The index could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the index…</p>;
  if (data.state === "empty") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> {data.notes[0] ?? "Nothing indexed yet."} Set{" "}
        <code>COHERENCE_SERIES</code> and <code>COHERENCE_POLL_S</code> on the gateway to start recording.
      </p>
    );
  }

  return (
    <div className="coh-index-pane">
      <div className="coh-status__chips">
        <StateChip mark="●" word="Readings" value={String(data.points.length)} tone="muted" />
        <StateChip mark="✓" word="Measured" value={String(data.measured)} tone="good" />
        <StateChip
          mark="◌"
          word="Unmeasurable"
          value={String(data.unmeasurable)}
          tone={data.unmeasurable > data.measured ? "warn" : "muted"}
        />
        <StateChip mark="◇" word="Series watched" value={String(data.series.length)} tone="muted" />
      </div>
      <Chart data={data} />
      <p className="coh-event__note">
        Each reading is the L1 distance from a family&rsquo;s mid prices to the nearest vector that sums to a dollar.
        Mid prices, not the executable side: the question here is how far these quotes sit from consistency, which is a
        property of the prices, while whether it can be traded is a property of the book.
      </p>
    </div>
  );
}
