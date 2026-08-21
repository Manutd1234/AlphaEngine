"use client";

/**
 * Cross-source reconciliation — the check that catches a feed nobody noticed.
 *
 * The failure that costs money is not an outage. An outage is loud: the circuit
 * trips, the log fills, the health matrix turns red. The expensive one is a feed
 * quietly serving Friday's close with HTTP 200 and a plausible price, which is
 * invisible to every other panel on this page because every other panel asks
 * *one* provider and believes it.
 *
 * A single source cannot detect that about itself. Two can. So this fans out to
 * every configured price source at once — bypassing the ranked failover on
 * purpose, since here a provider failing is a data point rather than a reason to
 * try somewhere else — and reports each leg's distance from the median in basis
 * points along with how stale its print is relative to the freshest.
 *
 * The 50bps tolerance is not tick-level arbitration. An EOD close, a delayed
 * composite and a live IEX print for one ticker legitimately differ by more than
 * a tick. It is there to catch the leg that is 400bps out because it has been
 * serving Tuesday's number since Tuesday.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fmt } from "@/lib/format";
import { SKIP_LABEL } from "./types";

interface ConsensusLeg {
  provider: string;
  label: string;
  price: number;
  /** Market-data timestamp. Optional so an older route remains renderable. */
  asOf?: string;
  deviationBps: number;
  stalenessSec: number;
  delayed: boolean;
  latencyMs: number;
}

interface ConsensusRow {
  symbol: string;
  price: number | null;
  legs: ConsensusLeg[];
  spreadBps: number | null;
  outliers: string[];
  toleranceBps: number;
  attempts: { provider: string; reason: string; detail?: string }[];
}

interface CrossSourceCheckProps {
  symbol: string;
}

function absoluteAsOf(iso: string | undefined): string {
  if (!iso) return "not supplied";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export default function CrossSourceCheck({ symbol }: CrossSourceCheckProps) {
  const [result, setResult] = useState<ConsensusRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);

  // Not polled. Every run queries *every* configured source at once, so an
  // auto-refresh here would multiply a provider's quota consumption by the
  // number of legs — the exact behaviour the ledger exists to prevent.
  const run = useCallback(async () => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    const current = ++sequence.current;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/quote?symbols=${encodeURIComponent(symbol)}&consensus=1&priority=interactive`,
        { cache: "no-store", signal: controller.signal },
      );
      const body = await response.json().catch(() => ({}));
      if (current !== sequence.current) return;
      if (!response.ok) {
        setError((body as { error?: string }).error ?? `HTTP ${response.status}`);
        return;
      }
      setResult(((body as { quotes?: ConsensusRow[] }).quotes ?? [])[0] ?? null);
      setRanAt(new Date());
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      if (current === sequence.current) {
        setError(err instanceof Error ? err.message : "reconciliation failed");
      }
    } finally {
      if (current === sequence.current) setBusy(false);
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [symbol]);

  // Clear on symbol change rather than re-running: the previous instrument's
  // legs under a new instrument's heading is the one wrong thing this panel
  // must never show.
  useEffect(() => {
    sequence.current += 1;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setResult(null);
    setRanAt(null);
    setError(null);
    setBusy(false);

    return () => {
      sequence.current += 1;
      activeRequest.current?.abort();
    };
  }, [symbol]);

  const legs = result?.legs ?? [];
  const attempts = result?.attempts ?? [];
  // `consensusQuote` returns one leg or one attempt for every adapter that
  // supports this capability/asset pair. That lets the UI distinguish supply,
  // configuration and actual answers without inventing a health state.
  const available = legs.length + attempts.length;
  const notConfigured = attempts.filter((attempt) => attempt.reason === "not_configured").length;
  const configured = Math.max(0, available - notConfigured);
  const answering = legs.length;

  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Data quality</span>
          <h2>Cross-source reconciliation</h2>
        </div>
        <span className="section-note">
          {ranAt ? `ran ${ranAt.toLocaleTimeString()}` : "on demand — never polled"}
        </span>
      </div>

      {/* The fan-out is the button's own label ("Reconcile … across all
          sources"), so the note keeps only the method, the reason no other
          panel can do this, and the price that is why it is manual. */}
      <p className="console-note">
        Each leg&apos;s distance from the median, the only check here that catches a stale price
        served with HTTP 200. It spends a call per provider, so it runs only when you ask.
      </p>

      <div className="console-inspector__controls">
        <button type="button" onClick={() => void run()} disabled={busy}>
          {busy ? "Reconciling…" : `Reconcile ${symbol} across all sources`}
        </button>
      </div>

      {error && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>{error}</div>
        </div>
      )}

      {result && (
        <>
          <dl className="console-facts">
            <div>
              <dt>Consensus (median)</dt>
              <dd>{result.price === null ? "—" : fmt(result.price, result.price < 10 ? 4 : 2)}</dd>
            </div>
            <div>
              <dt>Spread across sources</dt>
              <dd>{result.spreadBps === null ? "—" : `${fmt(result.spreadBps, 1)} bps`}</dd>
            </div>
            <div>
              <dt>Available adapters</dt>
              <dd>{available}</dd>
            </div>
            <div>
              <dt>Configured</dt>
              <dd>{configured}</dd>
            </div>
            <div>
              <dt>Answering</dt>
              <dd>{answering}</dd>
            </div>
            <div>
              <dt>Outliers &gt; {result.toleranceBps}bps</dt>
              <dd style={{ color: result.outliers.length ? "var(--warning-text)" : undefined }}>
                {result.outliers.length ? result.outliers.join(", ") : "none"}
              </dd>
            </div>
          </dl>

          {answering < 2 && (
            <div className="banner warn" role="status">
              <span aria-hidden>!</span>
              <div>
                {configured === 0
                  ? "No price source is configured for this symbol, so there is no independent value to reconcile."
                  : answering === 0
                    ? `${configured} source${configured === 1 ? " is" : "s are"} configured, but none answered this check.`
                    : configured === 1
                      ? "Only one price source is configured and answering, so there is no independent value to reconcile against."
                      : `Only one of ${configured} configured sources answered. Review the failed legs below before treating that value as consensus.`}
              </div>
            </div>
          )}

          {answering > 0 && (
            <div className="table-wrap" tabIndex={0}>
              <table>
                <caption className="sr-only">
                  Per-source price, market-data timestamp, deviation from the median in basis points,
                  staleness against the freshest print, and latency.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Price</th>
                    <th scope="col">As of (UTC)</th>
                    <th scope="col">Δ vs consensus</th>
                    <th scope="col">Staleness</th>
                    <th scope="col">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {legs.map((leg) => {
                    const outlier = result.outliers.includes(leg.provider);
                    return (
                      <tr key={leg.provider}>
                        <td>
                          {/* outlier = icon + word, never colour alone */}
                          {outlier && <span aria-hidden style={{ color: "var(--warning-text)" }}>▲ </span>}
                          {leg.label}
                          {leg.delayed && <span className="muted"> (delayed)</span>}
                          {outlier && <span className="muted"> — outlier</span>}
                        </td>
                        <td>{fmt(leg.price, leg.price < 10 ? 4 : 2)}</td>
                        <td><time dateTime={leg.asOf}>{absoluteAsOf(leg.asOf)}</time></td>
                        <td>
                          {leg.deviationBps >= 0 ? "+" : ""}
                          {fmt(leg.deviationBps, 1)} bps
                        </td>
                        <td>{leg.stalenessSec ? `${leg.stalenessSec}s` : "freshest"}</td>
                        <td>{leg.latencyMs}ms</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {attempts.length > 0 && (
            <p className="console-footnote">
              Not answering:{" "}
              {attempts
                .map((a) => `${a.provider} (${SKIP_LABEL[a.reason] ?? a.reason})`)
                .join("; ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
