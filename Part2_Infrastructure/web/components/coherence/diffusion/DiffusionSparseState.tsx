"use client";

/**
 * The measurement contract that remains drawable before a sample exists.
 *
 * It never places a result. Boxes name the input, estimator and output; the
 * lower rail names the native scale. A sample marker is shown only as a count,
 * so an unavailable read cannot collapse into nought and n=1 cannot look like
 * a curve. Rich-data figures replace this structure once their own gate clears.
 */

import { useId } from "react";

import { Badge } from "@/components/ui/badge";

interface SparseSpec {
  readonly steps: readonly [string, string, string];
  readonly axis: readonly string[];
  readonly gates?: readonly { at: number; label: string }[];
}

export const DIFFUSION_SPARSE_SPECS = {
  absorption: { steps: ["stage path", "terminal ratio", "absorbed fraction"], axis: ["1m", "2m", "5m", "10m", "15m", "30m"] },
  paths: { steps: ["stage return", "noise-floor gate", "measured path"], axis: ["statement", "press conference"] },
  floor: { steps: ["terminal move", "2σ signal floor", "accepted / refused"], axis: ["0σ", "2σ floor", "terminal σ"] },
  control: { steps: ["event clock", "matched no-news", "control rank"], axis: ["0th", "50th", "100th percentile"] },
  clocks: { steps: ["resolved stage", "two rank clocks", "rank movement"], axis: ["wall clock", "volatility clock"] },
  meetings: { steps: ["decision pair", "stage half-life", "meeting ledger"], axis: ["statement", "+30m", "conference", "+30m terminal"] },
  calendar: { steps: ["issuer timestamp", "stage return", "calendar mark"], axis: ["earlier", "decision time", "later"] },
  survival: {
    steps: ["closed episode", "lifetime ordering", "survival curve"],
    axis: ["opened", "half still open", "closed"],
    gates: [{ at: 2, label: "curve" }, { at: 8, label: "median" }],
  },
  episodes: { steps: ["index poll", "certification gate", "episode tape"], axis: ["coherent", "distance", "certified violation"] },
  effects: { steps: ["meeting statistic", "shuffled null", "effect verdict"], axis: ["−t", "null band", "+t"] },
  matrix: { steps: ["relationship", "stage comparison", "evidence matrix"], axis: ["statement", "paired", "conference"] },
} as const satisfies Record<string, SparseSpec>;

export type DiffusionSparseKind = keyof typeof DIFFUSION_SPARSE_SPECS;
const NODE_X = [26, 270, 514] as const;

export function sampleStateLabel(sampleCount: number | null): string {
  return sampleCount == null ? "sample unavailable" : `n ${sampleCount}`;
}

export default function DiffusionSparseState({ kind, sampleCount, reason }: {
  kind: DiffusionSparseKind;
  sampleCount: number | null;
  reason: string;
}) {
  const rawId = useId();
  const hatchId = `diff-sparse-${rawId.replace(/:/g, "")}`;
  const spec: SparseSpec = DIFFUSION_SPARSE_SPECS[kind];
  const state = sampleCount == null ? "unavailable" : sampleCount === 0 ? "zero" : "partial";
  const axisDenominator = Math.max(1, spec.axis.length - 1);

  return (
    <div className="diff-sparse" data-sample-state={state}>
      <svg className="diff-sparse__svg" viewBox="0 0 720 166" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <defs>
          <pattern id={hatchId} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="7" className="diff-sparse__hatch" />
          </pattern>
        </defs>

        {NODE_X.slice(0, 2).map((x, index) => (
          <g key={x}>
            <line className="diff-sparse__edge" x1={x + 180} x2={NODE_X[index + 1] - 10} y1="58" y2="58" />
            <path className="diff-sparse__arrow" d={`M${NODE_X[index + 1] - 17},53l7,5-7,5`} />
          </g>
        ))}

        {spec.steps.map((step, index) => (
          <g key={step}>
            <rect
              className="diff-sparse__node"
              x={NODE_X[index]}
              y="31"
              width="180"
              height="54"
              rx="7"
              style={index === 1 ? { fill: `url(#${hatchId})` } : undefined}
            />
            <text className="diff-sparse__ordinal" x={NODE_X[index] + 12} y="48">0{index + 1}</text>
            <text className="diff-sparse__label" x={NODE_X[index] + 90} y="68" textAnchor="middle">{step}</text>
          </g>
        ))}

        <line className="diff-sparse__axis" x1="34" x2="686" y1="123" y2="123" />
        {spec.axis.map((word, index) => {
          const x = 34 + (index / axisDenominator) * 652;
          return (
            <g key={word}>
              <line className="diff-sparse__tick" x1={x} x2={x} y1="118" y2="128" />
              <text className="diff-sparse__tickword" x={x} y="145" textAnchor={index === 0 ? "start" : index === axisDenominator ? "end" : "middle"}>
                {word}
              </text>
            </g>
          );
        })}
        {spec.gates?.map((gate, index) => (
          <text key={gate.label} className="diff-sparse__gate" x={510 + index * 88} y="108">
            {`n≥${gate.at} ${gate.label}`}
          </text>
        ))}
      </svg>
      <p className="diff-sparse__reason">
        <Badge variant={state === "unavailable" ? "secondary" : "outline"}>{sampleStateLabel(sampleCount)}</Badge>
        <span>{reason}</span>
      </p>
    </div>
  );
}
