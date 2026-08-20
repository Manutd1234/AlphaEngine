"use client";

/**
 * The global kill switch — the emergency control that used to live three
 * levels deep in the Risk tab, now one click from anywhere.
 *
 * It is the first anchored dropdown in this app, and deliberately NOT a modal:
 * the house pattern is the inline panel (`role="dialog" aria-modal="false"`,
 * precedent in ExecutionHandoff), dismissal is Escape or clicking away, and
 * focus is never trapped.
 *
 * The confirmation doctrine is unchanged from ExecutionHandoff: the operator
 * types the literal word — HALT, or RESUME when already halted — and, on
 * token-guarded deployments, supplies the operator credential. That credential
 * is the same state the Reliability tab edits (`systems.token`), so a token
 * entered in either place arms both. There is no client-side RBAC: signing in
 * establishes who you are for the sake of your own preferences, and answers
 * nothing about authority — "may this request change something" is decided
 * server-side by the operator guard, for signed-in and anonymous alike.
 *
 * After a successful action the panel re-reads server state (`onExecuted` →
 * book + health refresh) instead of setting an optimistic flag — the server
 * decides what happened, not the button that asked.
 */

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { OctagonX } from "lucide-react";

import AnchoredPanel from "@/components/header/AnchoredPanel";
import type { GuardMode } from "@/components/systems/types";
import { killSwitchGate } from "@/lib/overview-state";
import {
  type RiskSubmitResult,
  fetchRiskControl,
  submitRiskAction,
} from "@/lib/risk-control";

export interface KillSwitchHaltState {
  halted: boolean;
  haltedSymbols: string[];
  sandbox: boolean;
}

export interface KillSwitchRiskControl {
  guardMode: GuardMode;
  token: string;
  onTokenChange: (token: string) => void;
  /** Re-read book + health after the server accepted a change. */
  onExecuted: () => void;
}

function KillSwitchControl({
  halt,
  riskControl,
}: {
  /** Null while the book is still connecting. */
  halt: KillSwitchHaltState | null;
  riskControl: KillSwitchRiskControl;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RiskSubmitResult | null>(null);
  const [gatewayConnected, setGatewayConnected] = useState<boolean | null>(null);
  const [gatewayReason, setGatewayReason] = useState<string | null>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirmInput = useRef<HTMLInputElement>(null);

  const halted = Boolean(halt?.halted);

  // Fresh probe per open — guard mode and gateway reachability are the two
  // facts that decide what this panel may do.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setResult(null);
    void fetchRiskControl().then((info) => {
      if (!alive) return;
      setGatewayConnected(info ? info.gatewayConnected : false);
      setGatewayReason(
        info
          ? info.gatewayReason ?? null
          : "This deployment's risk route did not answer.",
      );
    });
    confirmInput.current?.focus();
    return () => {
      alive = false;
    };
  }, [open]);

  // Re-arm whenever the direction flips: a word typed to halt must never
  // carry over and unlock the resume.
  useEffect(() => {
    setTyped("");
  }, [halted]);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const gate = killSwitchGate({
    typed,
    halted,
    guard: riskControl.guardMode,
    token: riskControl.token,
    gatewayConnected,
    busy,
  });

  const fire = async () => {
    setBusy(true);
    setResult(null);
    const outcome = await submitRiskAction({
      action: gate.action,
      confirm: typed,
      reason: reason.trim() || undefined,
      operatorToken: riskControl.token,
    });
    setResult(outcome);
    if (outcome.ok) {
      setTyped("");
      setReason("");
      riskControl.onExecuted();
    }
    setBusy(false);
  };

  return (
    <span ref={wrapper} className="header-anchor">
      <button
        ref={trigger}
        type="button"
        onClick={() => (open ? close(true) : setOpen(true))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="kill-switch-panel"
        aria-label={halted ? "Trading is halted — open the resume control" : "Open the kill switch"}
        title={halted ? "Trading is halted" : "Guarded circuit breaker — halts all execution intents"}
        className={
          halted
            /* Sanctioned fixed red: --status-critical fails contrast with white
               text in dark theme (2.82:1); #b3242e carries it at 6.55:1 in both
               themes — same rationale as .handoff-fire in globals.css. */
            ? "inline-flex items-center gap-1.5 rounded-[9px] border border-[#b3242e] bg-[#b3242e] px-2.5 py-1.5 text-fs-chrome-chip font-bold uppercase tracking-[0.04em] text-white"
            : "inline-flex items-center gap-1.5 rounded-[9px] border border-transparent bg-transparent px-2 py-1.5 text-fs-chrome-chip font-semibold text-text-secondary hover:border-border hover:bg-surface-2"
        }
      >
        <OctagonX size={14} aria-hidden />
        {/* HALTED never folds: a halted desk says so in words at every width.
            The resting label follows the header's priority ladder (globals.css)
            and the ≤520px rule; aria-label and title carry it throughout. */}
        <span className={halted ? undefined : "header-kill-label max-[520px]:hidden"}>
          {halted ? "HALTED" : "Kill switch"}
        </span>
      </button>

      {open && (
        <AnchoredPanel id="kill-switch-panel" labelledBy="kill-switch-title" width={340}>
          <span className="page-kicker">Circuit breaker</span>
          <h3 id="kill-switch-title" className="mt-0.5 text-fs-title">
            {halted ? "Resume trading" : "Halt trading"}
          </h3>
          <p className="mt-1 text-fs-body leading-snug text-text-secondary">
            {halted
              ? `The kill switch is active${halt?.haltedSymbols.length ? ` for ${halt.haltedSymbols.join(", ")}` : " across the book"}. Resuming re-opens the pre-trade gates.`
              : "Every subsequent pre-trade check rejects until trading is resumed, and the event lands in the audit log."}
          </p>

          {/* ONLINE now means the gateway answered a health probe, not that a
              URL is set. The offline branch prints the reason the probe gave
              rather than guessing at a stopped local server — a deployed desk
              has no uvicorn to restart, and that instruction was the only thing
              it offered. */}
          <p className="mt-2 flex items-center gap-1.5 text-fs-sm">
            {gatewayConnected === null ? (
              <span className="text-text-muted">Checking gateway connection…</span>
            ) : gatewayConnected ? (
              <span className="text-success-text"><span aria-hidden>●</span> GATEWAY ONLINE; guard {riskControl.guardMode}</span>
            ) : (
              <span className="text-critical-text"><span aria-hidden>✕</span> GATEWAY UNREACHABLE</span>
            )}
            {halt?.sandbox && <span className="text-notice-text">; sandbox mode</span>}
          </p>
          {gatewayConnected === false && gatewayReason && (
            <p className="mt-1 text-fs-sm leading-snug text-text-secondary">
              {gatewayReason}{" "}
              {gatewayReason.startsWith("No gateway URL")
                ? "Set ALPHAENGINE_GATEWAY_URL, or run the gateway locally with "
                : "If you are running the desk locally, start the gateway with "}
              <code className="font-mono">python -m uvicorn main:app --port 8000</code>.
            </p>
          )}

          <label className="mt-3 block text-fs-sm font-semibold text-text-secondary" htmlFor="kill-switch-reason">
            Reason (audited)
          </label>
          <input
            id="kill-switch-reason"
            type="text"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={halted ? "why resume now" : "why halt now"}
            autoComplete="off"
            className="mt-1 w-full"
          />

          {riskControl.guardMode === "token" && (
            <>
              <label className="mt-2.5 block text-fs-sm font-semibold text-text-secondary" htmlFor="kill-switch-token">
                Operator token <span className="font-normal text-text-muted">(shared with the Reliability tab)</span>
              </label>
              <input
                id="kill-switch-token"
                type="password"
                value={riskControl.token}
                onChange={(event) => riskControl.onTokenChange(event.target.value)}
                autoComplete="off"
                className="mt-1 w-full"
              />
            </>
          )}

          <label className="mt-2.5 block text-fs-sm font-semibold text-text-secondary" htmlFor="kill-switch-confirm">
            Type <strong className="font-mono">{gate.confirmWord}</strong> to arm
          </label>
          <div className="mt-1 flex gap-2">
            <input
              ref={confirmInput}
              id="kill-switch-confirm"
              type="text"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={gate.confirmWord}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="kill-switch-blocked"
              className="w-full font-mono uppercase tracking-[0.08em]"
            />
            <button
              type="button"
              className="handoff-fire"
              onClick={() => void fire()}
              disabled={!gate.canFire}
              title={gate.blockedReason ?? `Send the ${gate.action} to the gateway`}
            >
              {busy ? "Sending…" : halted ? "Resume" : "Halt"}
            </button>
          </div>
          {gate.blockedReason && (
            <small id="kill-switch-blocked" className="mt-1.5 block text-fs-xs text-text-muted">
              <span aria-hidden>◌</span> {gate.blockedReason}
            </small>
          )}

          {result && (
            <div className={`banner ${result.ok ? "context-change" : "error"} mt-3`} role={result.ok ? "status" : "alert"}>
              <span aria-hidden>{result.ok ? "✓" : "✕"}</span>
              <div>{result.message}</div>
            </div>
          )}
        </AnchoredPanel>
      )}
    </span>
  );
}

/**
 * Memoised, and the two props it takes are objects, so the header rebuilds
 * them with `useMemo` over the fields rather than passing the literals the
 * dashboard writes inline — otherwise the comparison is two fresh objects
 * every render and the memo is decoration.
 *
 * The reason it is worth doing here rather than anywhere: this control is
 * always mounted, holds the confirmation state an operator is part-way through
 * typing, and re-renders on nothing a feed can say. Halted or not is the whole
 * of its input, and it is a boolean that changes when somebody decides it does.
 */
export default memo(KillSwitchControl);
