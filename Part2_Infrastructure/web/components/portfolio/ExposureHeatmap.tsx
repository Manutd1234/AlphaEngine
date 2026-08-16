"use client";

/**
 * Where the book's weight sits, and where it is pressed against a limit.
 *
 * TWO MEASURES, NOT ONE, because they disagree usefully. A position can be a
 * small share of gross and still be at 96% of its own symbol limit, and that is
 * precisely the row a reader is hunting for — collapsing to a single number
 * hides it behind the large positions.
 *
 * THE CHART PLOTS UTILISATION ONLY, and share of gross rides along as a printed
 * number. They are both fractions but they have different denominators, and
 * "40% of gross" has no meaningful full — putting them on one axis is the mild
 * form of the dual-axis error. Utilisation is the one quantity here with a
 * DEFINED 100%, which is what makes a bar chart the right shape for it: the
 * axis ends at the limit, so the picture is "how much room is left" rather than
 * "how big is this". Share of gross is already drawn three times on this tab
 * (the positions meter, the allocation donut, the target-weight column); this
 * is the only place limit pressure is drawn at all.
 *
 * The founding point survives in the ordering: rank by utilisation and the rows
 * stop agreeing with size, which is the disagreement worth seeing.
 *
 * The table below is kept, not replaced. It is the only place a withheld limit
 * is legible as a sentence rather than as a marker, and every chart in this
 * repo ships a table twin.
 */

import { useMemo } from "react";

import { linearScale, useMeasuredWidth } from "@/components/chart-kit";
import { pct, usd } from "@/lib/format";
import { exposureCells } from "@/lib/portfolio-analytics";
import type { PortfolioPosition } from "@/lib/portfolio";

/** Above this share of its own limit a position is worth looking at. */
const TIGHT = 0.75;

const MARGIN = { top: 12, right: 108, bottom: 30, left: 82 };
const ROW = 26;
/** The two fills the table's CSS bar already uses, so the two cannot disagree. */
const FILL_TIGHT = "var(--status-warning)";
const FILL_NORMAL = "color-mix(in srgb, var(--series-1) 55%, var(--surface-3))";
const AXIS_MARKS = [0, 0.5, TIGHT, 1];

export default function ExposureHeatmap({
  positions,
  generated,
}: {
  positions: PortfolioPosition[];
  generated: boolean;
}) {
  const cells = exposureCells(positions);
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(620);

  /**
   * Ranked by limit pressure, nulls last — deliberately NOT by share, which is
   * how `exposureCells` returns them and what `portfolio-analytics.test.ts`
   * pins. The sort lives here so that contract is untouched.
   */
  const rows = useMemo(
    () =>
      [...cells].sort((a, b) => {
        if (a.utilisation == null && b.utilisation == null) return b.share - a.share;
        if (a.utilisation == null) return 1;
        if (b.utilisation == null) return -1;
        return b.utilisation - a.utilisation;
      }),
    [cells],
  );

  if (!cells.length) {
    return (
      <section className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Concentration</span>
            <h2>Exposure and limit pressure</h2>
          </div>
        </div>
        <p className="muted">
          No open positions, so there is no exposure to rank. This is a flat book rather than a
          missing measurement.
        </p>
      </section>
    );
  }

  const tight = cells.filter((cell) => cell.utilisation != null && cell.utilisation >= TIGHT);
  const withheld = cells.filter((cell) => cell.utilisation == null).length;

  const height = MARGIN.top + rows.length * ROW + MARGIN.bottom;
  const plotRight = Math.max(MARGIN.left + 40, width - MARGIN.right);
  // FIXED 0→1 domain, never `extent`. A limit chart's axis ends at the limit;
  // auto-scaling to the observed maximum makes 40% of a cap look full.
  const x = linearScale(0, 1, MARGIN.left, plotRight);
  const base = MARGIN.top + rows.length * ROW;

  return (
    <section className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Concentration</span>
          <h2>Exposure and limit pressure</h2>
        </div>
        <span>
          {cells.length} positions{withheld ? ` · ${withheld} without a published limit` : ""}
        </span>
      </div>

      <div ref={ref}>
        <svg
          width="100%"
          height={height}
          viewBox={`0 0 ${Math.max(width, 320)} ${height}`}
          role="img"
          aria-label={
            `Symbol-limit utilisation for ${rows.length} positions, ranked. `
            + `${withheld} have no published limit. `
            + `${tight.length} at or above ${pct(TIGHT, 0)} of their limit. `
            + "The same figures are in the table below."
          }
        >
          {/* The limit itself, and the pressure threshold. Both solid — dashing
              is reserved for withheld, and a dashed limit would read as one. */}
          <line x1={x(1)} y1={MARGIN.top - 4} x2={x(1)} y2={base + 4}
            stroke="var(--axis)" shapeRendering="crispEdges" />
          <line x1={x(TIGHT)} y1={MARGIN.top - 4} x2={x(TIGHT)} y2={base + 4}
            stroke="var(--grid)" shapeRendering="crispEdges" />

          {rows.map((cell, index) => {
            const y = MARGIN.top + index * ROW;
            const barY = y + (ROW - 12) / 2;
            const u = cell.utilisation;

            return (
              <g key={cell.symbol}>
                <text x={MARGIN.left - 8} y={barY + 9} textAnchor="end" fontSize={11}
                  fill="var(--text-secondary)" fontWeight={650}>
                  {cell.symbol}
                </text>

                {u == null ? (
                  <>
                    {/* Withheld, not zero: no limit published is not an unused
                        limit, and a zero-length bar would say the opposite. */}
                    <rect x={x(0)} y={barY} width={Math.max(1, x(1) - x(0))} height={12}
                      fill="none" stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" rx={2}>
                      <title>{`${cell.symbol} — no symbol limit published`}</title>
                    </rect>
                    <text x={x(0) + 8} y={barY + 9} fontSize={9.5} fill="var(--text-muted)"
                      fontFamily="var(--mono)">
                      n/a
                    </text>
                  </>
                ) : (
                  <>
                    <rect x={x(0)} y={barY} width={Math.max(1, x(Math.min(u, 1)) - x(0))} height={12}
                      fill={u >= TIGHT ? FILL_TIGHT : FILL_NORMAL} rx={2}>
                      <title>
                        {`${cell.symbol} — ${pct(u, 0)} of its symbol limit, `
                          + `${usd(cell.notional, 0)} ${cell.side}`}
                      </title>
                    </rect>
                    {u > 1 && (
                      // Clamped for the bar, honest in the text. The caret says
                      // the value ran past the axis rather than stopping at it.
                      <text x={x(1) + 4} y={barY + 9.5} fontSize={11} fill="var(--status-critical)">
                        ›
                      </text>
                    )}
                  </>
                )}

                <text x={plotRight + 8} y={barY + 6} fontSize={10.5} fill="var(--text-primary)"
                  fontFamily="var(--mono)">
                  {u == null ? "—" : pct(u, 0)}
                </text>
                <text x={plotRight + 8} y={barY + 17} fontSize={9.5} fill="var(--text-muted)"
                  fontFamily="var(--mono)">
                  {pct(cell.share, 1)} gross
                </text>
              </g>
            );
          })}

          {/* Hand-placed, not XAxis: that helper drops labels inside `minGap`,
              and a dropped label on a four-mark axis loses the limit. */}
          {AXIS_MARKS.map((mark) => (
            <text key={mark} x={x(mark)} y={base + 18} textAnchor="middle" fontSize={9.5}
              fill="var(--text-muted)" fontFamily="var(--mono)">
              {mark === 1 ? "limit" : pct(mark, 0)}
            </text>
          ))}
        </svg>
      </div>

      <ul className="legend">
        <li><i aria-hidden style={{ background: FILL_NORMAL }} /> Inside its limit</li>
        <li><i aria-hidden style={{ background: FILL_TIGHT }} /> At or above {pct(TIGHT, 0)}</li>
        <li><i aria-hidden className="is-withheld" /> No limit published</li>
      </ul>

      {/* A limit status, never collapsed: hiding which positions are pressed
          against a stop changes what a reader believes about the book. */}
      <p className="research-note">
        {tight.length
          ? <>
              {tight.length} position{tight.length === 1 ? " is" : "s are"} at or above{" "}
              {pct(TIGHT, 0)} of {tight.length === 1 ? "its" : "their"} symbol limit:{" "}
              <strong>{tight.map((cell) => cell.symbol).join(", ")}</strong>.
            </>
          : <>No position is above {pct(TIGHT, 0)} of its symbol limit.</>}
        {generated && " Generated book."}
      </p>

      <details className="disclosure">
        <summary>Why share of gross and limit utilisation are separate questions</summary>
        <p className="research-note">
          Share of gross ranks positions by size; utilisation ranks them by how close each is to the
          cap the risk gate will actually enforce on it. A small position can be the one nearest a
          hard stop, so limit pressure binds before concentration does. Only utilisation is drawn —
          it is the measure with a defined full, and share of gross has no meaningful 100%.
        </p>
      </details>

      <details className="disclosure">
        <summary>Every position as a table — notional, side and both ratios per symbol</summary>
        <div className="table-wrap" tabIndex={0}>
          <table className="exposure-heatmap">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Side</th>
                <th scope="col" className="num">Notional</th>
                <th scope="col">Share of gross</th>
                <th scope="col">Symbol limit used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cell) => (
                <tr key={cell.symbol}>
                  <td><strong>{cell.symbol}</strong></td>
                  <td className={cell.side === "SHORT" ? "neg" : "pos"}>{cell.side}</td>
                  <td className="num">{usd(cell.notional, 0)}</td>
                  <td>
                    <span className="exposure-heatmap__bar">
                      <i style={{ width: `${Math.min(100, cell.share * 100)}%` }} />
                      <span className="num">{pct(cell.share, 1)}</span>
                    </span>
                  </td>
                  <td>
                    {cell.utilisation == null ? (
                      // No limit published is not an unused limit.
                      <span className="muted">no limit published</span>
                    ) : (
                      <span
                        className={`exposure-heatmap__bar${cell.utilisation >= TIGHT ? " is-tight" : ""}`}
                      >
                        <i style={{ width: `${Math.min(100, cell.utilisation * 100)}%` }} />
                        <span className="num">{pct(cell.utilisation, 0)}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
