"use client";

/**
 * Payloads that failed their contract, and what was wrong with them.
 *
 * The rest of this console reports on *transport*: which provider answered, how
 * fast, whether a breaker is open. All of that can be green while the data
 * itself is wrong — a bar series with a duplicated timestamp arrives quickly,
 * from a healthy provider, and quietly halves the volatility a backtest
 * measures.
 *
 * So this panel reports on *content*. Three severities, and the distinction
 * between them is the useful part:
 *
 *   fatal  internally impossible — a high below its low. Rejected, failed over.
 *   warn   true but suspect — a quote stamped four days ago. Served, labelled.
 *   drift  our mapping looks stale, not the market — a secondary field that
 *          went null while everything around it stayed intact.
 *
 * That last one is what turns "the change field is null" into "the vendor
 * renamed the change field", which is the difference between a shrug and a fix.
 */

import type { ValidationTelemetry } from "./types";

interface Violation {
  check: string;
  /**
   * Plain `string`, not the `Severity` union: this arrives over an API
   * boundary, so an unrecognised value is possible and falls back to the
   * warning style rather than failing to render.
   */
  severity: string;
  message: string;
  observed?: string | number | null;
}

interface QuarantineRecord {
  seq: number;
  at: string;
  provider: string;
  capability: string;
  key: string;
  rejected: boolean;
  violations: Violation[];
  sample: string;
}

interface QuarantinePanelProps {
  size: number;
  byProvider: Array<{ provider: string; records: number; rejected: number }>;
  recent: QuarantineRecord[];
  /** Optional during a rolling deploy against an older health route. */
  validation?: ValidationTelemetry | null;
}

const SEVERITY_STYLE: Record<string, { glyph: string; tone: string }> = {
  fatal: { glyph: "✕", tone: "var(--critical-text)" },
  warn: { glyph: "▲", tone: "var(--warning-text)" },
  drift: { glyph: "≠", tone: "var(--notice-text)" },
};

function time(iso: string): string {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? iso : new Date(parsed).toLocaleTimeString("en-GB", { hour12: false });
}

export default function QuarantinePanel({
  size,
  byProvider,
  recent,
  validation,
}: QuarantinePanelProps) {
  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Data quality</span>
          <h2>Quarantine</h2>
        </div>
        <span className="section-note">
          {size === 0 ? "0 records in this instance's buffer" : `${size} flagged payload${size === 1 ? "" : "s"}`}
          {validation?.scope === "gateway-ledger" && validation.ledger
            ? `; ledger persisted on the gateway, ${validation.ledger.retentionDays}-day retention`
            : ""}
        </span>
      </div>

      {validation && (
        <dl className="console-facts console-facts--tight" aria-label="Contract evaluation evidence">
          <div>
            <dt>Payloads evaluated</dt>
            <dd>{validation.evaluated}</dd>
          </div>
          <div>
            <dt>No fatal finding</dt>
            <dd>{validation.evaluated ? `${validation.passed} / ${validation.evaluated}` : "—"}</dd>
          </div>
          <div>
            <dt>Findings</dt>
            <dd>{validation.fatal} fatal, {validation.warn} warn, {validation.drift} drift</dd>
          </div>
          <div>
            <dt>Checks not evaluated</dt>
            <dd>{validation.notEvaluated}</dd>
          </div>
          <div>
            <dt>Evidence window</dt>
            <dd>
              {validation.scope === "gateway-ledger" && validation.ledger
                ? `${validation.retained} findings in the gateway ledger, ${validation.ledger.windowMinutes >= 1440 ? `${Math.round(validation.ledger.windowMinutes / 60)} h` : `${validation.ledger.windowMinutes} min`} window`
                : `${validation.retained} / ${validation.capacity ?? "—"} per instance`}
            </dd>
          </div>
        </dl>
      )}

      {size === 0 ? (
        validation?.evaluated ? (
          <p className="sub">
            No flagged payload excerpt is retained.{" "}
            {validation.scope === "gateway-ledger"
              ? `The gateway ledger holds ${validation.evaluated} evaluated`
              : `This health-route instance evaluated ${validation.evaluated}`}{" "}
            normalised quote, bar, news or fundamentals payload{validation.evaluated === 1 ? "" : "s"} in the
            window above; {validation.passed} had no fatal finding. Warnings, drift and checks that
            could not run stay separate evidence, never counted as clean.
          </p>
        ) : (
          <p className="sub">
            No flagged payload excerpt is retained, but this health-route instance has no evaluated
            denominator. That means no aggregate evidence here—not that
            every payload passed. Request routes can run in separate serverless instances, so use the
            overview&apos;s exact-payload probe and lineage trace instead.
          </p>
        )
      ) : (
        <>
          <div className="table-wrap table-wrap--clamped">
            <table>
              <caption className="sr-only">Flagged payload counts by provider.</caption>
              <thead>
                <tr>
                  <th scope="col">Provider</th>
                  <th scope="col">Flagged</th>
                  <th scope="col">Rejected</th>
                </tr>
              </thead>
              <tbody>
                {byProvider.map((row) => (
                  <tr key={row.provider}>
                    <td>{row.provider}</td>
                    <td className="num">{row.records}</td>
                    <td className="num">
                      {row.rejected > 0
                        ? <span style={{ color: "var(--critical-text)" }}>{row.rejected}</span>
                        : <span className="muted">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="quarantine-list">
            {recent.map((record) => (
              <li key={record.seq}>
                <div className="quarantine-list__head">
                  <span className="muted">{time(record.at)}</span>
                  <strong>{record.provider}</strong>
                  <span className="muted">{record.capability}</span>
                  {record.rejected
                    ? <span className="pill pill--stop">rejected</span>
                    : <span className="pill pill--warn">served, flagged</span>}
                </div>
                <p className="console-key">
                  <span className="muted">cache key</span> <code>{record.key}</code>
                </p>
                <ul className="quarantine-violations">
                  {record.violations.map((violation) => {
                    const style = SEVERITY_STYLE[violation.severity] ?? SEVERITY_STYLE.warn;
                    return (
                      <li key={violation.check}>
                        {/* icon + word + colour, never colour alone */}
                        <span style={{ color: style.tone }}>
                          <span aria-hidden>{style.glyph}</span> {violation.severity}
                        </span>
                        <code>{violation.check}</code>
                        <span>{violation.message}</span>
                      </li>
                    );
                  })}
                </ul>
                <details>
                  <summary>Payload excerpt</summary>
                  <pre className="console-wrap">{record.sample}</pre>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="research-note">
        {validation?.scope === "gateway-ledger" ? (
          <>
            Scope: the aggregate counts are the gateway&apos;s durable ledger — every instance&apos;s
            quote, bar, news and fundamentals findings, merged and kept across restarts. The excerpts
            below are still this instance&apos;s bounded buffer and reset with it. Rejected payloads
            were never cached, so failover could try a cleaner source; excerpts follow the trace
            console&apos;s redaction rules.
          </>
        ) : (
          <>
            Scope: quote, bar, news and fundamentals payloads handled by this health-route instance—not
            every request route, provider, symbol, raw vendor schema or deployed instance. The window
            and quarantine are bounded in memory and reset on restart. Rejected payloads were never
            cached, so failover could try a cleaner source; excerpts follow the trace console&apos;s
            redaction rules.
          </>
        )}
      </p>
    </div>
  );
}
