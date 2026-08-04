"use client";

/**
 * Every run this browser has done, and the number nobody else is counting.
 *
 * The Deflated Sharpe on each row prices the search *inside* that sweep. It has
 * no idea the other rows exist. Forty hypotheses tested against one instrument
 * is itself a multiple-testing problem, and the winner's DSR does not know about
 * the thirty-nine that failed — so this panel states the cross-run count
 * prominently and says what it does to the evidence. A log that quietly
 * accumulates attempts while showing per-attempt significance is worse than no
 * log at all.
 *
 * Stored in `localStorage` as a projection, and per-browser: it is a research
 * notebook, not an audit trail. The audit trail is the gateway's append-only
 * DuckDB log, and this says so rather than letting anyone assume otherwise.
 */

import { fmt, pct, signedPct } from "@/lib/format";
import { STRATEGY_LABELS, type SweepRequest } from "@/lib/types";
import type { ExperimentRecord } from "@/lib/experiments";

interface ExperimentHistoryProps {
  records: ExperimentRecord[];
  activeRequest: SweepRequest;
  onClone: (request: SweepRequest) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const VERDICT_STYLE: Record<string, { glyph: string; label: string; tone: string }> = {
  pass: { glyph: "✓", label: "passed", tone: "var(--success-text)" },
  marginal: { glyph: "▲", label: "marginal", tone: "var(--warning-text)" },
  fail: { glyph: "✕", label: "rejected", tone: "var(--critical-text)" },
};

export default function ExperimentHistory({
  records,
  activeRequest,
  onClone,
  onRemove,
  onClear,
}: ExperimentHistoryProps) {
  const promoted = records.filter((r) => r.promotionTotal > 0 && r.promotionPassed === r.promotionTotal);
  const distinctSymbols = new Set(records.map((r) => r.symbol)).size;

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Experiment tracker</span>
          <h2>Run history</h2>
        </div>
        <span className="section-note">
          {records.length} run{records.length === 1 ? "" : "s"} · {promoted.length} promotable
        </span>
      </div>

      {records.length === 0 ? (
        <p className="sub">
          No runs recorded yet in this browser. Every completed sweep is saved here automatically so
          the same hypothesis is not silently re-tested.
        </p>
      ) : (
        <>
          {records.length >= 5 && (
            <div className="banner warn" role="status">
              <span aria-hidden>!</span>
              <div>
                <strong>{records.length} hypotheses tested across {distinctSymbols}{" "}
                  instrument{distinctSymbols === 1 ? "" : "s"}.</strong>{" "}
                Each row&apos;s Deflated Sharpe prices only the parameter grid <em>inside</em> that run.
                It does not know the other {records.length - 1} runs happened — so the best row here is
                a maximum over {records.length} searches, and its DSR overstates the evidence by
                exactly that much.
              </div>
            </div>
          )}

          <div className="table-wrap">
            <table>
              <caption className="sr-only">
                Saved research runs with in-sample Sharpe, deflated Sharpe, out-of-sample Sharpe,
                drawdown, verdict and actions.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Run</th>
                  <th scope="col">Hypothesis</th>
                  <th scope="col">Sharpe</th>
                  <th scope="col">DSR</th>
                  <th scope="col">OOS</th>
                  <th scope="col">Max DD</th>
                  <th scope="col">Gates</th>
                  <th scope="col">Status</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const style = VERDICT_STYLE[r.verdict];
                  const isActive = sameShape(r.request, activeRequest);
                  return (
                    <tr key={r.id} className={isActive ? "is-best" : undefined}>
                      <td>
                        <div className="run-id">
                          <strong>{r.id}</strong>
                          {isActive && <small className="muted">on screen</small>}
                        </div>
                      </td>
                      <td>
                        <div className="run-hypothesis">
                          <strong>{STRATEGY_LABELS[r.strategy]}</strong>
                          <small className="muted">
                            {r.symbol} · {r.interval} · {r.fast}/{r.slow} · {r.combosTested} combos
                            {r.modelledFrictions && " · frictions modelled"}
                          </small>
                        </div>
                      </td>
                      <td>{fmt(r.sharpe, 2)}</td>
                      <td>{fmt(r.deflatedSharpeRatio, 3)}</td>
                      <td className={(r.walkForwardOosSharpe ?? 0) >= 0 ? "pos" : "neg"}>
                        {r.walkForwardOosSharpe === null ? "—" : fmt(r.walkForwardOosSharpe, 2)}
                      </td>
                      <td className="neg">{pct(r.maxDrawdown)}</td>
                      <td>
                        {r.promotionTotal ? `${r.promotionPassed}/${r.promotionTotal}` : "—"}
                      </td>
                      <td>
                        {/* icon + word + colour, never colour alone */}
                        <span style={{ color: style.tone }}>
                          <span aria-hidden>{style.glyph}</span> {style.label}
                        </span>
                      </td>
                      <td>
                        <div className="run-actions">
                          <button
                            type="button"
                            onClick={() => onClone(r.request)}
                            title="Load this run's exact configuration into the controls"
                          >
                            Clone
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemove(r.id)}
                            title="Remove this run from the local history"
                          >
                            Drop
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="research-facts">
            <span>
              Best in-sample <strong className="num">{fmt(bestSharpe(records), 2)}</strong>
            </span>
            <span>
              Best out-of-sample <strong className="num">{fmt(bestOos(records), 2)}</strong>
            </span>
            <button type="button" className="text-action" onClick={onClear}>
              Clear history
            </button>
          </div>
        </>
      )}

      <p className="research-note">
        Saved in this browser only, as a summary rather than a full result — a research notebook, not
        an audit trail. The authoritative record of anything that reaches execution is the gateway&apos;s
        append-only log.
      </p>
    </div>
  );
}

function bestSharpe(records: ExperimentRecord[]): number | null {
  return records.length ? Math.max(...records.map((r) => r.sharpe)) : null;
}

/**
 * `Math.max` of an empty list is `-Infinity`, which `fmt` renders as an em dash
 * — correct by accident. Filtering first makes it correct on purpose, and also
 * covers the case where runs exist but none had a walk-forward result.
 */
function bestOos(records: ExperimentRecord[]): number | null {
  const values = records
    .map((r) => r.walkForwardOosSharpe)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return values.length ? Math.max(...values) : null;
}

/** Same hypothesis, ignoring fields that do not change what was tested. */
function sameShape(a: SweepRequest, b: SweepRequest): boolean {
  const keys = Object.keys({ ...a, ...b }) as (keyof SweepRequest)[];
  return keys.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}
