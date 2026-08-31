"use client";

/**
 * The terminal tail against the book's actual drawdown-to-halt headroom.
 *
 * This does not replace the histogram: a gauge answers whether one tail
 * quantile clears the operating budget, while the histogram answers what the
 * simulated distribution looks like. Both read the same completed result.
 */

import { linearScale } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { mcUsd } from "@/components/risk/mc-degeneracy";
import { mcLossConfidences, type McDistributionResult } from "@/lib/mc-distribution";

export interface McTailGaugeModel {
  p95Loss: number;
  p99Loss: number;
  p95Magnitude: number;
  p99Magnitude: number;
  cushion: number;
  domain: number;
  breaches: boolean;
  remaining: number;
}

export function mcTailGaugeModel(
  result: Pick<McDistributionResult, "loss">,
  cushionUsd: number,
): McTailGaugeModel | null {
  const p95Loss = result.loss.p95;
  const p99Loss = result.loss.p99;
  if (![p95Loss, p99Loss, cushionUsd].every(Number.isFinite)) return null;
  const cushion = Math.max(0, cushionUsd);
  const p95Magnitude = Math.max(0, p95Loss);
  const p99Magnitude = Math.max(0, p99Loss);
  return {
    p95Loss,
    p99Loss,
    p95Magnitude,
    p99Magnitude,
    cushion,
    domain: Math.max(1, cushion, p95Magnitude, p99Magnitude) * 1.08,
    breaches: p95Loss > cushion,
    remaining: cushion - p95Loss,
  };
}

export default function McTailGauge({
  result,
  cushionUsd,
}: {
  result: McDistributionResult;
  cushionUsd: number;
}) {
  const model = mcTailGaugeModel(result, cushionUsd);
  if (!model) {
    return (
      <p className="muted">Tail gauge withheld: the loss or headroom figure is not finite.</p>
    );
  }
  const [, p95Confidence, p99Confidence] = mcLossConfidences(result);
  const reading = model.p95Loss < 0
    ? `The P${p95Confidence} terminal quantile ends in profit; ${mcUsd(model.cushion)} of halt headroom remains available.`
    : model.breaches
      ? `The P${p95Confidence} loss exceeds halt headroom by ${mcUsd(Math.abs(model.remaining))}.`
      : `The P${p95Confidence} loss leaves ${mcUsd(model.remaining)} of halt headroom.`;

  return (
    <div className="mc-tail-gauge">
      <Figure
        caption={`P${p95Confidence} terminal tail against halt headroom`}
        ariaLabel={`${mcUsd(model.p95Loss)} P${p95Confidence} terminal loss against ${mcUsd(model.cushion)} of drawdown-to-halt headroom; P${p99Confidence} loss ${mcUsd(model.p99Loss)}`}
        reading={reading}
      >
        <Plot height={154}>
          {(width) => {
            const left = 18;
            const right = Math.max(left + 40, width - 18);
            const x = linearScale(0, model.domain, left, right);
            const baseline = 82;
            return (
              <>
                <rect
                  x={left}
                  y={baseline - 12}
                  width={right - left}
                  height={24}
                  rx={4}
                  fill="var(--surface-2)"
                  stroke="var(--border)"
                >
                  <title>{`Gauge domain $0 to ${mcUsd(model.domain)}`}</title>
                </rect>
                <rect
                  x={left}
                  y={baseline - 12}
                  width={Math.max(model.p95Magnitude > 0 ? 1 : 0, x(model.p95Magnitude) - left)}
                  height={24}
                  rx={4}
                  fill={model.breaches ? "var(--status-critical)" : "var(--series-1)"}
                  opacity={0.82}
                >
                  <title>{`P${p95Confidence} terminal loss ${mcUsd(model.p95Loss)}`}</title>
                </rect>
                <line
                  x1={x(model.cushion)}
                  x2={x(model.cushion)}
                  y1={baseline - 26}
                  y2={baseline + 26}
                  stroke="var(--text-primary)"
                  strokeWidth={2}
                >
                  <title>{`Drawdown-to-halt headroom ${mcUsd(model.cushion)}`}</title>
                </line>
                <path
                  d={`M${x(model.p99Magnitude) - 5},${baseline - 18}L${x(model.p99Magnitude)},${baseline - 26}L${x(model.p99Magnitude) + 5},${baseline - 18}Z`}
                  fill="var(--critical-text)"
                >
                  <title>{`P${p99Confidence} terminal loss ${mcUsd(model.p99Loss)}`}</title>
                </path>
                <text x={left} y={baseline + 46} fontFamily="var(--mono)" fontSize={12} fill="var(--text-muted)">$0</text>
                <text x={right} y={baseline + 46} textAnchor="end" fontFamily="var(--mono)" fontSize={12} fill="var(--text-muted)">
                  {mcUsd(model.domain)}
                </text>
                <text x={x(model.cushion)} y={baseline - 34} textAnchor="middle" fontFamily="var(--mono)" fontSize={12} fill="var(--text-primary)">
                  halt {mcUsd(model.cushion)}
                </text>
              </>
            );
          }}
        </Plot>
      </Figure>
      <dl className="mc-tail-gauge__facts">
        <div><dt>{`P${p95Confidence} loss`}</dt><dd className="num">{mcUsd(model.p95Loss)}</dd></div>
        <div><dt>{`P${p99Confidence} loss`}</dt><dd className="num">{mcUsd(model.p99Loss)}</dd></div>
        <div><dt>{`Headroom after P${p95Confidence}`}</dt><dd className="num">{mcUsd(model.remaining)}</dd></div>
      </dl>
    </div>
  );
}
