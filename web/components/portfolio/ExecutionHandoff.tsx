"use client";

/**
 * The boundary, made usable instead of merely stated.
 *
 * This tab cannot flatten a book or trim a position, and that is not a missing
 * feature — it is the architecture. Order submission, sizing and the kill switch
 * live behind the authenticated gateway; the browser never holds that
 * credential, and the same rule is why the Telegram companion is read-only. A
 * button here that moved real risk would make the claim in both READMEs false.
 *
 * But "you cannot do that here" is a dead end, and a dead end is what this whole
 * surface is meant to remove. So the handoff produces the *exact* authenticated
 * request an operator runs against their own gateway — endpoint, method, body,
 * and where the token comes from. That is genuinely faster than a button would
 * have been for anyone who has to justify the action afterwards, because what
 * they paste is what the audit log records.
 *
 * The gateway origin is deliberately not embedded. It is a server-only variable
 * (`ALPHAENGINE_GATEWAY_URL`) and shipping it to the browser to make a link
 * clickable would leak the one piece of topology this design keeps private.
 */

import { useState } from "react";

import { usd } from "@/lib/format";

export type HandoffIntent =
  | { kind: "flatten_all" }
  | { kind: "flatten_symbol"; symbol: string; side: "LONG" | "SHORT"; notional: number }
  | { kind: "halt" };

interface ExecutionHandoffProps {
  intent: HandoffIntent | null;
  onClose: () => void;
  /** Sandbox books describe a position that does not exist. */
  sandbox: boolean;
}

function requestFor(intent: HandoffIntent): { title: string; method: string; path: string; body?: string; why: string } {
  switch (intent.kind) {
    case "halt":
      return {
        title: "Halt trading",
        method: "POST",
        path: "/api/risk/kill",
        body: JSON.stringify({ reason: "manual halt from portfolio review" }, null, 2),
        why: "Trips the gateway's kill switch. Every subsequent pre-trade check rejects until it is cleared, and the event is appended to the audit log.",
      };
    case "flatten_all":
      return {
        title: "Flatten the book",
        method: "POST",
        path: "/api/orders/flatten",
        body: JSON.stringify({ scope: "all", reason: "risk reduction" }, null, 2),
        why: "Submits closing orders for every open position through the same 12 pre-trade gates as any other order — it is not a bypass.",
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
            reason: "position close from portfolio review",
          },
          null,
          2,
        ),
        why: "A closing order in the opposite direction, sized to the current notional. It passes the same risk gates as an opening order.",
      };
  }
}

export default function ExecutionHandoff({ intent, onClose, sandbox }: ExecutionHandoffProps) {
  const [copied, setCopied] = useState(false);
  if (!intent) return null;

  const req = requestFor(intent);
  const curl = [
    `curl -X ${req.method} "$ALPHAENGINE_GATEWAY_URL${req.path}" \\`,
    `  -H "Authorization: Bearer $WEB_API_TOKEN" \\`,
    `  -H "Content-Type: application/json" \\`,
    req.body ? `  -d '${req.body.replace(/\n\s*/g, " ")}'` : "",
  ].filter(Boolean).join("\n");

  return (
    <div className="handoff-panel" role="dialog" aria-modal="false" aria-labelledby="handoff-title">
      <div className="handoff-head">
        <div>
          <span className="page-kicker">Execution handoff</span>
          <h3 id="handoff-title">{req.title}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close handoff">
          Close
        </button>
      </div>

      {sandbox && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>This is the sandbox book.</strong> The position below does not exist, so the
            request is shown to illustrate the shape only — running it would act on your real book.
          </div>
        </div>
      )}

      <p className="sub">
        This workspace cannot submit orders. It holds no gateway credential, by design — the same
        reason the Telegram companion can report a halt but never trigger one. Run this against your
        own gateway, where it is authenticated, gated and audited.
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
          {req.why}
        </small>
      </div>
    </div>
  );
}
