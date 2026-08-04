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
    <div className="table-wrap">
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
                <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)", fontWeight: 600 }}>
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

export function WalkForwardTable({ data }: { data: SweepResponse }) {
  if (!data.walkForward.length) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
        Not enough history for the requested number of folds — increase the bar count or reduce folds.
      </p>
    );
  }
  return (
    <div className="table-wrap">
      <table>
        <caption className="sr-only">
          Walk-forward folds: parameters chosen in-sample, scored out-of-sample
        </caption>
        <thead>
          <tr>
            <th scope="col">Fold</th>
            <th scope="col">Train window</th>
            <th scope="col">Test window</th>
            <th scope="col">Chosen</th>
            <th scope="col">IS Sharpe</th>
            <th scope="col">OOS Sharpe</th>
            <th scope="col">OOS return</th>
          </tr>
        </thead>
        <tbody>
          {data.walkForward.map((f) => (
            <tr key={f.fold}>
              <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)" }}>
                {f.fold}
              </th>
              <td className="muted">
                {f.trainStart.slice(0, 10)} → {f.trainEnd.slice(0, 10)}
              </td>
              <td className="muted">
                {f.testStart.slice(0, 10)} → {f.testEnd.slice(0, 10)}
              </td>
              <td>
                {f.chosenFast}/{f.chosenSlow}
              </td>
              <td className="muted">{fmt(f.isSharpe, 2)}</td>
              <td className={sign(f.oosSharpe)} style={{ fontWeight: 600 }}>
                {fmt(f.oosSharpe, 2)}
              </td>
              <td className={sign(f.oosReturn)}>{pct(f.oosReturn)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12, maxWidth: "78ch" }}>
        Each fold optimises on the train window and trades the <strong>next</strong>, unseen one. A
        large in-sample → out-of-sample gap is overfitting made visible: the parameters that won on
        past data stop winning on the data that followed it.
      </p>
    </div>
  );
}
