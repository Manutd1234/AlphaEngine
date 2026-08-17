"use client";

/**
 * Combine saved runs into one portfolio, and say whether it was worth doing.
 *
 * The panel's opinion is in its column order. Every method's IN-SAMPLE Sharpe
 * sits next to its HOLDOUT Sharpe, and the last column is the holdout edge over
 * the best single member. A researcher looking at five methods wants to know
 * which one won; what they need to know first is whether any of them beat
 * holding one strategy on its own, which is very often no.
 *
 * Equal weight is listed first and is never styled as the loser. It knows
 * nothing about correlation or expected return, and on a holdout it beats the
 * clever methods more often than the clever methods' descriptions suggest.
 */

import { useState } from "react";

import { fmt, pct } from "@/lib/format";
import type { ExperimentRecord } from "@/lib/experiments";
import { FAVOURITE_METHODS, type CombinedResult } from "@/lib/favourites";
import { STRATEGY_LABELS } from "@/lib/types";

/** Matches the route's cap; past this a set of variations is one bet. */
const MAX_SELECTED = 5;

/**
 * The longest legitimate wait in this app, and deliberately so: the route
 * re-executes up to five backtests, each loading its own bars from a market
 * data provider before the engine runs. The panel says as much — the history
 * stores the recipe, not the return series — so a reader pressing "Combine"
 * has already been told this is real work rather than a lookup.
 *
 * The deadline is not here to make that quick. It is here so a request that
 * stalls cannot leave the button reading "Re-running…" for the life of the tab,
 * which is indistinguishable from a combination that is merely slow.
 */
const COMBINE_DEADLINE_MS = 45_000;

const METHOD_LABEL: Record<string, string> = {
  equal_weight: "Equal weight",
  inverse_vol: "Inverse volatility",
  equal_risk: "Equal risk contribution",
  min_variance: "Minimum variance",
  max_sharpe: "Maximum Sharpe",
};

interface Member { id: string; label: string; symbol: string }

interface CombineResponse {
  overlap: number;
  longest: number;
  members: Member[];
  all: CombinedResult[];
  warnings: string[];
  error?: string;
}

export default function FavouritesPanel({ records }: { records: ExperimentRecord[] }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [result, setResult] = useState<CombineResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((x) => x !== id)
        : current.length >= MAX_SELECTED ? current : [...current, id],
    );
    setResult(null);
  }

  async function combine() {
    setRunning(true);
    setStatus(null);
    try {
      const chosen = records.filter((r) => selected.includes(r.id));
      const response = await fetch("/api/favourites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          method: "equal_weight",
          recipes: chosen.map((r) => ({
            id: r.id, symbol: r.symbol, interval: r.interval, strategy: r.strategy,
            fast: r.fast, slow: r.slow, bars: r.bars, direction: r.direction,
          })),
        }),
        signal: AbortSignal.timeout(COMBINE_DEADLINE_MS),
      });
      const body = (await response.json()) as CombineResponse;
      if (!response.ok) {
        // The route distinguishes "no shared bars" from "too few shared bars"
        // from a bad request, and each has a different fix. Passing the message
        // through unchanged is what keeps them distinguishable here.
        setStatus(body.error ?? `The combination failed (HTTP ${response.status}).`);
        setResult(null);
        return;
      }
      setResult(body);
    } catch (cause) {
      /**
       * "The request never reached the engine" is a claim about the network, and
       * an abort cannot make it — the engine may have been halfway through the
       * fourth backtest. Saying it anyway sends a reader to check their
       * connection over a request that was working.
       */
      const timedOut = cause instanceof DOMException && cause.name === "TimeoutError";
      setStatus(timedOut
        ? `No result within ${COMBINE_DEADLINE_MS / 1000}s. The engine may still have been re-running `
          + "these bars — try fewer runs, or a shorter window, rather than assuming they cannot combine."
        : "The combination did not complete — the request never reached the engine.");
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card favourites">
      <div className="section-heading compact">
        <div>
          <h2>Combine favourites</h2>
        </div>
        <span className="num muted">{selected.length}/{MAX_SELECTED} selected</span>
      </div>

      <p className="sub">
        Each saved run is <strong>re-executed</strong>, not replayed — the history stores the recipe
        rather than the return series, deliberately, to stay inside the browser&rsquo;s storage
        quota. Weights are fitted on the earlier {Math.round(0.7 * 100)}% of the shared window and
        measured on the rest, which the fit never saw.
      </p>

      {records.length < 2 ? (
        <p className="muted">Save at least two runs to combine them.</p>
      ) : (
        <ul className="favourites-list">
          {records.slice(0, 20).map((record) => (
            <li key={record.id}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(record.id)}
                  disabled={!selected.includes(record.id) && selected.length >= MAX_SELECTED}
                  onChange={() => toggle(record.id)}
                />
                <span className="num">{record.symbol}</span>{" "}
                {STRATEGY_LABELS[record.strategy]} {record.fast}/{record.slow}
                <small className="muted">
                  {" "}Sharpe {fmt(record.sharpe, 2)} at {record.interval}
                </small>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className="favourites-actions">
        <button
          className="primary-action"
          disabled={selected.length < 2 || running}
          onClick={combine}
          title={selected.length < 2 ? "Select at least two runs" : "Re-run and combine"}
        >
          {running ? "Re-running…" : `Combine ${selected.length} runs`}
        </button>
        {selected.length >= MAX_SELECTED ? (
          <small className="muted">
            Five is the cap. Past that, a set of saved variations is one bet, and an optimiser will
            report a diversification benefit that is not there.
          </small>
        ) : null}
      </div>

      {status ? <p className="research-note">{status}</p> : null}

      {result ? (
        <>
          <p className="sub">
            <span className="num">{result.overlap}</span> bars shared across{" "}
            {result.members.length} runs
            {result.overlap < result.longest ? (
              <> — the longest run had <span className="num">{result.longest}</span>, so{" "}
                <span className="num">{result.longest - result.overlap}</span> were outside the
                common window and discarded.</>
            ) : null}
          </p>

          <div className="table-scroll">
            <table className="favourites-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="num">In-sample Sharpe</th>
                  <th className="num">Holdout Sharpe</th>
                  <th className="num">Holdout return</th>
                  <th className="num">vs best single</th>
                </tr>
              </thead>
              <tbody>
                {FAVOURITE_METHODS.map((method) => {
                  const row = result.all.find((r) => r.method === method);
                  if (!row) return null;
                  return (
                    <tr key={method}>
                      <td>{METHOD_LABEL[method]}</td>
                      <td className="num muted">{fmt(row.inSampleSharpe, 2)}</td>
                      <td className="num">{fmt(row.holdoutSharpe, 2)}</td>
                      <td className="num">{pct(row.holdoutReturn)}</td>
                      <td className={`num ${row.edgeOverBestSingle > 0 ? "is-pos" : "is-neg"}`}>
                        {row.edgeOverBestSingle > 0 ? "+" : ""}{fmt(row.edgeOverBestSingle, 2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="research-note">
            The in-sample column is the window the weights were chosen on, and it flatters every
            method by construction. A method whose holdout Sharpe is far below its in-sample one has
            fitted the training period, which is the same failure walk-forward efficiency reports for
            a single strategy. The last column is the one that decides whether combining was worth
            doing at all: a negative number means the portfolio lost to one of its own members out of
            sample, and added complexity for nothing.
          </p>
        </>
      ) : null}

      {result?.warnings.length ? (
        <ul className="favourites-warnings">
          {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
