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
 *
 * Two views over one payload and one fetch: Series draws the recorded line,
 * Families breaks the same points down by the family each was measured on, so
 * a reader can tell "the index is quiet" from "one family is unreadable and
 * the rest are flat". The switcher is a `.seg`, as every in-section split on
 * this tab is; the chips describe both views and sit outside it.
 */

import { useState } from "react";

import { useMeasuredWidth } from "@/components/chart-kit";
import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexPoint, CoherenceIndexSeries } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import { clock, thin, type IndexPoint } from "./IndexBasisChart";

const HEIGHT = 160;
const MARGIN = { top: 12, right: 4, bottom: 22, left: 4 };

/** The tape stores nanoseconds; a clock label wants milliseconds. */
const NS_PER_MS = 1_000_000;

/** At most this many distinct reasons are named before the rest are counted. */
const REASONS_SHOWN = 3;

/**
 * Why readings could not be measured, counted by the reason the tape recorded.
 *
 * The count says how much is missing; only `detail` says why, and the poller
 * records it per point. A bare count reads as one uniform outage when it is
 * usually several different books failing for different reasons.
 */
function whyUnmeasurable(points: CoherenceIndexPoint[]): string {
  const counts = new Map<string, number>();
  for (const point of points) {
    if (toCenticents(point.ci) != null) continue;
    const detail = point.detail?.trim() || "no reason recorded";
    counts.set(detail, (counts.get(detail) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const named = ranked.slice(0, REASONS_SHOWN).map(([detail, count]) => `${detail} (${count})`);
  if (ranked.length > named.length) named.push(`${ranked.length - named.length} further reason(s) recorded`);
  return named.join("; ");
}

interface FamilyRow {
  ticker: string;
  readings: number;
  measured: number;
  unmeasurable: number;
  /** The largest distance measured on this family, or null if none ever was. */
  peak: number | null;
}

function familyRows(data: CoherenceIndexSeries): FamilyRow[] {
  const rows = new Map<string, FamilyRow>();
  const rowFor = (ticker: string) => {
    const found = rows.get(ticker) ?? { ticker, readings: 0, measured: 0, unmeasurable: 0, peak: null };
    rows.set(ticker, found);
    return found;
  };
  // Seeded from the watched list first, so a family that has produced nothing
  // still gets a row: absent from the table reads as "not watched".
  for (const ticker of data.series) rowFor(ticker);
  for (const point of data.points) {
    const row = rowFor(point.series_ticker);
    row.readings += 1;
    const cc = toCenticents(point.ci);
    if (cc == null) {
      row.unmeasurable += 1;
      continue;
    }
    row.measured += 1;
    row.peak = row.peak == null || cc > row.peak ? cc : row.peak;
  }
  return [...rows.values()].sort(
    (a, b) => (b.peak ?? -1) - (a.peak ?? -1) || a.ticker.localeCompare(b.ticker),
  );
}

function FamilyTable({ data }: { data: CoherenceIndexSeries }) {
  const rows = familyRows(data);

  if (!rows.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> No family has been polled yet.
      </p>
    );
  }

  return (
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          One row per family the poller watches, worst peak first. Peak is the largest distance measured on
          that family; a family with no measurable reading shows a dash rather than a zero, because
          unmeasured is not a distance of zero.
        </caption>
        <thead>
          <tr>
            <th scope="col">Family</th>
            <th scope="col" className="num">Readings</th>
            <th scope="col" className="num">Measured</th>
            <th scope="col" className="num">Unmeasurable</th>
            <th scope="col" className="num">Peak distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.ticker}>
              <th scope="row">{row.ticker}</th>
              <td className="num">{row.readings}</td>
              <td className="num">{row.measured}</td>
              <td className="num">{row.unmeasurable}</td>
              <td className="num">
                {row.peak == null ? <span className="muted">—</span> : fromCenticents(row.peak)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ data }: { data: CoherenceIndexSeries }) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const points: IndexPoint[] = data.points.map((point) => ({
    ts: point.ts_ns,
    cc: toCenticents(point.ci),
    // Nothing on this tape is feed-flagged; the field belongs to `thin`, which
    // keeps a flagged sample whatever bucket it falls in.
    flagged: false,
  }));
  const measured = points.filter((point) => point.cc != null);
  const why = whyUnmeasurable(data.points);

  if (!measured.length) {
    return (
      <Figure
        caption="Distance from the nearest coherent price vector"
        ariaLabel="No index reading could be measured"
        missing={
          data.points.length
            ? `All ${data.points.length} readings were unmeasurable: every family had a market quoted on one side only, and reading a one-sided quote as a probability overstates it by half the spread.${
                why ? ` By the reason recorded: ${why}.` : ""
              }`
            : null
        }
      >
        <FigureEmpty reason="Nothing measurable recorded yet." />
      </Figure>
    );
  }

  // ~2,000 polls into a ~700px plot is more readings than pixels. Thinned by
  // keeping the extremes of each bucket, never every nth point, so a spike
  // survives; `thin` also keeps every gap whatever bucket it lands in.
  const { kept, bucket } = thin(points);

  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const span = Math.max(1, last - first);
  const peak = Math.max(...measured.map((point) => point.cc as number), 1);

  const plotWidth = plotW - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (ts: number) => MARGIN.left + ((ts - first) / span) * plotWidth;
  const y = (cc: number) => base - (cc / peak) * (base - MARGIN.top);

  // Broken at gaps, never bridged: an unmeasurable poll is a hole in the
  // record, and a line drawn through it asserts a reading nobody took.
  const segments: string[] = [];
  let current = "";
  for (const point of kept) {
    if (point.cc == null) {
      if (current) segments.push(current);
      current = "";
      continue;
    }
    current += `${current ? "L" : "M"}${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`;
  }
  if (current) segments.push(current);

  const notes = [
    data.unmeasurable
      ? `${data.unmeasurable} of ${data.points.length} readings could not be measured and are drawn as gaps, not as zero.`
      : "",
    why ? `By the reason recorded: ${why}.` : "",
    kept.length < points.length
      ? `${points.length} readings thinned to ${kept.length} drawn points, keeping the highest and lowest in each ${bucket}-reading bucket, so no peak is smoothed away and no gap is closed.`
      : "",
  ].filter(Boolean);

  return (
    <Figure
      caption="Distance from the nearest coherent price vector, over time"
      ariaLabel={`${measured.length} measured readings, peaking at ${fromCenticents(peak)}`}
      reading={`Peak distance ${fromCenticents(peak)}. Zero means the quoted prices admit a probability exactly; the further above, the more the family is pricing against itself.`}
      missing={notes.length ? notes.join(" ") : null}
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-index">
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        {segments.map((path) => (
          <path key={path.slice(0, 24)} d={path} className="coh-index__line" fill="none" />
        ))}
        <text x={MARGIN.left} y={MARGIN.top - 2} className="coh-ladder__tick">
          {fromCenticents(peak)}
        </text>
        <text x={MARGIN.left} y={HEIGHT - 6} className="coh-ladder__tick">
          {clock(first / NS_PER_MS)} UTC
        </text>
        <text x={plotW - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          {clock(last / NS_PER_MS)} UTC
        </text>
        </svg>
      </div>
    </Figure>
  );
}

export default function IndexPane({ active }: { active: boolean }) {
  const [view, setView] = useState<"series" | "families">("series");
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
      <div className="seg" role="group" aria-label="Index view">
        <button type="button" aria-pressed={view === "series"} onClick={() => setView("series")}>
          Series
        </button>
        <button type="button" aria-pressed={view === "families"} onClick={() => setView("families")}>
          Families
        </button>
      </div>

      {/* Outside the switcher: all four count both views' readings. */}
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

      {view === "series" ? (
        <>
          <h4>The index over time</h4>
          <Chart data={data} />
        </>
      ) : (
        <>
          <h4>Readings, family by family</h4>
          <FamilyTable data={data} />
          {data.notes.map((note, index) => (
            <p className="coh-event__note" key={`${index}-${note}`}>
              {note}
            </p>
          ))}
          <p className="coh-event__note">
            Each reading is the L1 distance from a family&rsquo;s mid prices to the nearest vector that sums to
            a dollar — mid prices, not the executable side, because consistency is a property of the prices
            while whether it can be traded is a property of the book.
          </p>
        </>
      )}
    </div>
  );
}
