"use client";

/**
 * Every measured path, including the 159 the noise floor refused.
 *
 * THE ABSORPTION CURVE IS A MEAN OF NORMALISED FRACTIONS, and this is its
 * denominator. `absorbed(h) = ar(h) / ar(T*)`, so the curve above shows the
 * SHAPE of the average approach and can say nothing about how big any move was,
 * how much the cross-section spreads, or how often a path overshoots and comes
 * back. All three are in `abnormal_return`, which was on the wire and drawn
 * nowhere.
 *
 * WHY IT DRAWS THE REFUSED RUNS. `_cell()` never consults the noise gate — the
 * gate lands afterwards in `signal_state` — so a refused run carries a complete
 * measured path, and every other consumer on this tab opens by filtering
 * `signal_state === "ok"`. Live: 248 runs, 89 accepted, 159 refused, and all
 * 159 refused ones carry a full six-point path. `StageBars` COUNTS the refused;
 * it cannot show that they are the flat ones. This can, which is what turns
 * "most decisions move neither stage two sigmas" from an assertion into
 * something a reader can check.
 *
 * TWO PANELS, NOT ONE AXIS. Statement and press conference on the same
 * gridlines and the same bps scale, so they are comparable, but never
 * overplotted — 248 paths in one box is a smear. The `ClockAgreement` idiom.
 *
 * THE AXIS IS UNCLIPPED AND IT IS A SIGNED LOG, and the second is what makes
 * the first affordable. 52 of 534 absorbed values exceed 1.0 and the largest is
 * 3.22, while both mean curves top out at exactly 1.0000 — so overshoot is real
 * and invisible everywhere else here, and a clamp would draw a path that
 * overshot as one that merely arrived.
 *
 * But |bps| runs median 29.7, p99 477, max 891 — a thirty-fold tail — so a
 * LINEAR unclipped axis is unreadable too: the median half of the sample lands
 * inside 3.3% of the height. `sign(v)*log10(1+|v|)` keeps every path and every
 * sign, puts zero at zero, and gives the median 50% of the half-axis. Honest
 * and legible were not in tension; a linear scale just made them look it.
 */

import { memo } from "react";

import {
  type RunPath,
  bpsBound,
  brokenPath,
  logTicks,
  quartileBand,
  runPaths,
  signedLog,
} from "@/lib/coherence/return-path";
import Figure, { FigureEmpty, Plot } from "../Figure";
import type { AbsorptionRead } from "./types";

const HEIGHT = 300;
const MARGIN = { top: 40, right: 14, bottom: 34, left: 58 };
const ALLEY = 26;
const STAGE_WORD: Record<string, string> = { release: "statement", call: "press conference" };

/** One stage's panel: band behind, paths over it, zero rule through it. */
function Panel({ paths, horizons, bound, left, width, label }: {
  paths: readonly RunPath[];
  horizons: readonly string[];
  bound: number;
  left: number;
  width: number;
  label: string;
}) {
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (index: number) =>
    left + (horizons.length < 2 ? width / 2 : (index / (horizons.length - 1)) * width);
  // Signed log, not linear: the tail is thirty times the median, so a linear
  // axis puts half the sample inside 3% of the height wherever it is bounded.
  const unit = signedLog(bound) || 1;
  const y = (bps: number) => MARGIN.top + plotH / 2 - (signedLog(bps) / unit) * (plotH / 2);
  const band = quartileBand(paths, horizons.length);
  const refused = paths.filter((path) => !path.cleared).length;

  const bandPath = band.length
    ? band.map((point, i) => `${i ? "L" : "M"}${x(point.index)},${y(point.high)}`).join("")
      + band.slice().reverse().map((point) => `L${x(point.index)},${y(point.low)}`).join("")
      + "Z"
    : "";

  return (
    <g>
      <text className="coh-svg-note" x={left + width / 2} y={MARGIN.top - 22} textAnchor="middle">
        {label}
      </text>

      {bandPath ? (
        <path className="diff-fan__band" d={bandPath}>
          <title>{`${label}: the middle half of ${paths.length} paths at each horizon`}</title>
        </path>
      ) : null}

      <line className="diff-fan__zero" x1={left} x2={left + width} y1={y(0)} y2={y(0)}>
        <title>{`${label}: zero — no abnormal move at all`}</title>
      </line>

      {paths.map((path) => {
        const d = brokenPath(path.points, x, y);
        const last = path.points[path.points.length - 1];
        const overshot = path.peak != null && path.peak > 1;
        // Under ~90 characters: `Readout` truncates past the plot width.
        const title = `${path.source} ${path.symbol}: ${last.bps >= 0 ? "+" : ""}`
          + `${Math.round(last.bps)} bps`
          + (path.cleared ? (overshot ? ", overshoots and returns" : "") : " — below the noise floor");
        return (
          <g className="diff-fan__run" key={path.key}>
            {/* A transparent fat stroke under the hairline. A 1.1px line is not
                a pointer target, and `use-mark-readout` takes the title's
                PARENT as the mark — so the group is the mark and the hit path
                is what a pointer actually lands on. */}
            <path className="diff-fan__hit" d={d} fill="none">
              <title>{title}</title>
            </path>
            <path
              className={`diff-fan__line diff-fan__line--${path.stage}${path.cleared ? "" : " is-refused"}`}
              d={d}
              fill="none"
            />
          </g>
        );
      })}

      {horizons.map((horizon, index) => (
        <text key={horizon} className="coh-ladder__tick" x={x(index)}
              y={HEIGHT - MARGIN.bottom + 16} textAnchor="middle">
          {horizon}
        </text>
      ))}

      {refused ? (
        <text className="coh-svg-note" x={left + width / 2} y={HEIGHT - 6} textAnchor="middle">
          {refused} of {paths.length} below the floor
        </text>
      ) : null}
    </g>
  );
}

function ReturnFan({ read }: { read: AbsorptionRead }) {
  const paths = runPaths(read.runs, read.horizons);
  const bound = bpsBound(paths);
  const stages = ["release", "call"].filter((stage) => paths.some((path) => path.stage === stage));
  const refused = paths.filter((path) => !path.cleared).length;
  const overshoots = paths.filter((path) => path.peak != null && path.peak > 1).length;
  // "The refused ones are the flat ones" is a claim about this figure, so it is
  // computed from the drawn paths rather than asserted. Live: 49 bps against
  // 170. Reported as medians because the tail is thirty-fold and a mean of it
  // would describe the outliers instead.
  const peakOf = (cleared: boolean) => {
    const peaks = paths
      .filter((path) => path.cleared === cleared)
      .map((path) => Math.max(...path.points.map((point) => Math.abs(point.bps))))
      .sort((a, b) => a - b);
    return peaks.length ? Math.round(peaks[Math.floor((peaks.length - 1) / 2)]) : null;
  };
  const refusedPeak = peakOf(false);
  const clearedPeak = peakOf(true);
  // The horizons that resolved for nobody, named from the wire's own reason
  // rather than paraphrased.
  const unresolved = read.horizons.filter(
    (horizon) => !read.runs.some((run) =>
      run.cells.some((cell) => cell.horizon === horizon && cell.abnormal_return != null)),
  );
  const why = read.runs
    .flatMap((run) => run.cells)
    .find((cell) => cell.abnormal_return == null && cell.reason)?.reason ?? null;

  return (
    <Figure
      caption="Every measured path in basis points, including the ones the noise floor refused"
      ariaLabel={`Abnormal return against horizon for ${paths.length} runs over ${stages.length} stages, `
        + `${refused} of them below the noise floor, on an axis reaching ${Math.round(bound)} basis points`}
      reading={refused && refusedPeak != null && clearedPeak != null
        ? `The floor refused ${refused} of ${paths.length} runs, and every one still carries a measured `
          + `path — they are the flat ones, peaking at a median ${refusedPeak} bps against ${clearedPeak}. `
          + "Drawn, so the floor can be checked rather than taken."
        : refused
          ? `The floor refused ${refused} of ${paths.length} runs, and every one still carries a measured path.`
          : "Every run cleared the noise floor."}
      missing={[
        // The wire's own reason, and it ends without a full stop — so one is
        // added here rather than letting the join run it into the next clause,
        // which is what it did on the first build.
        unresolved.length && why
          ? `${unresolved.join(" and ")} resolve for no run: ${why.replace(/\.?$/, ".")}`
          : null,
        overshoots
          ? `${overshoots} paths pass fully absorbed and come back. The axis is not clipped, because a `
            + "clamp would draw an overshoot as a path that merely arrived."
          : null,
      ].filter(Boolean).join(" ") || null}
    >
      {paths.length ? (
        <Plot height={HEIGHT} minWidth={560}>
          {(width) => {
            const span = Math.max(80, width - MARGIN.left - MARGIN.right);
            const panelW = stages.length > 1 ? (span - ALLEY) / stages.length : span;
            return (
              <>
                <text className="coh-svg-label" x={0} y={MARGIN.top - 22}>abnormal return</text>
                {/* Decade ticks, labelled in bps. The scale is a drawing
                    device; a reader should not have to decode it. */}
                {logTicks(bound).flatMap((tick) => {
                  const unit = signedLog(bound) || 1;
                  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
                  const at = (bps: number) =>
                    MARGIN.top + plotH / 2 - (signedLog(bps) / unit) * (plotH / 2);
                  const rows = tick === 0 ? [0] : [tick, -tick];
                  return rows.map((value) => (
                    <text key={value} className="coh-ladder__tick" x={0} y={at(value) + 3}>
                      {value > 0 ? `+${value}` : value}
                    </text>
                  ));
                })}
                <text className="coh-ladder__tick" x={0} y={HEIGHT - MARGIN.bottom + 16}>bps</text>
                {stages.map((stage, index) => (
                  <Panel
                    key={stage}
                    paths={paths.filter((path) => path.stage === stage)}
                    horizons={read.horizons}
                    bound={bound}
                    left={MARGIN.left + index * (panelW + ALLEY)}
                    width={panelW}
                    label={STAGE_WORD[stage] ?? stage}
                  />
                ))}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No run carries a measured abnormal return yet." />
      )}
    </Figure>
  );
}

export default memo(ReturnFan);
