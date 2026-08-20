"use client";

/**
 * Who may act here, and as whom — answered before any button is read.
 *
 * Split out of `OperatorPanel` because it answers a different question from
 * everything else on that surface. The controls answer "what can I do and what
 * will it cost"; this answers "am I allowed to, and does this deployment know
 * who I am". They share a card and nothing else: this block reads the guard
 * mode and the credential, and touches none of the actions.
 *
 * WHAT DELIBERATELY DID NOT MOVE. Every cost sentence stayed in `OperatorPanel`
 * beside the button that spends it — the purge that sends the next request
 * upstream, the quota reset that clears our count and not the vendor's, the
 * telemetry clear that destroys the evidence that led here. Costs travel with
 * the control, because the person clicking is usually the person who will be
 * surprised by the bill. Authorisation does not, because it is one state for
 * the whole surface.
 *
 * The guard's state is visible before anything is clicked: on a production
 * deployment without the operator token the actions are refused server-side,
 * and showing enabled buttons that 503 would be a worse experience than showing
 * disabled ones with the reason attached.
 */

import type { GuardMode } from "./types";

interface OperatorGuardProps {
  guard: GuardMode;
  tokenEnv: string;
  token: string;
  onTokenChange: (token: string) => void;
  /** Open mode with a server token set — typing a credential can elevate the tab. */
  tokenOverrideAvailable: boolean;
  /** Server-checked state of the entered token; drives the badge, not the gate. */
  tokenStatus: "none" | "checking" | "valid" | "rejected";
}

export default function OperatorGuard({
  guard,
  tokenEnv,
  token,
  onTokenChange,
  tokenOverrideAvailable,
  tokenStatus,
}: OperatorGuardProps) {
  return (
    <>
      {guard === "locked" && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Actions are disabled on this deployment.</strong> Every action spends real
            upstream quota, so a production build refuses them unless <code>{tokenEnv}</code> is set
            on the server. Read-only telemetry above is unaffected.
          </div>
        </div>
      )}

      {(guard === "token" || tokenOverrideAvailable) && (
        <label className="console-token">
          <span>
            {guard === "token"
              ? "Operator token"
              : "Operator token — optional, overrides demo mode for this tab"}
          </span>
          <div className="console-token__row">
            <input
              type="password"
              value={token}
              onChange={(event) => onTokenChange(event.target.value)}
              placeholder={tokenEnv}
              autoComplete="off"
              spellCheck={false}
            />
            {token !== "" && (
              <button
                type="button"
                className="console-node__action"
                onClick={() => onTokenChange("")}
                title="Forget the token and return this tab to its default identity."
              >
                Clear
              </button>
            )}
          </div>
          <small className="muted" role="status">
            {tokenStatus === "valid" ? (
              <span style={{ color: "var(--success-text)" }}>
                <span aria-hidden>✓</span> Authenticated operator — the credential was checked and
                every action from this tab carries it.
              </span>
            ) : tokenStatus === "rejected" ? (
              <span style={{ color: "var(--critical-text)" }}>
                <span aria-hidden>✕</span> The operator credential was rejected — actions will fail
                until it is fixed or cleared.
              </span>
            ) : tokenStatus === "checking" ? (
              "Checking the credential…"
            ) : (
              "Kept in this tab's session storage — survives a reload, gone when the tab closes; never logged."
            )}
          </small>
          {token !== "" && tokenStatus !== "none" && (
            <small className="muted">
              Kept in this tab&rsquo;s session storage — survives a reload, gone when the tab
              closes; never logged.
            </small>
          )}
        </label>
      )}

      {guard === "open-dev" && (
        <p className="console-note">
          Non-production build: actions are open. Set <code>{tokenEnv}</code> before deploying, or
          they will be refused there.
        </p>
      )}

      {guard === "open-demo" && (
        <p className="console-note">
          <strong>Demo deployment: operator actions are open to anyone with this URL.</strong> No
          token is asked — orders, risk actions and remediation all work directly. That is
          deliberate (<code>ALPHAENGINE_OPERATOR_OPEN=1</code>) for a paper-trading assessment:
          orders are paper and capped by the gateway&rsquo;s gates, the kill switch reverses, purged
          caches refill. A typed credential is still checked and authoritative here; unset the flag
          to require one again.
        </p>
      )}
    </>
  );
}
