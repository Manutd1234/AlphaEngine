"use client";

/**
 * The Coherence Index over time — pricing efficiency, from first principles.
 *
 * The Dutch-book test answers yes or no and almost always says no. This is the
 * continuous version: how far a family's quotes sit from the nearest set that
 * admits a probability, measured on every poll. That turns a rare binary event
 * into a series, and a series is the thing nobody publishes for this exchange.
 *
 * IT WAS THE `index` RAIL SECTION UNTIL THE CONSOLIDATION OF 2026-08-24, and it
 * is two views of `calibration` — relabelled "Scorecard" — now. The fold is not
 * tidying: both halves answer "were these prices right", the index continuously
 * and calibration once settled, and two sections asked a reader to discover
 * that for themselves. What it cost is written down in `lib/sections.ts` and it
 * is real — `index` was PUBLISHED, so `#coherence/index` is a link someone may
 * hold, and `RELOCATED_SECTIONS` now lands it on Scorecard rather than on the
 * rail default. It lands on the SECTION; which of the five views opens is
 * component state the hash cannot name.
 *
 * So this file draws no head, owns no switcher and returns no `<section>`.
 * `CalibrationPane` owns all three and passes `view` down, exactly as
 * `CertificatePane` does with the parlays. What stayed here is the read, the
 * chips that count both views' readings, and the two drawings.
 *
 * Unmeasurable readings are drawn as gaps rather than dropped or zeroed. A
 * series that is often unmeasurable is telling you something real about its
 * books — one-sided quotes in the tails — and a line that closes over those
 * gaps would claim continuity that was never observed.
 *
 * Two views over one payload and one fetch: Index series draws the recorded
 * line, Index families breaks the same points down by the family each was
 * measured on, so a reader can tell "the index is quiet" from "one family is
 * unreadable and the rest are flat". The read is gated on `active`, which the
 * parent sets from the section AND the two views, so a reader scoring the
 * settled corpus never pays for the tape.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import { fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceIndexPoint, CoherenceIndexSeries } from "@/lib/coherence/types";
import { indexRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import { clock, thin, type IndexPoint } from "./IndexBasisChart";
import ValueStrip from "./ValueStrip";

const HEIGHT = 168;
// `top` clears the 14px `coh-svg-note` rung the peak label draws at
// (`MARGIN.top - 2`): at 12 the baseline was y=10 and the ascender was cut
// by the viewBox. Same defect as `SurvivalChart` and `FeeParabola`, found by
// the same guard. HEIGHT grows by the same eight so the plot is unchanged.
const MARGIN = { top: 20, right: 4, bottom: 22, left: 4 };

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
    <>
    {/* The table's decisive column drawn (third review, 2026-08-24): which
        family drives the index. A family with no measured reading declines
        its bar — a peak nobody measured is not a peak of zero. */}
    <ValueStrip
      caption="The worst distance ever measured, family by family"
      ariaLabel={`Peak distance per family for ${rows.length} watched families`}
      rows={rows.map((row) => ({
        label: row.ticker,
        value: row.peak,
        text: row.peak == null ? "—" : fromCenticents(row.peak) ?? "—",
        title: `${row.ticker}: ${row.readings} readings, ${row.measured} measured, ${row.unmeasurable} unmeasurable`,
        noBar: row.peak == null ? (row.readings ? "never measured" : "never polled") : undefined,
      }))}
    />
    {/* The strip answers the view's question — which family drives the index —
        so the four counts behind each bar go behind a summary (fourth review
        of 2026-08-24). They are per-row detail: how many polls a family has
        had, how many of them could be measured, and how many could not. A
        reader auditing a family's coverage opens one disclosure; a reader
        asking which family is worst never has to. */}
    <details className="disclosure">
      <summary>{`Readings, measured and unmeasurable for each watched family, ${rows.length} rows`}</summary>
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          One row per watched family, worst peak first. An unmeasurable poll is counted in its own column, never
          folded into the measured ones.
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
    </details>
    </>
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
            ? `All ${data.points.length} readings were unmeasurable — every family had a market quoted on one side only, and a one-sided quote overstates the probability by half the spread.${
                why ? ` Recorded reasons: ${why}.` : ""
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
  //
  // Each unbroken run carries its own hover line (fourth review of
  // 2026-08-24). The segments ARE the marks here — the gaps between them are
  // the figure's subject — so a title per run says how long the record was
  // continuous and how far it climbed, which is what the eye cannot take off
  // a line whose y scale is one number in the corner.
  const segments: Array<{ d: string; from: number; to: number; count: number; peak: number }> = [];
  let current: { d: string; from: number; to: number; count: number; peak: number } | null = null;
  for (const point of kept) {
    if (point.cc == null) {
      if (current) segments.push(current);
      current = null;
      continue;
    }
    if (current) {
      current.d += `L${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`;
      current.to = point.ts;
      current.count += 1;
      current.peak = Math.max(current.peak, point.cc);
    } else {
      current = {
        d: `M${x(point.ts).toFixed(2)},${y(point.cc).toFixed(2)}`,
        from: point.ts,
        to: point.ts,
        count: 1,
        peak: point.cc,
      };
    }
  }
  if (current) segments.push(current);

  const notes = [
    data.unmeasurable
      ? `${data.unmeasurable} of ${data.points.length} readings could not be measured and are drawn as gaps.`
      : "",
    why ? `Recorded reasons: ${why}.` : "",
    kept.length < points.length
      ? `${points.length} readings thinned to ${kept.length} drawn, keeping each ${bucket}-reading bucket\u2019s extremes: no peak smoothed away, no gap closed.`
      : "",
  ].filter(Boolean);

  return (
    <Figure
      caption="Distance from the nearest coherent price vector, over time"
      ariaLabel={`${measured.length} measured readings, peaking at ${fromCenticents(peak)}`}
      reading={`Peak ${fromCenticents(peak)}. Zero is prices admitting a probability exactly; the further above, the more the family prices against itself.`}
      missing={notes.length ? notes.join(" ") : null}
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-index">
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        {segments.map((segment) => (
          <path key={segment.d.slice(0, 24)} d={segment.d} className="coh-index__line" fill="none">
            <title>
              {`${segment.count} unbroken readings, ${clock(segment.from / NS_PER_MS)} to ${clock(segment.to / NS_PER_MS)} UTC, peaking at ${fromCenticents(segment.peak)}`}
            </title>
          </path>
        ))}
        {/* The peak value IS this chart's y scale — there is no y axis — so it
            is an in-plot scale note on the diagram ladder's 13px rung
            (coh-svg-note, 14r), while the two clock labels stay tick numerals
            at the 10px floor. */}
        <text x={MARGIN.left} y={MARGIN.top - 2} className="coh-svg-note">
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

export default function IndexPane({ active, view }: {
  active: boolean;
  /** Which of the section's two index views is showing. */
  view: "series" | "families";
}) {
  const { data, error } = useCoherenceRead<CoherenceIndexSeries>(indexRoute(), active);

  // No head on any of these branches. The section's head is `CalibrationPane`'s
  // and it is drawn above whatever this returns, so a reader always knows which
  // section they are standing in — which is the whole reason a demoted pane
  // must stop drawing one rather than keep a second.
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
    // `.coh-index-pane` is the 12px grid this pane has always stacked in, and
    // it survives the demotion as a plain <div>: the pane is a view now, so the
    // `<section aria-labelledby>` and the head that labelled it belong to
    // `CalibrationPane`, but the RHYTHM between the chips, the drawing and the
    // notes was never the section's — it was this content's.
    <div className="coh-index-pane">
      {/* Outside the drawing: all four count both views' readings. */}
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

      {/* Both views, once. The `index` section's lede carried this and the fold
          into Scorecard left it homeless; it is not decoration — the gaps are
          most of the record on a thin watchlist, and a reader who reads them as
          nothing happening has the record backwards. */}
      {view === "series" ? (
        <Chart data={data} />
      ) : (
        <>
          <FamilyTable data={data} />
          {data.notes.map((note, index) => (
            <p className="coh-event__note" key={`${index}-${note}`}>
              {note}
            </p>
          ))}
          <p className="coh-event__note">
            A reading is the L1 distance from the family&rsquo;s MID prices to the nearest vector summing to a dollar
            — mid, because consistency is a property of the prices, tradability of the book.
          </p>
        </>
      )}

      <p className="coh-event__note">
        A poll that could not be measured is drawn as a gap, never as a zero and never dropped: a line closed over
        one would claim continuity nobody observed.
      </p>
    </div>
  );
}
