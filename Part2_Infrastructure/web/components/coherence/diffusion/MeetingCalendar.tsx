"use client";

/**
 * When the sample is — the event axis an event study did not have.
 *
 * `StageRun.t0` has been on the wire since the arm shipped and was read by
 * nothing: 248 timestamps, 124 distinct, 62 meetings from 2019-01-30 to
 * 2026-07-29. Every other figure here plots a horizon, a rank or a percentile;
 * not one of them plots a DATE. So a reader could take away a half-life, a
 * ratio and a null without ever learning that the ledger runs over eight years,
 * or where inside those years the 89 runs that cleared the floor actually sit.
 *
 * That is the question this answers and nothing else can: **if the runs that
 * cleared the floor cluster in one regime, every finding on this tab is a
 * finding about that regime.**
 *
 * A MARK IS A RUN, AND SHAPE CARRIES THE STAGE. `●` statement, `▲` press
 * conference, hollow when the noise floor refused it — so stage is in the
 * glyph, the gate is in the fill, and neither rests on a hue. Two symbols share
 * each meeting and each stage, so they are nudged apart by a fixed offset that
 * carries no time; the `missing` note says so, because a drawing device a
 * reader could mistake for data has to be declared.
 *
 * THE RUG IS EMITTED FIRST, and that is a keyboard decision rather than a
 * drawing one. `use-mark-readout` walks marks in DOCUMENT order, so `Home`
 * lands on the earliest MEETING and the first 62 presses are a meeting-level
 * tour of the whole study before any run-level detail. This is the largest
 * instrument on the tab and that ordering is what makes it walkable.
 *
 * Signed log on the y axis, for the reason `return-path.ts` sets out at length:
 * terminal moves run a median 53 bps against a maximum of 891, so a linear axis
 * puts half the sample in a sliver.
 */

import { memo, useState } from "react";

import { signedLog } from "@/lib/coherence/return-path";
import Figure, { Plot } from "../Figure";
import DiffusionSparseState from "./DiffusionSparseState";
import type { AbsorptionRead, StageRun } from "./types";

const HEIGHT = 300;
const MARGIN = { top: 38, right: 18, bottom: 56, left: 56 };
const RUG_DROP = 12;
const NUDGE = 2.5;
const STAGE_WORD: Record<string, string> = { release: "statement", call: "press conference" };
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

export type CalendarSample = "all" | "cleared" | "refused";

export function filterCalendarRuns(runs: readonly StageRun[], sample: CalendarSample): StageRun[] {
  if (sample === "all") return [...runs];
  return runs.filter((run) => sample === "cleared"
    ? run.signal_state === "ok"
    : run.signal_state !== "ok");
}

/** A meeting is a source_ref: one decision, whatever it produced. */
function meetingsOf(runs: readonly StageRun[]) {
  const byRef = new Map<string, { at: number; runs: StageRun[] }>();
  for (const run of runs) {
    const at = Date.parse(run.t0);
    if (Number.isNaN(at)) continue;
    const found = byRef.get(run.source_ref);
    if (found) found.runs.push(run);
    else byRef.set(run.source_ref, { at, runs: [run] });
  }
  return [...byRef.entries()]
    .map(([ref, value]) => ({ ref, ...value }))
    .sort((a, b) => a.at - b.at);
}

function MeetingCalendar({ read }: { read: AbsorptionRead | null }) {
  const [sample, setSample] = useState<CalendarSample>("all");
  if (!read?.runs.length) {
    const reason = read
      ? `The ${read.backend ?? "unreported"} API snapshot observed at ${read.observed_at} contains no recorded meeting. `
        + "The connected boxes show how a timestamp becomes a calendar mark; they do not invent one."
      : "The meeting ledger is not readable yet. The connected boxes show the calendar dependency without placing a date or return.";
    return (
      <Figure
        caption="Every decision on the ledger, and the move each stage produced"
        ariaLabel="No meeting timestamp or return is drawn"
        missing="No date or return is placed without a recorded timestamp."
      >
        <DiffusionSparseState kind="calendar" sampleCount={read ? 0 : null} reason={reason} />
      </Figure>
    );
  }
  const meetings = meetingsOf(read.runs);
  if (!meetings.length) return (
    <Figure
      caption="Every decision on the ledger, and the move each stage produced"
      ariaLabel="No meeting timestamp or return is drawn"
      missing="No date or return is placed without a recorded timestamp."
    >
      <DiffusionSparseState
        kind="calendar"
        sampleCount={0}
        reason={`${read.runs.length} recorded run${read.runs.length === 1 ? " carries" : "s carry"} no valid meeting timestamp, so no date is placed.`}
      />
    </Figure>
  );
  const stamps = meetings.map((meeting) => meeting.at);
  const first = Math.min(...stamps);
  const last = Math.max(...stamps);
  const bound = Math.max(1, ...read.runs.map((run) =>
    Math.abs((run.terminal_return ?? 0) * 10_000)));
  const cleared = read.runs.filter((run) => run.signal_state === "ok").length;
  const visibleRuns = filterCalendarRuns(read.runs, sample);
  const symbols = [...new Set(read.runs.map((run) => run.symbol))].sort();
  const years = Array.from(
    { length: new Date(last).getUTCFullYear() - new Date(first).getUTCFullYear() + 1 },
    (unused, index) => new Date(first).getUTCFullYear() + index,
  );

  return (
    <Figure
      caption="Every decision on the ledger, and the move each stage produced"
      ariaLabel={`${meetings.length} meetings from ${new Date(first).toISOString().slice(0, 10)} to `
        + `${new Date(last).toISOString().slice(0, 10)}, ${read.runs.length} runs, `
        + `${cleared} of them clearing the noise floor`}
      reading={`${meetings.length} decisions over ${years.length} years, and ${cleared} of `
        + `${read.runs.length} runs cleared the floor. A filled mark is a stage the floor accepted: `
        + "if they cluster in one stretch, every finding on this tab is a finding about that stretch."}
      missing={symbols.length > 1
        ? `${symbols.join(" and ")} share every meeting, so their marks are nudged apart by a fixed `
          + "amount that carries no time — the horizontal offset between two marks at one decision is a "
          + "drawing device, not a gap between them."
        : null}
    >
      <div className="diff-lens diff-lens--inside" role="group" aria-label="Calendar sample">
        {(["all", "cleared", "refused"] as const).map((option) => (
          <button key={option} type="button" aria-pressed={sample === option}
                  onClick={() => setSample(option)}>
            {option === "all" ? "All runs" : option === "cleared" ? "Cleared floor" : "Refused"}
          </button>
        ))}
        <span className="diff-lens__readout" aria-live="polite">{visibleRuns.length} shown</span>
      </div>
      {meetings.length ? (
        <Plot height={HEIGHT}>
          {(width) => {
            const span = Math.max(120, width - MARGIN.left - MARGIN.right);
            const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
            const x = (at: number) =>
              MARGIN.left + (last === first ? span / 2 : ((at - first) / (last - first)) * span);
            const unit = signedLog(bound) || 1;
            const y = (bps: number) =>
              MARGIN.top + plotH / 2 - (signedLog(bps) / unit) * (plotH / 2);
            const floor = MARGIN.top + plotH;

            return (
              <>
                <text className="coh-svg-label" x={0} y={MARGIN.top - 14}>terminal move</text>
                <text className="coh-ladder__tick" x={0} y={MARGIN.top + 4}>+{Math.round(bound)} bps</text>
                <text className="coh-ladder__tick" x={0} y={floor + 4}>−{Math.round(bound)}</text>

                <line className="diff-fan__zero" x1={MARGIN.left} x2={MARGIN.left + span}
                      y1={y(0)} y2={y(0)} />

                {/* FIRST IN DOCUMENT ORDER, on purpose — see the header. One
                    tick per decision, so a meeting whose every run sits near
                    zero still shows that it happened. */}
                {meetings.map((meeting) => {
                  const accepted = meeting.runs.filter((run) => run.signal_state === "ok").length;
                  return (
                    <line
                      key={meeting.ref}
                      className="diff-cal__rug"
                      x1={x(meeting.at)}
                      x2={x(meeting.at)}
                      y1={floor + 6}
                      y2={floor + 6 + RUG_DROP}
                    >
                      <title>
                        {`${new Date(meeting.at).toISOString().slice(0, 10)}: `
                          + `${meeting.runs.length} stages read, ${accepted} cleared the floor`}
                      </title>
                    </line>
                  );
                })}

                {years.map((year) => {
                  const at = Date.UTC(year, 0, 1);
                  if (at < first || at > last) return null;
                  return (
                    <g key={year}>
                      <line className="diff-cal__year" x1={x(at)} x2={x(at)}
                            y1={MARGIN.top} y2={floor} />
                      <text className="coh-ladder__tick" x={x(at)} y={HEIGHT - 8} textAnchor="middle">
                        {year}
                      </text>
                    </g>
                  );
                })}

                {visibleRuns.map((run) => {
                  const at = Date.parse(run.t0);
                  if (Number.isNaN(at) || run.terminal_return == null) return null;
                  const bps = run.terminal_return * 10_000;
                  const nudge = (symbols.indexOf(run.symbol) - (symbols.length - 1) / 2) * NUDGE * 2;
                  const accepted = run.signal_state === "ok";
                  return (
                    <circle
                      key={run.run_id}
                      className={`diff-cal__dot diff-cal__dot--${run.stage}${accepted ? "" : " is-refused"}`}
                      cx={x(at) + nudge}
                      cy={y(bps)}
                      r={3.2}
                    >
                      <title>
                        {`${STAGE_MARK[run.stage] ?? ""} ${new Date(at).toISOString().slice(0, 10)} `
                          + `${STAGE_WORD[run.stage] ?? run.stage} ${run.symbol}: `
                          + `${bps >= 0 ? "+" : ""}${Math.round(bps)} bps`
                          + (accepted ? "" : " — below the floor")}
                      </title>
                    </circle>
                  );
                })}
              </>
            );
          }}
        </Plot>
      ) : (
        <DiffusionSparseState kind="calendar" sampleCount={0} reason="No meeting carries a timestamp yet, so no date is placed." />
      )}
    </Figure>
  );
}

export default memo(MeetingCalendar);
