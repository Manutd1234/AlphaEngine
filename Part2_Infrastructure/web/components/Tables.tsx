"use client";

/**
 * Table views. These are not decorative: the palette's low-contrast light-mode
 * slot obliges a non-colour route to every number, and these tables are it.
 */

import { ParamResult, SweepResponse } from "@/lib/types";
import { fmt, pct, sign, usd } from "@/lib/format";

export function ResultsTable({
  data,
  onSelect,
  selected,
}: {
  data: SweepResponse;
  onSelect?: (r: ParamResult) => void;
  selected?: { fast: number; slow: number } | null;
}) {
  return (
    <div className="table-wrap table-wrap--clamped">
      <table>
        <caption className="sr-only">
          Top 15 parameter combinations ranked by annualised Sharpe ratio
        </caption>
        <thead>
          <tr>
            <th scope="col">Fast / Slow</th>
            <th scope="col">Sharpe</th>
            <th scope="col">Return</th>
            <th scope="col">CAGR</th>
            <th scope="col">Max DD</th>
            <th scope="col">Calmar</th>
            <th scope="col">Trades</th>
            <th scope="col">Win</th>
            <th scope="col">Exposure</th>
            <th scope="col">Fees</th>
          </tr>
        </thead>
        <tbody>
          {data.topResults.map((r) => {
            const isSel = selected && r.fast === selected.fast && r.slow === selected.slow;
            return (
              <tr
                key={`${r.fast}-${r.slow}`}
                className={isSel ? "is-best" : undefined}
                onClick={() => onSelect?.(r)}
                onKeyDown={(event) => {
                  if (onSelect && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    onSelect(r);
                  }
                }}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={onSelect ? `Inspect parameters ${r.fast}/${r.slow}` : undefined}
                style={{ cursor: onSelect ? "pointer" : undefined }}
              >
                {/* No inline style: `tbody th[scope="row"]` in globals.css sets
                    exactly these four declarations, and the copy here was
                    pinning a padding and a hairline colour the shared table
                    rules have since moved off. An inline style is invisible to
                    the theme and density tests, which is how a row header
                    ended up half a pixel out of line with every td beside
                    it. */}
                <th scope="row">
                  {r.fast}/{r.slow}
                </th>
                <td className={sign(r.sharpe)}>{fmt(r.sharpe, 2)}</td>
                <td className={sign(r.totalReturn)}>{pct(r.totalReturn)}</td>
                <td className={sign(r.cagr)}>{pct(r.cagr)}</td>
                <td className="neg">{pct(r.maxDrawdown)}</td>
                <td className="muted">{fmt(r.calmar, 2)}</td>
                <td className="muted">{r.trades}</td>
                <td className="muted">{pct(r.winRate, 0)}</td>
                <td className="muted">{pct(r.exposure, 0)}</td>
                <td className="muted">{usd(r.feesPaid)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* WalkForwardTable used to live here: a second per-fold table stacked under
   WalkForwardTimeline's on the same sub-tab, repeating five of its columns.
   The timeline's table absorbed the two this one alone carried (train window,
   OOS return); FoldEfficiency extends WalkForwardFold, so nothing was lost. */
