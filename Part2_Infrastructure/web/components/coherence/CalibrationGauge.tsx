"use client";

/**
 * The settled score as a verdict, and the three things it refuses to call a pass.
 *
 * A GAUGE IS THE MOST DANGEROUS FIGURE ON THIS ENGINE, and it is worth saying
 * why before the code. It converts a number a reader has to think about into a
 * position on a dial they do not — and the settled score is exactly the number
 * that must not be read that way. On the live sample the `final_trade` engine
 * returns a skill of 0.99935238. Drawn without an argument, that is a needle
 * almost at the top of the dial. What it measures is how fast this exchange
 * converges on an answer already in plain sight, moments before settlement. It
 * is not foresight and it is not a pass.
 *
 * So this figure exists only with its refusals built in, and each is a different
 * way a good-looking number can be untrue:
 *
 *   ENGINE   `final_trade` renders as "not a forecast test" whatever the skill.
 *            `EngineBanner` makes that argument in prose directly above; a gauge
 *            that ignored it would contradict the thing it sits under.
 *   THIN     Too few settled markets is WITHHELD, not failed. Absence of
 *            evidence drawn at the bottom of a dial reads as evidence of
 *            absence.
 *   NULL     A skill the engine did not compute declines the needle and says so.
 *            `?? 0` here would turn "we do not know" into "no better than the
 *            base rate", which is a real reading on this axis and therefore the
 *            most misleading value available.
 *
 * THE AXIS IS SKILL, AND ZERO IS NOT THE FLOOR. Brier skill is the share of the
 * question's uncertainty these prices removed: one is perfect, zero is no better
 * than always quoting the base rate, and BELOW zero is worse than knowing
 * nothing but the base rate — which is a real outcome and is drawn. A dial that
 * put zero at the bottom would hide half the range that matters.
 *
 * Nothing means anything by colour alone: the verdict is a mark and a word, and
 * the sub-zero region carries its own label.
 */

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";
import { statValue } from "./ReliabilityDiagram";

const HEIGHT = 96;
const MARGIN = { left: 16, right: 16 };
/** The drawn range: worse-than-nothing through perfect. */
const LOW = -0.5;
const HIGH = 1;

interface Verdict {
  mark: string;
  word: string;
  reading: string;
  /** False whenever the needle must not be drawn at all. */
  drawn: boolean;
}

/**
 * What this score is allowed to be called, in priority order.
 *
 * The engine check comes FIRST and outranks a good number, because it is a
 * statement about what the number measures rather than about how large it is.
 */
export function verdictOf(data: CoherenceCalibration, skill: number | null): Verdict {
  if (data.engine === "final_trade") {
    return {
      mark: "▲",
      word: "Not a forecast test",
      // The banner above this gauge makes the last-traded-prices argument in
      // full, and `CalibrationScore`'s own header records that the caveat is
      // said ONCE, there. This was it said a second time forty lines below, on
      // the same view, in the same words. What is left is the conclusion the
      // dial itself has to carry, since a reader can arrive at a needle without
      // having read the banner.
      reading: "Convergence speed, not foresight — however high the needle goes.",
      drawn: true,
    };
  }
  if (skill == null) {
    return {
      mark: "◌",
      word: "No score",
      reading: "No skill was returned, so there is no needle — a zero here would be a measurement, not an absence of one.",
      drawn: false,
    };
  }
  if (data.thin) {
    return {
      mark: "◌",
      word: "Withheld, thin sample",
      reading: `Too few settled markets to conclude from; the ${skill.toFixed(6)} is drawn faintly rather than as a verdict.`,
      drawn: true,
    };
  }
  if (skill > 0) {
    return {
      mark: "✓",
      word: "Better than the base rate",
      reading: `These prices removed ${(skill * 100).toFixed(2)}% of the question's uncertainty, scored against what settled.`,
      drawn: true,
    };
  }
  return {
    mark: "✕",
    word: "Worse than knowing nothing",
    reading: "Worse than always quoting the base rate would have been — a real outcome, reported rather than floored at zero.",
    drawn: true,
  };
}

export default function CalibrationGauge({ data }: { data: CoherenceCalibration }) {
  const skill = statValue(data.skill);
  const verdict = verdictOf(data, skill);

  const clamped = skill == null ? null : Math.min(HIGH, Math.max(LOW, skill));

  return (
    <Figure
      caption="The settled score as a verdict, on the axis where zero already means something"
      ariaLabel={`Brier skill gauge from ${LOW} to ${HIGH}; the verdict is ${verdict.word}`}
      reading={verdict.reading}
      missing={
        skill != null && skill > HIGH
          ? `The skill is ${skill.toFixed(6)}, past the drawn range, so the needle sits at the end of the track rather than off it.`
          : "Skill = 1 − Brier / Uncertainty: the share of the questions’ own variance these prices removed."
      }
      notes={[
        "One is perfect, zero is no better than always quoting the base rate, and below zero is worse than that — "
        + "which is why the axis is not nought-to-one and the sub-zero region is drawn.",
      ]}
    >
      {/* INSIDE `Plot` SINCE 2026-08-26. This measured its own width and drew
          into a bare `<svg>`, which meant its four facts — including the
          needle's own verdict — were `<title>` tooltips: reachable with a
          mouse and by nothing else. Not from a keyboard, not on a touch
          screen, not through a screen reader. `Plot` walks them, speaks them
          into the live region `Figure` already renders outside its
          `role="img"`, and costs this file its own measurement code. */}
      <Plot height={HEIGHT}>
        {(width) => {
          // The scale belongs to the measured width, so it is built where the
          // width is known rather than closed over from outside it.
          const trackWidth = Math.max(1, width - MARGIN.left - MARGIN.right);
          const x = (value: number) => MARGIN.left + ((value - LOW) / (HIGH - LOW)) * trackWidth;
          return (
          <>
          {/* The sub-zero region, drawn and labelled. It is half the reason the
              axis is not 0-to-1: worse than the base rate is a real place to be. */}
          <rect x={x(LOW)} y={30} width={x(0) - x(LOW)} height={20} className="coh-gauge__worse">
            <title>Worse than always quoting the base rate.</title>
          </rect>
          <rect x={x(0)} y={30} width={x(HIGH) - x(0)} height={20} className="coh-gauge__track">
            <title>Better than the base rate, up to a perfect score at one.</title>
          </rect>

          <line x1={x(0)} x2={x(0)} y1={24} y2={56} className="coh-gauge__zero">
            <title>Zero: exactly as good as always quoting the base rate.</title>
          </line>

          {verdict.drawn && clamped != null ? (
            <line
              x1={x(clamped)}
              x2={x(clamped)}
              y1={20}
              y2={60}
              className={data.thin ? "coh-gauge__needle is-thin" : "coh-gauge__needle"}
            >
              <title>{`Skill ${skill?.toFixed(8)} — ${verdict.word}`}</title>
            </line>
          ) : null}

          <text x={x(LOW)} y={70} className="coh-form__note">worse than nothing</text>
          <text x={x(0)} y={22} textAnchor="middle" className="coh-form__note">0</text>
          <text x={x(HIGH)} y={70} textAnchor="end" className="coh-form__note">perfect</text>
          <text x={MARGIN.left} y={16} className="coh-svg-note">
            {verdict.mark} {verdict.word}
          </text>
          </>
          );
        }}
      </Plot>
    </Figure>
  );
}
