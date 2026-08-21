"use client";

/**
 * Remediation's Session pane — split from `OperatorPanel` along the
 * blast-radius seam its two group headings drew: everything in that panel
 * mutates server state behind the guard; nothing here touches the server, so no
 * guard renders. It moved to its own file when `OperatorPanel` passed the
 * length ceiling; `OperatorPanel` re-exports it, so no import path changed.
 *
 * The panel's rule travels with it: every control says what it costs, on the
 * line under the button rather than in a tooltip. What a control touches — the
 * scope — is the one thing allowed to fold into the disclosure at the foot.
 */

/** Cadences the console offers. 0 is a genuine pause, not a very long interval. */
const CADENCES: { label: string; ms: number; note: string }[] = [
  { label: "1s", ms: 1_000, note: "debugging" },
  { label: "5s", ms: 5_000, note: "watching" },
  { label: "30s", ms: 30_000, note: "default" },
  { label: "Paused", ms: 0, note: "no polling" },
];

interface SessionControlsProps {
  pollMs: number;
  onPollMsChange: (ms: number) => void;
  socketCount: number;
  onReconnectSockets: () => void;
}

/**
 * Remediation's Session pane — split from `OperatorPanel` along the
 * blast-radius seam its two group headings drew: everything in that panel
 * mutates server state behind the guard; nothing here touches the server, so no
 * guard renders.
 */
export default function SessionControls({
  pollMs,
  onPollMsChange,
  socketCount,
  onReconnectSockets,
}: SessionControlsProps) {
  return (
    <div className="card console-card console-actions">
      {/* "This browser only" is said once, on the card heading — each row
          under it used to open with "Browser-side." as well. */}
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Control</span>
          <h2>Session controls</h2>
        </div>
        <span className="section-note">This browser only. No server state is mutated.</span>
      </div>

      <div className="console-action console-action--client">
        <div className="console-action__head">
          <strong>Reconnect WebSockets</strong>
          <div className="console-action__controls">
            <button type="button" onClick={onReconnectSockets} disabled={socketCount === 0}>
              Cycle {socketCount} {socketCount === 1 ? "socket" : "sockets"}
            </button>
          </div>
        </div>
        <small className="muted">
          Drops and re-handshakes every exchange socket this tab owns.
          {socketCount === 0 && " No socket is open; the wire tap opens them when on screen."}
        </small>
      </div>

      <div className="console-action console-action--client">
        <div className="console-action__head">
          <strong>Health snapshot cadence</strong>
          <div className="seg console-seg" role="group" aria-label="System health poll cadence">
            {CADENCES.map((cadence) => (
              <button
                key={cadence.label}
                type="button"
                aria-pressed={pollMs === cadence.ms}
                onClick={() => onPollMsChange(cadence.ms)}
              >
                {cadence.label}
              </button>
            ))}
          </div>
        </div>
        <small className="muted">
          Unattended ticks are sent at <code>background</code> priority, so a 1s loop cannot spend
          the interactive budget.
        </small>
      </div>

      {/* The summary asks what the body answers. It used to state the card's
          own heading back at the reader — "This browser only. No server state
          is mutated." is the section-note six lines above — and the scope notes
          underneath answer a different question than the one it posed. */}
      <details className="disclosure">
        <summary>What each session control touches</summary>
        <dl className="operator-scope-notes">
          <dt>Reconnect WebSockets</dt>
          <dd>Resets the backoff and the sequence guard rather than waiting one out.</dd>
          <dt>Health snapshot cadence</dt>
          <dd>Background priority is fenced out of each provider&rsquo;s interactive reserve; only an explicit <em>Refresh now</em> is interactive.</dd>
        </dl>
      </details>

    </div>
  );
}
