"use client";

/**
 * Where the day's P&L came from.
 *
 * The equity curve shows the *path*; this shows the *composition*. A single day
 * P&L figure cannot answer "did we earn this or did the market hand it to us",
 * and on a long crypto book those are usually very different amounts.
 *
 * Three things are deliberate:
 *
 *  - **Plotted in P&L space against a zero rule, not in equity space.** At $10m
 *    equity a $142k day is 1.4%: drawn against the equity axis every bar is a
 *    sliver and the chart says nothing.
 *  - **The middle leg is called "residual", never "alpha".** It holds genuine
 *    idiosyncratic moves *and* intraday trading P&L, beta-estimation error, and
 *    the P&L of every position whose beta could not be measured. Calling that
 *    alpha would be an opinion wearing arithmetic's clothes.
 *  - **A withheld leg is drawn as an empty dashed column, not a zero bar.** A leg
 *    measured at zero and a leg nobody could measure are opposite claims, and the
 *    1px floor on real bars keeps a genuine zero visible as a hairline.
 */

import { useState } from "react";

import {
  DEFAULT_MARGIN,
  Grid,
  extent,
  linearScale,
  ticks,
  useMeasuredWidth,
} from "@/components/chart-kit";
import { compact, pct, usd } from "@/lib/format";
import type { PnlLeg, PnlWaterfall as Waterfall } from "@/lib/pnl-attribution";

interface PnlWaterfallProps {
  waterfall: Waterfall | null;
  generated: boolean;
}

const HEIGHT = 260;

const BASIS_WORD: Record<PnlLeg["basis"], string> = {
  measured: "measured",
  audited: "audited",
  derived: "derived",
  generated: "generated",
  withheld: "not measurable",
};

const BASIS_SOURCE: Record<PnlLeg["basis"], string> = {
  measured: "Daily bars + measured beta",
  audited: "Audit log, this session only",
  derived: "Arithmetic on the legs above",
  generated: "Sandbox fixture",
  withheld: "—",
};

function money(value: number): string {
  return `${value < 0 ? "−" : "+"}$${compact(Math.abs(value))}`;
}

export default function PnlWaterfall({ waterfall, generated }: PnlWaterfallProps) {
  const [hover, setHover] = useState<string | null>(null);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();

  if (!waterfall) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Session attribution</span>
            <h2>P&amp;L waterfall</h2>
          </div>
        </div>
        <p className="sub">
          No book to decompose yet. The split needs a session&apos;s P&amp;L, the positions behind
          it and a reference return.
        </p>
      </div>
    );
  }

  const { legs, dayPnl } = waterfall;

  const margin = { ...DEFAULT_MARGIN, left: 66, right: 20, top: 18, bottom: 50 };
  const x0 = margin.left;
  const x1 = Math.max(x0 + 120, width - margin.right);
  const yTop = margin.top;
  const yBot = HEIGHT - margin.bottom;

  // The total is anchored to zero rather than stacked: it is the sum, not
  // another step, and drawing it as a step would double-count it.
  const columns: Array<{ key: string; label: string; leg: PnlLeg | null }> = [
    ...legs.map((leg) => ({ key: leg.key, label: leg.label, leg })),
    { key: "total", label: "Day P&L", leg: null },
  ];

  const step = (x1 - x0) / columns.length;
  const barW = Math.min(64, step * 0.62);

  let cumulative = 0;
  const bars = columns.map((column, index) => {
    const isTotal = column.leg === null;
    const value = column.leg?.value ?? null;
    const from = isTotal ? 0 : cumulative;
    const to = isTotal ? dayPnl : cumulative + (value ?? 0);
    if (!isTotal && value !== null) cumulative = to;
    return {
      ...column,
      isTotal,
      value: isTotal ? dayPnl : value,
      withheld: !isTotal && value === null,
      from,
      to,
      cx: x0 + step * index + step / 2,
    };
  });

  const [lo, hi] = extent([0, dayPnl, ...bars.flatMap((b) => [b.from, b.to])]);
  const pad = (hi - lo) * 0.14 || Math.abs(dayPnl) * 0.14 || 1;
  const yScale = linearScale(lo - pad, hi + pad, yBot, yTop);
  const yTicks = ticks(lo - pad, hi + pad, 4);
  const zeroY = yScale(0);

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">
            {generated ? "Sandbox book (generated)" : "Session attribution"}
          </span>
          <h2>P&amp;L waterfall</h2>
        </div>
        <span className={dayPnl >= 0 ? "pos" : "neg"}>{usd(dayPnl, 0)} day</span>
      </div>

      <div className="legend" aria-hidden>
        <span><i style={{ background: "var(--diverging-pos)" }} /> gain</span>
        <span><i style={{ background: "var(--diverging-neg)" }} /> cost</span>
        <span><i style={{ background: "var(--text-muted)" }} /> total</span>
        <span><i className="is-withheld" /> not measurable</span>
      </div>

      <div ref={ref} className="pnl-waterfall">
        <svg
          width="100%"
          height={HEIGHT}
          viewBox={`0 0 ${Math.max(width, 320)} ${HEIGHT}`}
          role="img"
          aria-label={
            `Day P&L of ${usd(dayPnl, 0)} split into ${legs.map((l) => l.label).join(", ")}.`
            + ` ${legs.filter((l) => l.value === null).length} leg(s) could not be measured.`
            + " The same figures are in the table below."
          }
        >
          <Grid yTicks={yTicks} yScale={yScale} x0={x0} x1={x1} format={money} />

          {/* The zero rule, not an axis: every step is measured from it. */}
          <line
            x1={x0}
            x2={x1}
            y1={zeroY}
            y2={zeroY}
            stroke="var(--axis)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />

          {/* Connectors before the bars so the bars sit on top of them. */}
          {bars.slice(0, -1).map((bar, i) => {
            const next = bars[i + 1];
            if (bar.withheld || next.withheld || next.isTotal) return null;
            return (
              <line
                key={`link-${bar.key}`}
                x1={bar.cx + barW / 2}
                x2={next.cx - barW / 2}
                y1={yScale(bar.to)}
                y2={yScale(next.from)}
                stroke="var(--grid)"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
            );
          })}

          {bars.map((bar) => {
            const top = Math.min(yScale(bar.from), yScale(bar.to));
            // The 1px floor is what keeps a leg measured at exactly zero visible
            // as a hairline — distinguishable from a withheld leg, which draws no
            // filled rectangle at all.
            const height = Math.max(1, Math.abs(yScale(bar.to) - yScale(bar.from)));
            const fill = bar.isTotal
              // Not --series-1: it is the same hex as --diverging-pos in both
              // themes, so the total would be indistinguishable from a gain.
              ? "var(--text-muted)"
              : (bar.value ?? 0) >= 0
                ? "var(--diverging-pos)"
                : "var(--diverging-neg)";

            if (bar.withheld) {
              return (
                <g key={bar.key}>
                  <rect
                    x={bar.cx - barW / 2}
                    y={yTop}
                    width={barW}
                    height={yBot - yTop}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    rx={2}
                  >
                    <title>{`${bar.label}: ${bar.leg?.note ?? "not measurable"}`}</title>
                  </rect>
                  <text
                    x={bar.cx}
                    y={zeroY - 8}
                    textAnchor="middle"
                    fontSize={12}
                    fill="var(--text-muted)"
                    fontFamily="var(--mono)"
                  >
                    n/a
                  </text>
                </g>
              );
            }

            return (
              <g
                key={bar.key}
                onPointerEnter={() => setHover(bar.key)}
                onPointerLeave={() => setHover(null)}
              >
                <rect
                  x={bar.cx - barW / 2}
                  y={top}
                  width={barW}
                  height={height}
                  rx={2}
                  fill={fill}
                  opacity={hover && hover !== bar.key ? 0.45 : 1}
                >
                  <title>{`${bar.label}: ${money(bar.value ?? 0)} — ${bar.leg?.note ?? "the four legs above, added up"}`}</title>
                </rect>
                <text
                  x={bar.cx}
                  y={top - 6 < yTop + 10 ? top + height + 13 : top - 6}
                  textAnchor="middle"
                  fontSize={12.5}
                  fill="var(--text-primary)"
                  fontFamily="var(--mono)"
                >
                  {money(bar.value ?? 0)}
                </text>
              </g>
            );
          })}

          {/* Hand-written labels: XAxis is index-based over a continuous series
              and drops any candidate within minGap of one already placed, and a
              dropped label on a five-column waterfall is a missing leg. */}
          {bars.map((bar) => (
            <g key={`label-${bar.key}`} aria-hidden>
              <text
                x={bar.cx}
                y={yBot + 16}
                textAnchor="middle"
                fontSize={13}
                fill="var(--text-secondary)"
              >
                {bar.label}
              </text>
              <text
                x={bar.cx}
                y={yBot + 30}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {bar.isTotal ? "sum" : BASIS_WORD[bar.leg!.basis]}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* One light-mode categorical slot sits below 3:1 against the surface, so
          the palette obliges a non-colour reading of the same figures. The table
          is also where the caveats live in words rather than as a shape. */}
      <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Each leg of the day&apos;s P&amp;L, its basis, and why any missing leg is missing.
          </caption>
          <thead>
            <tr>
              <th scope="col">Leg</th>
              <th scope="col">Amount</th>
              <th scope="col">Basis</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {legs.map((leg) => (
              <tr key={leg.key} className={hover === leg.key ? "is-best" : undefined}>
                <th scope="row">{leg.label}</th>
                <td className={`num ${leg.value == null ? "muted" : leg.value >= 0 ? "pos" : "neg"}`}>
                  {leg.value == null ? "—" : usd(leg.value, 0)}
                </td>
                <td>
                  <span aria-hidden>{leg.value == null ? "○" : "●"}</span> {BASIS_WORD[leg.basis]}
                </td>
                <td className="muted">{BASIS_SOURCE[leg.basis]}</td>
              </tr>
            ))}
            <tr className="is-best">
              <th scope="row">Day P&amp;L</th>
              <td className={`num ${dayPnl >= 0 ? "pos" : "neg"}`}>{usd(dayPnl, 0)}</td>
              <td>
                <span aria-hidden>{waterfall.complete ? "●" : "○"}</span>{" "}
                {waterfall.complete ? "reconciles" : "partial"}
              </td>
              <td className="muted">
                {waterfall.startEquity ? `from ${usd(waterfall.startEquity, 0)}` : "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* A definition of a leg the chart already draws, names and basis-marks,
          and which the bar's own <title> repeats. The anti-alpha guard is done
          by the leg's NAME, which no fold touches. */}
      <details className="disclosure">
        <summary>What lands in the leg that is left over</summary>
        <p className="research-note">
          {legs.find((leg) => leg.key === "residual" || leg.key === "unattributed")?.note}
        </p>
      </details>

      {waterfall.unmeasuredSymbols.length > 0 && (
        <p className="research-note">
          No beta for {waterfall.unmeasuredSymbols.join(", ")}, so the market leg excludes them and
          is understated by whatever they moved; their P&amp;L lands in the residual.
        </p>
      )}

      {waterfall.slippageIsLowerBound && (
        <p className="research-note">
          Some fills this session carry no measured slippage, so the slippage leg is a{" "}
          <strong>lower bound</strong> on what execution cost.
        </p>
      )}

      {waterfall.carriedMarkToMarket != null && Math.abs(waterfall.carriedMarkToMarket) > 1 && (
        <p className="research-note">
          Day P&amp;L differs from realised plus unrealised by {usd(waterfall.carriedMarkToMarket, 0)}:
          mark-to-market carried in on positions opened before this session. Reported, not drawn as
          a leg.
        </p>
      )}

      {/* Gated on the market leg existing, not only on the reference pair being
          present. The lib nulls the pair on every withheld path, so this is
          belt-and-braces — but the sentence below asserts a measured beta
          attribution, and a paragraph that can outlive the leg it describes is
          the kind of caption a reader trusts precisely because it is usually
          right. */}
      {legs.some((leg) => leg.key === "market" && leg.value !== null)
        && waterfall.referenceReturn != null && waterfall.referenceSymbol && (
        <details className="disclosure">
          <summary>
            Which move the market leg is measured against, and when it is not measured at all
          </summary>
          <p className="research-note">
            The market leg uses {waterfall.referenceSymbol} at {pct(waterfall.referenceReturn, 2)} as
            the reference move, through each position&apos;s measured beta.{" "}
            {generated
              ? "In the sandbox that move is supplied, not measured, so no generated P&L is attributed to a real market move."
              : `Measured on the daily bar covering the gateway's session, withheld when the newest bar does not.`}
          </p>
        </details>
      )}
    </div>
  );
}
