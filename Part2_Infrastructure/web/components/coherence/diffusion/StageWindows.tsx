"use client";

/**
 * The two measurement windows, with every measured meeting drawn onto them.
 *
 * WHAT THIS REPLACED. `StageTimeline` drew the same two windows from two
 * constants — a 30-minute gap and a 30-minute terminal — with 21 marks that
 * restated those constants and nothing from the ledger. It drew four of the
 * wire's eight horizons and silently omitted the two that never resolve. Its
 * headline read "30 minutes apart, set by the issuer" as a universal.
 *
 * WHAT THE LEDGER SAYS. Measured on the live payload before this was written:
 *
 *     124 meeting×symbol pairs with both stages
 *     the gap is 30 minutes on 120 of them — and 60 on 4
 *     the four: fed:2020-03-03 and fed:2020-03-15, the March 2020 emergency cuts
 *     every one of the 89 measured half-lives lands INSIDE its own window
 *       statement          n=42   median 166 s   max 1,212 s
 *       press conference   n=47   median 728 s   max 1,402 s
 *     12 statement runs resolved BEFORE the first measurable bar
 *
 * So the constant was true of the scheduled calendar and false of the ledger
 * it sat above, and the windows it drew empty had 89 marks to carry. This
 * figure draws them. The gap is read per meeting, so the two cuts draw their
 * conference window an hour out rather than being normalised into a thirty
 * they did not have. The horizons are the wire's own, all eight, with the two
 * that resolve for nobody hatched and titled with the source's reason — the
 * same rule `HorizonResolution` states one figure down.
 *
 * NOTHING IS INVENTED. A refused stage draws no half-life; it is counted in the
 * header. A run whose half-life resolved before the first bar is drawn as a
 * distinct mark at that bar, because "faster than we can see" is a fact about
 * the resolution and not a position on the axis. When the ledger is empty the
 * figure falls back to the two constants and says so.
 */

import { memo } from "react";

import Figure, { Plot } from "../Figure";
import { STAGE_GAP_MIN, STAGE_TERMINAL_MIN, STAGE_WORD } from "./AbsorptionGate";
import type { AbsorptionRead, StageRun } from "./types";

const HEIGHT = 236;
const MARGIN = { top: 46, right: 18, bottom: 34, left: 18 };
const BAND_H = 22;
const ROW_GAP = 64;
const STAGE_MARK: Record<string, string> = { release: "●", call: "▲" };

/** A horizon label such as "5m" or "30s", in minutes. */
function horizonMinutes(label: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(s|m)$/.exec(label);
  if (!match) return null;
  const value = Number(match[1]);
  return match[2] === "s" ? value / 60 : value;
}

interface Meeting {
  readonly ref: string;
  readonly symbol: string;
  readonly release: StageRun | null;
  readonly call: StageRun | null;
  /** Minutes from the statement to the press conference, from the two `t0`s. */
  readonly gapMin: number | null;
}

/** The runs paired back into meetings, one per (source_ref, symbol). */
function meetingsOf(runs: readonly StageRun[]): Meeting[] {
  const byKey = new Map<string, { release: StageRun | null; call: StageRun | null }>();
  for (const run of runs) {
    // A space, and visibly so: this key was `${ref}\0${symbol}` until 2026-08-26 —
    // a NUL byte as the separator, which made the file binary to `grep` and
    // `file` — and neither field can carry a space, so the split is exact.
    const key = `${run.source_ref} ${run.symbol}`;
    const pair = byKey.get(key) ?? { release: null, call: null };
    if (run.stage === "release") pair.release = run;
    else pair.call = run;
    byKey.set(key, pair);
  }
  return [...byKey.entries()].map(([key, pair]) => {
    const [ref, symbol] = key.split(" ");
    const a = pair.release ? Date.parse(pair.release.t0) : NaN;
    const b = pair.call ? Date.parse(pair.call.t0) : NaN;
    const gapMin = Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 60_000) : null;
    return { ref, symbol, release: pair.release, call: pair.call, gapMin };
  });
}

function StageWindows({ read }: { read: AbsorptionRead | null }) {
  const meetings = read ? meetingsOf(read.runs) : [];
  const horizons = read?.horizons ?? [];
  const terminal = STAGE_TERMINAL_MIN;

  // The gap the ledger actually has, meeting by meeting. `STAGE_GAP_MIN` is the
  // fallback for an empty ledger and for a meeting missing a stage, never a
  // value that overrides one the wire carries.
  const gaps = meetings.map((meeting) => meeting.gapMin).filter((gap): gap is number => gap != null);
  const usual = gaps.length
    ? [...gaps].sort((a, b) => gaps.filter((g) => g === b).length - gaps.filter((g) => g === a).length)[0]
    : STAGE_GAP_MIN;
  const unusual = meetings.filter((meeting) => meeting.gapMin != null && meeting.gapMin !== usual);
  const widest = Math.max(usual, ...gaps);
  const span = widest + terminal;

  const measured = (stage: "release" | "call") =>
    meetings.map((meeting) => meeting[stage]).filter((run): run is StageRun => run?.half_life_s != null);
  const early = (stage: "release" | "call") =>
    meetings.map((meeting) => meeting[stage])
      .filter((run): run is StageRun => run?.half_life_state === "at_or_before_first");
  const median = (values: number[]) => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };
  const releaseHl = measured("release").map((run) => run.half_life_s as number);
  const callHl = measured("call").map((run) => run.half_life_s as number);
  const unresolved = horizons.filter((horizon) =>
    !read?.runs.some((run) => run.cells.some((cell) => cell.horizon === horizon && cell.abnormal_return != null)));
  const why = read?.runs.flatMap((run) => run.cells).find((cell) => cell.abnormal_return == null && cell.reason)?.reason ?? null;
  const total = meetings.length;

  return (
    <Figure
      caption="Why a rate decision can be measured twice, and where each measured one finished"
      ariaLabel={total
        ? `Two ${terminal}-minute windows for ${total} meeting-and-symbol pairs, ${usual} minutes apart on `
          + `${total - unusual.length} of them and ${unusual.map((m) => m.gapMin).join(" or ")} on ${unusual.length}, `
          + `with ${releaseHl.length} statement and ${callHl.length} press-conference half-lives drawn inside`
        : `Two ${terminal}-minute windows ${STAGE_GAP_MIN} minutes apart, from the constants the ledger is measured against`}
      reading={total
        ? "Equal windows, each measured from its own start, so a difference between them is absorption and "
          + "not the grid."
          // NOT `?? 0`: a median of nothing is not a median of nought, and this
          // printed "median 0s" on a stage with no drawn half-life.
          + (median(releaseHl) != null ? ` Statement half-lives crowd its start (median ${Math.round(median(releaseHl) as number)}s)` : "")
          + (median(callHl) != null ? `; the conference's spread across its window (median ${Math.round(median(callHl) as number)}s).` : ".")
        : "Equal windows, each measured from its own start, so a difference between them is absorption and not the grid."}
      missing={[
        unusual.length
          ? `${unusual.length} pair${unusual.length === 1 ? "" : "s"} — ${[...new Set(unusual.map((m) => m.ref))].join(", ")} — `
            + `sit ${[...new Set(unusual.map((m) => m.gapMin))].join(" and ")} minutes apart, not ${usual}: unscheduled `
            + "decisions whose press conference came later, drawn where they were rather than moved."
          : null,
        early("release").length
          ? `${early("release").length} statement runs had halved before the first measurable bar; they are marked `
            + "at that bar, which is the resolution limit, not their half-life."
          : null,
        // The 1s/30s reason is NOT repeated here: the horizon ladder one figure
        // below states it, and each band's own title carries the wire's words.
        // Said twice on one view it read as two different facts.
      ].filter(Boolean).join(" ") || null}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const compact = width < 480;
          const usable = width - MARGIN.left - MARGIN.right;
          const x = (minutes: number) => MARGIN.left + (minutes / span) * usable;
          const rowY = (index: number) => MARGIN.top + 22 + index * ROW_GAP;
          const firstMeasured = horizons.map(horizonMinutes).find((m) => m != null && !unresolved.includes(horizons[horizons.map(horizonMinutes).indexOf(m)]));

          const band = (stage: "release" | "call", start: number, row: number) => {
            const word = STAGE_WORD[stage] ?? stage;
            const runs = measured(stage);
            const hl = runs.map((run) => run.half_life_s as number);
            const med = median(hl);
            return (
              <g key={`${stage}-${start}`}>
                <rect className={`diff-win__band diff-win__band--${stage}`} x={x(start)} y={row - BAND_H / 2}
                      width={Math.max(2, x(start + terminal) - x(start))} height={BAND_H}>
                  <title>{`${word}: ${terminal} minutes, measured from its own start at +${start}m`}</title>
                </rect>
                {unresolved.length && firstMeasured != null ? (
                  <rect className="diff-win__unmeasured" x={x(start)} y={row - BAND_H / 2}
                        width={Math.max(1, x(start + firstMeasured) - x(start))} height={BAND_H}>
                    <title>{`${word}: ${unresolved.join(" and ")} resolve for no run — ${why ?? "never measured"}`}</title>
                  </rect>
                ) : null}
                {horizons.map((horizon) => {
                  const m = horizonMinutes(horizon);
                  return m == null || m > terminal ? null : (
                    <line key={horizon} className="diff-win__tick" x1={x(start + m)} x2={x(start + m)}
                          y1={row - BAND_H / 2} y2={row + BAND_H / 2} />
                  );
                })}
                {runs.map((run) => (
                  <line key={run.run_id} className={`diff-win__hl diff-win__hl--${stage}`}
                        x1={x(start + (run.half_life_s as number) / 60)} x2={x(start + (run.half_life_s as number) / 60)}
                        y1={row - BAND_H / 2 - 3} y2={row + BAND_H / 2 + 3}>
                    <title>{`${run.source_ref} ${run.symbol}: half absorbed in ${Math.round(run.half_life_s as number)}s`}</title>
                  </line>
                ))}
                {/* ONE MARK, NOT ONE PER RUN. Every early run sits at the same x
                    by definition — the first measurable bar — so twelve circles
                    there are twelve marks a pointer cannot tell apart and a
                    keyboard walks through as twelve identical stops. The count
                    is the fact; the title carries it and names the runs. */}
                {early(stage).length ? (
                  <g className="diff-win__earlygroup">
                    <circle className="diff-win__early" r={4}
                            cx={x(start + (firstMeasured ?? 1))} cy={row + BAND_H / 2 + 9}>
                      <title>
                        {`${early(stage).length} ${word} run${early(stage).length === 1 ? "" : "s"} halved before the first `
                          + `measurable bar: ${early(stage).slice(0, 4).map((run) => run.source_ref.replace("fed:", "")).join(", ")}`
                          + (early(stage).length > 4 ? ` and ${early(stage).length - 4} more` : "")}
                      </title>
                    </circle>
                    <text className="diff-win__earlycount" x={x(start + (firstMeasured ?? 1)) + 8} y={row + BAND_H / 2 + 17}>
                      {early(stage).length} before the first bar
                    </text>
                  </g>
                ) : null}
                {med != null ? (
                  <line className="diff-win__median" x1={x(start + med / 60)} x2={x(start + med / 60)}
                        y1={row - BAND_H / 2 - 3} y2={row + BAND_H / 2 + 3}>
                    <title>{`${word}: median half-life ${Math.round(med)}s over ${hl.length} measured`}</title>
                  </line>
                ) : null}
                <text className="diff-win__label" x={x(start) + 6} y={row - BAND_H / 2 - 7}>
                  <tspan aria-hidden="true">{STAGE_MARK[stage]}</tspan> {word}
                  {!compact && (hl.length ? ` — ${hl.length} measured` : total ? " — none cleared the floor" : "")}
                </text>
              </g>
            );
          };

          return (
            <>
              <text className="diff-win__label" x={x(0)} y={MARGIN.top - 26}>
                {compact
                  ? `${usual}m stage gap`
                  : total
                  ? `${usual} minutes apart on ${total - unusual.length} of ${total} pairs`
                    + (unusual.length ? `; ${[...new Set(unusual.map((m) => m.gapMin))].join(" and ")} on ${unusual.length}` : "")
                  : `${STAGE_GAP_MIN} minutes apart, set by the issuer`}
              </text>
              <line className="diff-win__gap" x1={x(0)} x2={x(usual)} y1={MARGIN.top - 12} y2={MARGIN.top - 12}>
                <title>{`${usual} minutes between the two stages on ${total - unusual.length} of ${total} pairs`}</title>
              </line>
              {band("release", 0, rowY(0))}
              {band("call", usual, rowY(1))}
              {/* One band per distinct gap, not one per pair: the four unusual
                  pairs are two meetings on two symbols at the same 60 minutes,
                  and four bands at one x read as one striped block that a
                  reader cannot count. The title names every meeting the band
                  stands for. */}
              {[...new Set(unusual.map((m) => m.gapMin as number))].map((gap, index) => {
                const on = unusual.filter((m) => m.gapMin === gap);
                const refs = [...new Set(on.map((m) => m.ref.replace("fed:", "")))];
                return (
                  <g key={gap}>
                    <rect className="diff-win__band diff-win__band--unusual" x={x(gap)}
                          y={rowY(1) + BAND_H / 2 + 12 + index * 12}
                          width={Math.max(2, x(gap + terminal) - x(gap))} height={7}>
                      <title>{`${on.length} pair${on.length === 1 ? "" : "s"} at +${gap}m — ${refs.join(", ")}: press conference an hour after the statement, unscheduled`}</title>
                    </rect>
                    <text className="diff-win__label" x={x(gap) - 6} y={rowY(1) + BAND_H / 2 + 18 + index * 12} textAnchor="end">
                      +{gap}m, {refs.length} meeting{refs.length === 1 ? "" : "s"}
                    </text>
                  </g>
                );
              })}
              <line className="diff-win__axis" x1={MARGIN.left} x2={width - MARGIN.right}
                    y1={HEIGHT - MARGIN.bottom + 6} y2={HEIGHT - MARGIN.bottom + 6} />
              {[0, usual, span].map((m) => (
                <text key={m} className="coh-ladder__tick" x={x(m)} y={HEIGHT - MARGIN.bottom + 20}
                      textAnchor={m === 0 ? "start" : m === span ? "end" : "middle"}>
                  +{m}m
                </text>
              ))}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

export default memo(StageWindows);
