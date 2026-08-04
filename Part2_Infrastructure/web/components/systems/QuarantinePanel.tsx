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

export default function QuarantinePanel({ size, byProvider, recent }: QuarantinePanelProps) {
  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Data quality</span>
          <h2>Quarantine</h2>
        </div>
        <span className="section-note">
          {size === 0 ? "nothing flagged" : `${size} flagged payload${size === 1 ? "" : "s"}`}
        </span>
      </div>

      {size === 0 ? (
        <p className="sub">
          Every payload since this instance started has met its contract: prices positive and inside
          their own range, bar timestamps unique and ordered, highs above lows, timestamps recent
          enough to be what they claim. A green transport layer does not imply this — it is checked
          separately, on the content.
        </p>
      ) : (
        <>
          <div className="table-wrap">
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

          <p className="research-note">
            A bounded, in-memory buffer of the most recent flags — a diagnostic aid, not a data lake,
            and it is emptied on restart. Rejected payloads were never cached: the failover chain got
            a chance at a cleaner source instead. Excerpts are redacted with the same rules the trace
            console uses, so a credential echoed in a vendor error cannot be stored by the tool meant
            to help debug it.
          </p>
        </>
      )}
    </div>
  );
}
