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

import { linearScale } from "@/components/chart-kit";
import Figure, { Plot } from "@/components/coherence/Figure";
import { placeDriftFigure } from "@/components/portfolio/drift-label";
import { pct, signedPct, usd } from "@/lib/format";
import type { RebalanceTrade, TargetWeight } from "@/lib/portfolio-risk";

/**
 * The right margin holds `100.0% → 100.0% capped`, the longest string the
 * gutter can be asked to draw: 22 glyphs in the mono face. The 2026-08-24
 * diagram lift moved that annotation off the 10px tick floor — it is words,
 * not an axis numeral — onto the 12px rung, so the width was re-derived
 * rather than re-guessed: 22 × 12 × MONO_ADVANCE_EM (0.605) = 159.7px, plus
 * the 10px offset from `plotRight` = 169.7px. 150 held the same string at
 * 10px (133.1 + 10 = 143.1) and would now clip it, which is exactly the
 * defect the old note records.
 */
const MARGIN = { top: 14, right: 174, bottom: 34, left: 88 };
const ROW = 26;
/** Between a bar end and its figure. */
const LABEL_GAP = 5;
/**
 * Monospace advance of the drift figure, which is drawn at the 13px series
 * rung (2026-08-24: it was 12, and this constant still read 6 — the advance
 * for 10px — so every figure was measured a fifth narrower than it draws).
 * 13 × MONO_ADVANCE_EM (0.605) = 7.865, rounded up. This decides only whether
 * a label fits in the gutter beside its bar, so an approximation is the right
 * tool — measuring text properly would mean a DOM round trip per row per
 * render — but it must approximate the size that ships.
 */
const GLYPH = 7.9;

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
  if (!targets.length) return null;

  const tradeBySymbol = new Map(trades.map((trade) => [trade.symbol, trade]));

  const height = MARGIN.top + targets.length * ROW + MARGIN.bottom;
  /**
   * The extent the data actually needs, then a little more.
   *
   * Without the headroom the largest bar ends exactly on the plot edge, because
   * `linearScale` maps the domain onto the full range — so its figure had
   * nowhere to sit and printed over the row's other labels. An axis that
   * extends slightly past its largest value is also simply how a bar chart is
   * drawn; the floor at `driftBand * 1.25` still does its own job underneath.
   */
  const extent = Math.max(driftBand * 1.25, ...targets.map((t) => Math.abs(t.drift)));
  const domain = extent * 1.08;
  const base = MARGIN.top + targets.length * ROW;
  const outside = targets.filter((t) => Math.abs(t.drift) >= driftBand).length;
  const clipped = targets.filter((t) => t.clippedBy).map((t) => t.symbol);
  /**
   * A book of one. Every method solves the same weight, so the chart, the band
   * slider and the model selector above are all genuinely inert — and a panel
   * that is inert for a good reason looks identical to one that is broken. The
   * arithmetic gets printed rather than asserted.
   */
  const only = targets.length === 1 ? targets[0] : null;
  const onTarget = only != null && Math.abs(only.drift) < 1e-9;

  return (
    <>
      {/* Through `Figure` and `Plot` since 2026-08-26: each bar's drift was
          written into a `<title>`, reachable with a mouse and by nothing else.
          `Plot` walks the marks; `Figure` puts the live region outside the
          `role="img"` wrapper, where a presentational subtree cannot. */}
      <Figure
        caption="Drift from target weight, as a share of gross"
        ariaLabel={
          `Drift from target weight for ${targets.length} positions, as a share of current gross. `
          + `${outside} sit outside the ${pct(driftBand, 0)} band and would be traded. `
          + `The same figures are in the table below.`
        }
        reading="Zero is the target, not the middle of the data: the domain is symmetric about it, so a book that is drifted one way cannot be drawn looking balanced."
        missing={unbalancedSum == null ? null : `Weights sum to ${pct(unbalancedSum, 1)}, so trades are withheld rather than sized against a book that does not balance.`}
      >
        <Plot height={height} minWidth={320}>
          {(measured) => {
            const plotRight = Math.max(MARGIN.left + 60, measured - MARGIN.right);
            const x = linearScale(-domain, domain, MARGIN.left, plotRight);
            return (
              <>
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

          // Beyond the bar end where there is room, back at the axis where
          // there is not. `drift-label.ts` carries the rule and the bug it
          // closes; keeping it out here is what lets the geometry be asserted.
          const figure = signedPct(target.drift, 1);
          const placed = placeDriftFigure({
            end: x(target.drift),
            zero: x(0),
            up,
            figureWidth: figure.length * GLYPH,
            gap: LABEL_GAP,
            plotLeft: MARGIN.left,
            plotRight,
          });

          return (
            <g key={target.symbol}>
              <text x={MARGIN.left - 8} y={barY + 9} textAnchor="end" fontSize={14}
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
                x={placed.x}
                y={barY + 9.5}
                textAnchor={placed.anchor}
                fontSize={13}
                fontFamily="var(--mono)"
                fill={inside ? "var(--text-muted)" : "var(--text-primary)"}
              >
                {figure}
              </text>

              {/* Right margin: only where the two denominators agree. */}
              <text x={plotRight + 10} y={barY + 9.5} fontSize={12} fontFamily="var(--mono)"
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
        <text x={MARGIN.left} y={base + 20} fontSize={12} fill="var(--text-secondary)">
          trim
        </text>
        <text x={plotRight} y={base + 20} textAnchor="end" fontSize={12}
          fill="var(--text-secondary)">
          add
        </text>
        <text x={x(0)} y={base + 20} textAnchor="middle" fontSize={12}
          fill="var(--text-muted)" fontFamily="var(--mono)">
          on target
        </text>
        <text x={x(driftBand)} y={MARGIN.top - 6} textAnchor="middle" fontSize={12}
          fill="var(--text-muted)" fontFamily="var(--mono)">
          ±{pct(driftBand, 0)} band
        </text>

        {unbalancedSum != null && (
          <text x={x(0)} y={base + 32} textAnchor="middle" fontSize={12}
            fill="var(--status-warning)">
            trades withheld — weights sum to {pct(unbalancedSum, 1)}
          </text>
        )}
              </>
            );
          }}
        </Plot>
      </Figure>

      {/* The three rules, quoting the band on screen now, so moving the slider
          rewrites the legend along with the bars. */}
      <ul className="legend drift-legend">
        <li>
          <i aria-hidden style={{ background: "var(--diverging-pos)" }} />
          <span>
            <strong>Add.</strong> Target at least {pct(driftBand, 0)} of gross{" "}
            <em>above</em> the position. On a <strong>short</strong> that trade is a{" "}
            <span className="num">SELL</span>.
          </span>
        </li>
        <li>
          <i aria-hidden style={{ background: "var(--diverging-neg)" }} />
          <span>
            <strong>Trim.</strong> Target at least {pct(driftBand, 0)} of gross{" "}
            <em>below</em> the position. On a short that trade is a{" "}
            <span className="num">BUY</span>.
          </span>
        </li>
        <li>
          <i aria-hidden style={{ background: "var(--text-muted)" }} />
          <span>
            <strong>Left alone.</strong> Inside ±{pct(driftBand, 0)}, so no trade:{" "}
            <span className="num">{targets.length - outside}</span> of{" "}
            <span className="num">{targets.length}</span>{" "}
            {targets.length - outside === 1 ? "position" : "positions"}.
          </span>
        </li>
      </ul>

      {/* The unit survives the fold: the legend directly above already says
          "of gross". What folds is the formula and the worked reading — a
          definition, consulted once. The two paragraphs below are statuses
          about named positions and stay out of it. */}
      <details className="disclosure">
        <summary>What is a drift bar measured against?</summary>
        <p className="research-note">
          Drift is{" "}
          <span className="num">(target notional − current notional) ÷ gross before</span> — a share
          of the <strong>whole book</strong>, not of the position, so a bar reading{" "}
          {pct(driftBand, 0)} on a name twice that size means moving half of it.
        </p>
      </details>

      {clipped.length > 0 && (
        <p className="research-note">
          {clipped.join(", ")} {clipped.length === 1 ? "carries" : "carry"} a{" "}
          <span className="num">capped</span> marker: the target hit that symbol&apos;s own
          notional limit. A capped position can still sit grey inside the band.
        </p>
      )}

      {only && (
        <p className="research-note">
          <strong>One position, so nothing here can move.</strong> A single-asset book is 100% of
          itself under every method, so the model selector changes nothing.
          {onTarget ? (
            <>
              {" "}Drift is{" "}
              <span className="num">
                ({usd(only.targetNotional)} − {usd(only.currentNotional)}) ÷{" "}
                {usd(only.currentNotional)} = 0
              </span>
              , drawn as a hairline: a measured zero, not an omission.
            </>
          ) : (
            <>
              {" "}A risk limit clipped its target, so the drift is the distance to that cap.
            </>
          )}
        </p>
      )}
    </>
  );
}
