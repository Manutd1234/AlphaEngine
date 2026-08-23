"use client";

/**
 * The loss tail, and when it arrived.
 *
 * Sharpe divides by standard deviation, which treats a fat left tail as
 * ordinary variance. Two strategies with the same Sharpe can have completely
 * different worst days, and it is the worst day that decides whether a book
 * survives to collect the average. So: VaR and CVaR on the actual return
 * distribution, a monthly grid that shows *when* the damage happened, and the
 * Ulcer index, which — unlike max drawdown — charges for time spent underwater
 * as well as depth.
 *
 * The monthly grid is the piece researchers reach for first. A strategy that
 * made all its money in two months and bled for eighteen is a different object
 * from one that ground out a small edge consistently, and no summary statistic
 * separates them.
 */

import { fmt, pct, signedPct } from "@/lib/format";
import type { MonthlyReturn, TailReport } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default function TearSheet({
  tail,
  interval,
  turnoverPerYear,
}: {
  tail: TailReport;
  interval: string;
  turnoverPerYear: number;
}) {
  const years = groupByYear(tail.monthly);
  const absMax = Math.max(0.01, ...tail.monthly.map((m) => Math.abs(m.return)));

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Risk</span>
          <h2>Tail risk &amp; return distribution</h2>
        </div>
        <span className="section-note">
          per {interval} bar, {tail.totalBars.toLocaleString()} observations
        </span>
      </div>

      <div className="tiles stability-tiles">
        <div className="stability-tile">
          <span>VaR 95</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>
            {signedPct(tail.var95, 2)}
          </strong>
          <small>1 bar in 20 loses at least this</small>
        </div>
        <div className="stability-tile">
          <span>CVaR 95</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>
            {signedPct(tail.cvar95, 2)}
          </strong>
          <small>average loss inside that tail</small>
        </div>
        <div className="stability-tile">
          <span>CVaR 99</span>
          <strong className="num" style={{ color: "var(--critical-text)" }}>
            {signedPct(tail.cvar99, 2)}
          </strong>
          <small>average of the worst 1%</small>
        </div>
        <div className="stability-tile">
          <span>Tail ratio</span>
          <strong className="num" style={{ color: tail.tailRatio >= 1 ? "var(--success-text)" : "var(--warning-text)" }}>
            {fmt(tail.tailRatio, 2)}
          </strong>
          <small>upside p95 ÷ downside p5</small>
        </div>
        <div className="stability-tile">
          <span>Ulcer index</span>
          <strong className="num">{pct(tail.ulcerIndex, 2)}</strong>
          <small>RMS drawdown — depth × duration</small>
        </div>
        <div className="stability-tile">
          <span>Annualised turnover</span>
          <strong className="num">{fmt(turnoverPerYear, 1)}×</strong>
          <small>of the book</small>
        </div>
      </div>

      {/* Four readings off the bar distribution, as a one-row table under a
          header band — they were a flex row of loose "label value" pairs with
          an 18px gap and no rule, which the reader saw as a sentence that had
          lost its commas. A table gives each one a column, a label above it
          and a frame around the four, in the grammar of every other table on
          this card. */}
      <section className="research-facts research-subsection" aria-labelledby="tail-extremes-title">
        <h3 id="tail-extremes-title" className="research-subhead">Extremes &amp; streaks</h3>
        <div className="table-wrap" tabIndex={0}>
          <table className="facts-table">
            <caption className="sr-only">
              The best and worst single bars, the share of positive bars and the longest losing run
            </caption>
            <thead>
              <tr>
                <th scope="col">Best bar</th>
                <th scope="col">Worst bar</th>
                <th scope="col">Positive bars</th>
                <th scope="col">Longest losing run</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="num pos">{signedPct(tail.bestBar, 2)}</td>
                <td className="num neg">{signedPct(tail.worstBar, 2)}</td>
                {/* A dash, not 0.0%. With no bars this share is not measurable,
                    and the `: 0` it used to fall back to said the opposite —
                    that every bar was negative. That is the one substitution
                    this codebase is most alert to: it turns "we cannot know"
                    into a finding, and it type-checks all the way through. */}
                <td className="num" title={tail.totalBars ? undefined : "No bars in this window"}>
                  {tail.totalBars ? pct(tail.positiveBars / tail.totalBars, 1) : "—"}
                </td>
                <td className="num">{tail.maxLosingStreak} bars</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="monthly-returns research-subsection" aria-labelledby="monthly-returns-title">
        <h3 id="monthly-returns-title" className="research-subhead">Monthly returns</h3>
        {/* The grid's construction rule, not one of its cells. Every figure the
            grid carries stays on screen; what folds is how a month is added up
            and why the first and last one may cover fewer bars. The words are the
            heading's old trailing clause, which loses only the em dash that
            joined it to "Monthly returns". */}
        <details className="disclosure">
          <summary>How a calendar month is totalled</summary>
          <p className="research-note">
            Compounded within each calendar month, so a partial first or last month is shorter
            than the rest.
          </p>
        </details>

        {years.length === 0 ? (
          <p className="sub">No completed month in this window.</p>
        ) : (
          <div className="table-wrap" tabIndex={0}>
            <table className="monthly-grid">
              <caption className="sr-only">
                Strategy return by calendar month and year, with an annual total.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  {MONTHS.map((m) => (
                    <th scope="col" key={m}>
                      {m}
                    </th>
                  ))}
                  <th scope="col">Year</th>
                </tr>
              </thead>
              <tbody>
                {years.map(({ year, byMonth, total }) => (
                  <tr key={year}>
                    <td>{year}</td>
                    {MONTHS.map((label, index) => {
                      const cell = byMonth[index];
                      return (
                        <td key={label} className="monthly-cell">
                          {cell ? (
                            <span
                              title={`${label} ${year}: ${signedPct(cell.return, 2)} over ${cell.bars} bars`}
                              style={{
                                // Alpha carries magnitude, hue carries sign, and the
                                // number itself is always printed — so the cell is
                                // readable with no colour perception at all.
                                background:
                                  cell.return >= 0
                                    ? `color-mix(in srgb, var(--diverging-pos) ${Math.round((Math.abs(cell.return) / absMax) * 55)}%, transparent)`
                                    : `color-mix(in srgb, var(--diverging-neg) ${Math.round((Math.abs(cell.return) / absMax) * 55)}%, transparent)`,
                              }}
                            >
                              {(cell.return * 100).toFixed(1)}
                            </span>
                          ) : (
                            <span className="muted" aria-label="no observation">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className={total >= 0 ? "pos" : "neg"}>{signedPct(total, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

interface YearRow {
  year: number;
  byMonth: (MonthlyReturn | undefined)[];
  total: number;
}

/**
 * Compound, don't sum.
 *
 * A year of monthly returns is a product of growth factors. Adding them is off
 * by second-order terms that grow with volatility — precisely the strategies
 * where the yearly figure is being scrutinised.
 */
function groupByYear(monthly: MonthlyReturn[]): YearRow[] {
  const rows = new Map<number, YearRow>();
  for (const m of monthly) {
    const row = rows.get(m.year) ?? { year: m.year, byMonth: new Array(12).fill(undefined), total: 0 };
    row.byMonth[m.monthIndex] = m;
    rows.set(m.year, row);
  }
  for (const row of rows.values()) {
    row.total = row.byMonth.reduce((growth, m) => growth * (1 + (m?.return ?? 0)), 1) - 1;
  }
  return [...rows.values()].sort((a, b) => a.year - b.year);
}
