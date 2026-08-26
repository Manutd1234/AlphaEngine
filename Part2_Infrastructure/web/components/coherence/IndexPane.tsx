"use client";

/**
 * The Coherence Index over time — pricing efficiency, from first principles.
 *
 * The Dutch-book test answers yes or no and almost always says no. This is the
 * continuous version: how far a family's quotes sit from the nearest set that
 * admits a probability, measured on every poll. That turns a rare binary event
 * into a series, and a series is the thing nobody publishes for this exchange.
 *
 * IT DRAWS NO HEAD, OWNS NO SWITCHER AND RETURNS NO `<section>`. `IndexSection`
 * owns all three and passes `view` down. What is here is the read, the chips
 * that count both views' readings, and the drawings. The section's own history
 * — published id, folded into Scorecard on 2026-08-24, its own rail again on
 * 2026-08-25 — is `lib/sections.ts`, told once.
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
import FamilyRidge from "./FamilyRidge";
import IndexFamilies from "./IndexFamilies";
import IndexSeriesChart from "./IndexSeriesChart";
import MeasurabilityStrip from "./MeasurabilityStrip";
import { marksAtStamps, stampsOf } from "@/lib/coherence/index-stamps";
import { LinkedX } from "@/lib/coherence/linked-x";
import SectionVerdict from "./SectionVerdict";
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

/**
 * ONE LANE PER SERIES, since 2026-08-26.
 *
 * This was ~135 lines that mapped every point to `{ts, cc}` and dropped
 * `series_ticker`, `event_ticker` and `engine` before drawing one pooled line.
 * Measured against the live tape, that line joined two series, twenty-five
 * families and three estimators, so almost every segment of it crossed a
 * boundary of one kind or another — it had the shape of a time series and the
 * content of a scatter in poll order. `IndexSeriesChart` draws the series apart
 * and states in its notes what is still pooled inside them.
 */
function Chart({ data, stamps }: { data: CoherenceIndexSeries; stamps: readonly number[] }) {
  return <IndexSeriesChart points={data.points} stamps={stamps} />;
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
      <SectionVerdict pending={<><span aria-hidden="true">✕</span> The index could not be read: {error}</>} />
    );
  }
  if (!data) return <SectionVerdict pending="Reading the index…" />;
  if (data.state === "empty") {
    return (
      <SectionVerdict
        pending={
          <>
            <span aria-hidden="true">◌</span> {data.notes[0] ?? "Nothing indexed yet."} Set{" "}
            <code>COHERENCE_SERIES</code> and <code>COHERENCE_POLL_S</code> on the gateway to start recording.
          </>
        }
      />
    );
  }

  // ONE INDEX SPACE for the chart and the strip: the distinct poll stamps,
  // derived here and handed to both, so their linked crosshair counts the
  // same polls. One mark per STAMP on the strip, not per point — a poll that
  // read two series is two points and one moment.
  const stamps = stampsOf(data.points);

  return (
    // `.coh-index-pane` is the 12px grid this pane has always stacked in, and
    // it survives the demotion as a plain <div>: the pane is a view now, so the
    // `<section aria-labelledby>` and the head that labelled it belong to
    // `CalibrationPane`, but the RHYTHM between the chips, the drawing and the
    // notes was never the section's — it was this content's.
    <div className="coh-index-pane">
      {/* Outside the drawing: all four count both views' readings. */}
      <SectionVerdict>
        <StateChip mark="●" word="Readings" value={String(data.points.length)} tone="muted" />
        <StateChip mark="✓" word="Measured" value={String(data.measured)} tone="good" />
        <StateChip
          mark="◌"
          word="Unmeasurable"
          value={String(data.unmeasurable)}
          tone={data.unmeasurable > data.measured ? "warn" : "muted"}
        />
        <StateChip mark="◇" word="Series watched" value={String(data.series.length)} tone="muted" />
      </SectionVerdict>

      {/* THE TWO TRAILING PARAGRAPHS WENT ON 2026-08-25 and neither claim did.
          One defined a reading and now sits in the family strip's own notes;
          the other said why an unmeasurable poll is a gap, which is the chart's
          claim and is in the chart's. Both used to render under BOTH views, so
          a reader on the families table met a sentence about a line they were
          not looking at. */}
      {view === "series" ? (
        // The provider renders no element: a pointer on either figure draws
        // the same poll on both.
        <LinkedX>
          <Chart data={data} stamps={stamps} />
          {/* What the line's white space IS. The chart breaks at every gap and
              never bridges one, which is right and is a poor picture of its own
              breaks — on a thin watchlist the gaps are most of the record. */}
          <MeasurabilityStrip
            subject="poll"
            caption="What the record is made of: polls measured, against polls that could not be"
            marks={marksAtStamps(data.points, stamps)}
            link="index-polls"
          />
        </LinkedX>
      ) : (
        <>
          {/* THE RIDGE FIRST, THEN THE ROLL-UP. `IndexFamilies` rows on
              `series_ticker` — two of them on the live watchlist — so "by
              family" was a strip of two lengths. The families are the EVENTS,
              twenty-six of them, each its own ladder with its own history, and
              those are what the ridge draws. The two-row strip stays under it
              as the SERIES roll-up it always was, which is a different and
              smaller question rather than the same one badly. */}
          <FamilyRidge data={data} />
          <IndexFamilies data={data} />
          {/* The gateway's notes, folded 2026-08-25. Rendered raw they sat
              BETWEEN the table and the sentence defining what a reading is —
              so a variable number of machine paragraphs pushed the one
              definition on the view further down the page the more the engine
              had to say. Provenance goes behind a summary that counts it. */}
          {data.notes.length ? (
            <details className="disclosure">
              <summary>{`What the engine noted about this read, ${data.notes.length} ${data.notes.length === 1 ? "note" : "notes"}`}</summary>
              {data.notes.map((note, index) => (
                <p key={`${index}-${note}`}>{note}</p>
              ))}
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}
