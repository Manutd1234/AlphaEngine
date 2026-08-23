"use client";

/**
 * The mechanism, drawn once: an announcement that arrives in two stages.
 *
 * The premise the module rests on is exogenous separation. A rate decision is
 * published at 14:00 as a number a machine can read, and thirty minutes later
 * a person answers questions about it. Nobody chose that gap for this study;
 * the Federal Reserve did, and it is the same thirty minutes at every
 * scheduled meeting since January 2019. That is what makes the comparison a
 * natural experiment rather than a split someone picked.
 *
 * The drawing says three things a paragraph would take longer to: where each
 * stage's window starts, that both windows are the same length, and where the
 * horizons sit inside them. The horizon ticks are geometric, so they crowd
 * toward the start — which is where the statement's absorption happens and the
 * conference's does not.
 *
 * One user unit is one CSS pixel, as in `chart-kit`: a stretched unit box
 * would scale the labels horizontally and not vertically.
 */

import { useMeasuredWidth } from "@/components/chart-kit";

const HEIGHT = 172;
const MARGIN = { left: 16, right: 16, top: 40 };
const TICKS = [1 / 30, 5 / 30, 15 / 30, 1];
const TICK_LABEL = ["+1m", "+5m", "+15m", "+30m"];

export interface StageTimelineProps {
  gapMinutes: number;
  terminalMinutes: number;
  releaseLabel?: string;
  callLabel?: string;
  callKnown?: boolean;
}

export default function StageTimeline({
  gapMinutes,
  terminalMinutes,
  releaseLabel = "Statement",
  callLabel = "Press conference",
  callKnown = true,
}: StageTimelineProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const plot = Math.max(width, 360);
  const span = gapMinutes + terminalMinutes;
  const usable = plot - MARGIN.left - MARGIN.right;
  const x = (minutes: number) => MARGIN.left + (minutes / span) * usable;
  const releaseRow = MARGIN.top + 22;
  const callRow = MARGIN.top + 82;

  const band = (row: number, start: number, kind: string) => (
    <g>
      <rect x={x(start)} y={row - 11} width={Math.max(x(start + terminalMinutes) - x(start), 2)}
            height={22} className={`diff-time__band diff-time__band--${kind}`} />
      {TICKS.map((tick, index) => (
        <line key={TICK_LABEL[index]} x1={x(start + tick * terminalMinutes)}
              x2={x(start + tick * terminalMinutes)} y1={row - 11} y2={row + 11}
              className="diff-time__tick" />
      ))}
    </g>
  );

  return (
    <div ref={ref} className="diff-time__frame">
      <svg viewBox={`0 0 ${plot} ${HEIGHT}`} width="100%" height={HEIGHT} role="img"
           aria-label={`A rate decision in two stages: the statement, then the press conference `
             + `${gapMinutes} minutes later, each measured over its own ${terminalMinutes} minute window.`}>
        <line x1={x(0)} x2={x(gapMinutes)} y1={MARGIN.top - 20} y2={MARGIN.top - 20}
              className="diff-time__gap" />
        <text x={x(gapMinutes / 2)} y={MARGIN.top - 26} textAnchor="middle" fontSize={12}
              className="diff-time__label">
          {gapMinutes} minutes apart, set by the issuer
        </text>

        {band(releaseRow, 0, "release")}
        <circle cx={x(0)} cy={releaseRow} r={4} className="diff-time__node diff-time__node--release" />
        <text x={x(0) + 8} y={releaseRow - 16} fontSize={12} className="diff-time__label">
          <tspan aria-hidden="true">●</tspan> {releaseLabel}
        </text>

        {band(callRow, gapMinutes, callKnown ? "call" : "unknown")}
        <circle cx={x(gapMinutes)} cy={callRow} r={4}
                className={`diff-time__node diff-time__node--${callKnown ? "call" : "unknown"}`} />
        <text x={x(gapMinutes) + 8} y={callRow - 16} fontSize={12} className="diff-time__label">
          <tspan aria-hidden="true">{callKnown ? "▲" : "○"}</tspan> {callLabel}
          {callKnown ? "" : " — start not published"}
        </text>

        {TICKS.map((tick, index) => (
          <text key={TICK_LABEL[index]} x={x(tick * terminalMinutes)} y={HEIGHT - 8}
                textAnchor="middle" fontSize={10} className="diff-time__ticklabel">
            {TICK_LABEL[index]}
          </text>
        ))}
        <line x1={MARGIN.left} x2={plot - MARGIN.right} y1={HEIGHT - 24} y2={HEIGHT - 24}
              className="diff-time__axis" />
      </svg>
    </div>
  );
}
