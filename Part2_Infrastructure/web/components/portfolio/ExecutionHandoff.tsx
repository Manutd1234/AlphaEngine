"use client";

/**
 * Risk actions — the one place this workspace can change a live book.
 *
 * It used to only *compose* the request and hand it to an operator, on the
 * argument that the browser holds no gateway credential. That argument still
 * holds and is why the credential still never reaches the browser: the request
 * is relayed by `POST /api/gateway/risk`, server-side, with the token read from
 * the environment at call time.
 *
 * What changed is that pasting a curl command into a terminal during a drawdown
 * is not a safety property, it is a delay. So the action can now be executed
 * here — behind three things that a click alone cannot satisfy:
 *
 *  1. **A typed confirmation.** The literal word, not a second button. A
 *     confirm flag the UI sets for itself is not a confirmation.
 *  2. **The operator gate.** Production refuses without
 *     `ALPHAENGINE_OPERATOR_TOKEN`, exactly as the systems console does. Being
 *     able to *read* a book must not imply being able to flatten it.
 *  3. **A connected gateway.** With none configured there is nothing
 *     authoritative to act on, and the route says so rather than pretending.
 *
 * The composed request stays on screen either way. Someone auditing what the
 * button did should not have to read this file to find out.
 */

import { useEffect, useState } from "react";

import { usd } from "@/lib/format";
import { fetchRiskControl, submitRiskAction } from "@/lib/risk-control";

export type HandoffIntent =
  | { kind: "flatten_all" }
  | { kind: "flatten_symbol"; symbol: string; side: "LONG" | "SHORT"; notional: number }
  | { kind: "halt" };

interface ExecutionHandoffProps {
  intent: HandoffIntent | null;
  onClose: () => void;
  /** Sandbox books describe a position that does not exist. */
  sandbox: boolean;
  /** Re-read the book after something actually changed. */
  onExecuted?: () => void;
  /**
   * The operator credential from the Reliability tab. Without it, a
   * token-guarded deployment answers every action with a 401 — which this
   * component used to trigger silently by never sending the header at all.
   */
  operatorToken?: string;
}

interface ActionResult {
  ok?: boolean;
  code?: string;
  error?: string;
  hint?: string;
  summary?: string;
  caveat?: string;
  orders?: Array<{ symbol: string; side: string; notional: number; accepted: boolean }>;
}

interface Composed {
  title: string;
  method: string;
  path: string;
  body?: string;
  why: string;
  /** What `/api/gateway/risk` is asked to do, and the word that unlocks it. */
  action: "halt" | "flatten";
  confirmWord: string;
  symbol?: string;
}

function requestFor(intent: HandoffIntent): Composed {
  switch (intent.kind) {
    case "halt":
      return {
        title: "Halt trading",
        method: "POST",
        path: "/api/risk/kill",
        body: JSON.stringify({ reason: "manual halt from portfolio review" }, null, 2),
        why: "Trips the gateway's kill switch: every pre-trade check rejects until it is cleared, and the event is appended to the audit log.",
        action: "halt",
        confirmWord: "HALT",
      };
    case "flatten_all":
      return {
        title: "Flatten the book",
        method: "POST",
        // One risk-gated order per open position. The gateway has no flatten
        // endpoint — this card used to name `/api/orders/flatten`, which does
        // not exist and would have 404ed for anyone who ran it.
        path: "/api/orders (one per open position)",
        body: JSON.stringify({ symbol: "<each position>", side: "<opposite>", order_type: "MARKET" }, null, 2),
        why: "Submits a closing order for every open position through the same pre-trade gates as any other order, one at a time so they cannot race the gateway's exposure accounting.",
        action: "flatten",
        confirmWord: "FLATTEN",
      };
    case "flatten_symbol":
      return {
        title: `Close ${intent.symbol}`,
        method: "POST",
        path: "/api/orders",
        body: JSON.stringify(
          {
            symbol: intent.symbol,
            side: intent.side === "LONG" ? "SELL" : "BUY",
            notional: Math.round(intent.notional),
            order_type: "MARKET",
            strategy: "flatten",
          },
          null,
          2,
        ),
        why: "A closing order in the opposite direction, sized to the current notional, through the same risk gates as an opening order.",
        action: "flatten",
        confirmWord: "FLATTEN",
        symbol: intent.symbol,
      };
  }
}

export default function ExecutionHandoff({ intent, onClose, sandbox, onExecuted, operatorToken }: ExecutionHandoffProps) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [guard, setGuard] = useState<{ mode: string; gatewayConnected: boolean } | null>(null);

  // Re-arm on every new intent: a confirmation typed for one action must never
  // carry over and unlock a different one.
  useEffect(() => {
    setConfirm("");
    setResult(null);
  }, [intent]);

  useEffect(() => {
    let alive = true;
    void fetchRiskControl().then((info) => {
      if (!alive) return;
      setGuard(
        info
          ? { mode: info.guard.mode, gatewayConnected: info.gatewayConnected }
          : { mode: "locked", gatewayConnected: false },
      );
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!intent) return null;

  const req = requestFor(intent);
  const curl = [
    `curl -X POST "$ALPHAENGINE_GATEWAY_URL${req.path.split(" ")[0]}" \\`,
    // The gateway authenticates with its own header, not a bearer token. The
    // previous copy said Authorization: Bearer, which the gateway ignores.
    `  -H "X-AlphaEngine-Token: $WEB_API_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    req.body ? `  -d '${req.body.replace(/\n\s*/g, " ")}'` : "",
  ].filter(Boolean).join("\n");

  const locked = guard?.mode === "locked";
  const noGateway = guard !== null && !guard.gatewayConnected;
  const tokenMissing = guard?.mode === "token" && !operatorToken?.trim();
  const armed = confirm.trim().toUpperCase() === req.confirmWord;
  const canExecute = !sandbox && !locked && !noGateway && !tokenMissing && armed && !busy;

  const blockedReason = sandbox
    ? "This is the sandbox book — there is no real position to act on."
    : noGateway
      ? "No risk gateway is connected in this environment."
      : locked
        ? "Actions are disabled on this deployment until ALPHAENGINE_OPERATOR_TOKEN is set."
        : tokenMissing
          ? "Enter the operator token on the Reliability tab to arm actions."
          : !armed
            ? `Type ${req.confirmWord} to arm.`
            : null;

  const execute = async () => {
    setBusy(true);
    setResult(null);
    // The confirm word here is what the operator typed — `armed` above proved
    // it matches, so passing it through keeps the server as the judge.
    const outcome = await submitRiskAction({
      action: req.action,
      confirm: confirm,
      symbol: req.symbol,
      reason: "manual action from portfolio review",
      operatorToken,
    });
    const relayed = (outcome.body ?? {}) as ActionResult;
    setResult({
      ...relayed,
      ok: outcome.ok,
      error: outcome.ok ? relayed.error : outcome.message,
    });
    if (outcome.ok) {
      setConfirm("");
      onExecuted?.();
    }
    setBusy(false);
  };

  return (
    <div className="handoff-panel" role="dialog" aria-modal="false" aria-labelledby="handoff-title">
      <div className="handoff-head">
        <div>
          <span className="page-kicker">Risk action</span>
          <h3 id="handoff-title">{req.title}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </div>

      {sandbox && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>This is the sandbox book.</strong> The position below does not exist, so
            execution is disabled; the request is shown for its shape only.
          </div>
        </div>
      )}

      <p className="sub">
        {req.why}
      </p>

      <pre className="handoff-request" tabIndex={0}>{curl}</pre>

      <div className="handoff-actions">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(curl).then(
              () => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              },
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Copied ✓" : "Copy request"}
        </button>
        <small className="muted">
          {intent.kind === "flatten_symbol" && `Closes ${usd(intent.notional, 0)} of ${intent.symbol}. `}
          The credential is read server-side and never reaches this browser.
        </small>
      </div>

      {/* ---- execute ------------------------------------------------------ */}
      <div className="handoff-execute">
        <label htmlFor="handoff-confirm">
          Type <strong>{req.confirmWord}</strong> to arm this action
        </label>
        <div className="handoff-execute__row">
          <input
            id="handoff-confirm"
            type="text"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder={req.confirmWord}
            autoComplete="off"
            spellCheck={false}
            disabled={sandbox || locked || noGateway}
            aria-describedby="handoff-blocked"
          />
          <button
            type="button"
            className="handoff-fire"
            onClick={() => void execute()}
            disabled={!canExecute}
            title={blockedReason ?? `Send this ${req.action} to the gateway`}
          >
            {busy ? "Sending…" : req.title}
          </button>
        </div>
        {blockedReason && (
          <small id="handoff-blocked" className="muted">
            <span aria-hidden>◌</span> {blockedReason}
          </small>
        )}
      </div>

      {result && (
        <div className={`banner ${result.ok ? "context-change" : "error"}`} role={result.ok ? "status" : "alert"}>
          <span aria-hidden>{result.ok ? "✓" : "✕"}</span>
          <div>
            <strong>{result.summary ?? result.error}</strong>
            {result.caveat && <small className="handoff-note">{result.caveat}</small>}
            {result.hint && <small className="handoff-note">{result.hint}</small>}
            {result.orders && result.orders.length > 0 && (
              <ul className="handoff-orders">
                {result.orders.map((o) => (
                  <li key={o.symbol}>
                    <span aria-hidden>{o.accepted ? "✓" : "✕"}</span> {o.side} {o.symbol}{" "}
                    {usd(o.notional, 0)}
                    <span className="muted">{o.accepted ? " accepted" : " rejected by the gates"}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
