"use client";

/**
 * How far each position sits from its target, and whether that is far enough
 * to be worth paying to fix.
 *
 * THE PANEL'S ARGUMENT, DRAWN. `AllocationPanel` says in prose that correcting
 * a small deviation costs more in fees and slippage than the deviation costs in
 * risk. The drift band was the number that made the argument, and it lived
 * behind a slider as an invisible threshold. Shading it turns the slider into
 * direct manipulation: rows visibly cross in and out as it moves, and the set
 * outside the band is exactly `rebalanceTrades`' output.
 *
 * ONE QUANTITY, NOT TWO — and this is a correctness constraint rather than a
 * layout preference. Read `proposeAllocation`:
 *
 *     currentWeight = currentNotional / grossBefore
 *     targetWeight  = targetNotional  / budget           // budget = min(gross, cap)
 *     drift         = (targetNotional - currentNotional) / grossBefore
 *
 * So `drift === targetWeight - currentWeight` only while the gross cap is
 * slack. The moment the cap binds, the two denominators part company — and that
 * is precisely the state a rebalance chart is most likely to be read in. A
 * dumbbell drawn from current to target would therefore have a span that does
 * not equal the drift bar beside it, on the same axis. So this plots `drift`,
 * which is self-consistent, and suppresses the `current → target` annotation
 * whenever the cap is what makes them disagree.
 *
 * The axis is SYMMETRIC always. A diverging axis with unequal arms misreports
 * which side is larger, and the `driftBand * 1.25` floor stops the band filling
 * the plot when everything is inside it — so "nothing to do" still looks like
 * nothing to do.
 */

import { linearScale, useMeasuredWidth } from "@/components/chart-kit";
import { pct, signedPct, usd } from "@/lib/format";
import type { RebalanceTrade, TargetWeight } from "@/lib/portfolio-risk";

const MARGIN = { top: 14, right: 116, bottom: 34, left: 88 };
const ROW = 26;

export default function DriftBars({
  targets,
  driftBand,
  trades,
  capBinds,
  unbalancedSum,
}: {
  targets: TargetWeight[];
  driftBand: number;
  trades: RebalanceTrade[];
  /** The gross cap is below current gross, so current and target disagree. */
  capBinds: boolean;
  /** Weight sum when a manual override does not balance; null when it does. */
  unbalancedSum: number | null;
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(620);
  if (!targets.length) return null;

  const tradeBySymbol = new Map(trades.map((trade) => [trade.symbol, trade]));

  const height = MARGIN.top + targets.length * ROW + MARGIN.bottom;
  const plotRight = Math.max(MARGIN.left + 60, width - MARGIN.right);
  const domain = Math.max(driftBand * 1.25, ...targets.map((t) => Math.abs(t.drift)));
  const x = linearScale(-domain, domain, MARGIN.left, plotRight);
  const base = MARGIN.top + targets.length * ROW;
  const outside = targets.filter((t) => Math.abs(t.drift) >= driftBand).length;

  return (
    <div ref={ref}>
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${Math.max(width, 320)} ${height}`}
        role="img"
        aria-label={
          `Drift from target weight for ${targets.length} positions, as a share of current gross. `
          + `${outside} of them sit outside the ${pct(driftBand, 0)} band and would be traded; `
          + `the rest are left alone. The same figures are in the table below.`
        }
      >
        {/* The band. Filled when it means something — when it does not balance,
            an outline, because no trade set is being proposed to sit inside it. */}
        <rect
          x={x(-driftBand)}
          y={MARGIN.top - 4}
          width={Math.max(1, x(driftBand) - x(-driftBand))}
          height={base - MARGIN.top + 8}
          fill={unbalancedSum == null ? "var(--surface-2)" : "none"}
          stroke={unbalancedSum == null ? "none" : "var(--border)"}
          strokeDasharray={unbalancedSum == null ? undefined : "3 3"}
        />
        {/* Hairlines as well as the fill: the fill collapses in forced colours,
            and a stroked line is what the high-contrast rule reaches. */}
        {[-driftBand, driftBand].map((edge) => (
          <line key={edge} x1={x(edge)} y1={MARGIN.top - 4} x2={x(edge)} y2={base + 4}
            stroke="var(--grid)" shapeRendering="crispEdges" />
        ))}
        <line x1={x(0)} y1={MARGIN.top - 4} x2={x(0)} y2={base + 4}
          stroke="var(--axis)" shapeRendering="crispEdges" />

        {targets.map((target, index) => {
          const y = MARGIN.top + index * ROW;
          const barY = y + (ROW - 12) / 2;
          const inside = Math.abs(target.drift) < driftBand;
          const up = target.drift > 0;
          const trade = tradeBySymbol.get(target.symbol);
          // A minimum extent, so a position exactly at target draws a hairline
          // rather than nothing: measured zero and absent are different claims.
          const span = Math.max(1, Math.abs(x(target.drift) - x(0)));

          return (
            <g key={target.symbol}>
              <text x={MARGIN.left - 8} y={barY + 9} textAnchor="end" fontSize={11}
                fill="var(--text-secondary)" fontWeight={650}>
                {target.symbol}
              </text>

              <rect
                x={up ? x(0) : x(0) - span}
                y={barY}
                width={span}
                height={12}
                rx={2}
                fill={inside
                  ? "var(--text-muted)"
                  : up ? "var(--diverging-pos)" : "var(--diverging-neg)"}
              >
                <title>
                  {`${target.symbol} — ${signedPct(target.drift, 1)} of gross`
                    + (inside ? ", inside the band, left alone" : "")
                    + (trade ? `. ${trade.side} ${usd(trade.notional)}` : "")
                    + (target.clippedBy ? `. Capped by ${target.clippedBy}` : "")}
                </title>
              </rect>

              <text
                x={up ? x(target.drift) + 5 : x(target.drift) - 5}
                y={barY + 9.5}
                textAnchor={up ? "start" : "end"}
                fontSize={10}
                fontFamily="var(--mono)"
                fill={inside ? "var(--text-muted)" : "var(--text-primary)"}
              >
                {signedPct(target.drift, 1)}
              </text>

              {/* Right margin: only where the two denominators agree. */}
              <text x={plotRight + 10} y={barY + 9.5} fontSize={9.5} fontFamily="var(--mono)"
                fill="var(--text-muted)">
                {capBinds
                  ? "—"
                  : `${pct(target.currentWeight, 1)} → ${pct(target.targetWeight, 1)}`}
                {target.clippedBy ? " capped" : ""}
              </text>
            </g>
          );
        })}

        {/* The words carry direction, not the hue. */}
        <text x={MARGIN.left} y={base + 20} fontSize={9.5} fill="var(--text-secondary)">
          trim
        </text>
        <text x={plotRight} y={base + 20} textAnchor="end" fontSize={9.5}
          fill="var(--text-secondary)">
          add
        </text>
        <text x={x(0)} y={base + 20} textAnchor="middle" fontSize={9.5}
          fill="var(--text-muted)" fontFamily="var(--mono)">
          on target
        </text>
        <text x={x(driftBand)} y={MARGIN.top - 6} textAnchor="middle" fontSize={9}
          fill="var(--text-muted)" fontFamily="var(--mono)">
          ±{pct(driftBand, 0)} band
        </text>

        {unbalancedSum != null && (
          <text x={x(0)} y={base + 32} textAnchor="middle" fontSize={9.5}
            fill="var(--status-warning)">
            trades withheld — weights sum to {pct(unbalancedSum, 1)}
          </text>
        )}
      </svg>

      <ul className="legend">
        <li><i aria-hidden style={{ background: "var(--diverging-pos)" }} /> Add to reach target</li>
        <li><i aria-hidden style={{ background: "var(--diverging-neg)" }} /> Trim to reach target</li>
        <li><i aria-hidden style={{ background: "var(--text-muted)" }} /> Inside the band — left alone</li>
      </ul>
    </div>
  );
}
