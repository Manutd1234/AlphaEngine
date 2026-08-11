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
 * entered in either place arms both. There is no client-side RBAC: the app has
 * no user system, and "may this request change something" is answered
 * server-side by the operator guard.
 *
 * After a successful action the panel re-reads server state (`onExecuted` →
 * book + health refresh) instead of setting an optimistic flag — the server
 * decides what happened, not the button that asked.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { OctagonX } from "lucide-react";

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

export default function KillSwitchControl({
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
      if (alive) setGatewayConnected(info ? info.gatewayConnected : false);
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
    <span ref={wrapper} className="relative inline-flex">
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
            ? "inline-flex items-center gap-1.5 rounded-[9px] border border-[#b3242e] bg-[#b3242e] px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.04em] text-white"
            : "inline-flex items-center gap-1.5 rounded-[9px] border border-transparent bg-transparent px-2 py-1.5 text-[11px] font-semibold text-text-secondary hover:border-border hover:bg-surface-2"
        }
      >
        <OctagonX size={14} aria-hidden />
        <span className={halted ? undefined : "max-[520px]:hidden"}>
          {halted ? "HALTED" : "Kill switch"}
        </span>
      </button>

      {open && (
        <div
          id="kill-switch-panel"
          role="dialog"
          aria-modal="false"
          aria-labelledby="kill-switch-title"
          className="absolute right-0 top-[calc(100%+10px)] z-[60] w-[min(340px,calc(100vw-28px))] rounded-card border border-border bg-surface-1 p-4 shadow-card"
        >
          <span className="page-kicker">Circuit breaker</span>
          <h3 id="kill-switch-title" className="mt-0.5 text-[15px]">
            {halted ? "Resume trading" : "Halt trading"}
          </h3>
          <p className="mt-1 text-[11.5px] leading-snug text-text-secondary">
            {halted
              ? `The kill switch is active${halt?.haltedSymbols.length ? ` for ${halt.haltedSymbols.join(", ")}` : " across the book"}. Resuming re-opens the pre-trade gates.`
              : "Trips the gateway's kill switch: every subsequent pre-trade check rejects until it is cleared, and the event lands in the audit log."}
          </p>

          <p className="mt-2 flex items-center gap-1.5 text-[11px]">
            {gatewayConnected === null ? (
              <span className="text-text-muted">Checking gateway connection…</span>
            ) : gatewayConnected ? (
              <span className="text-success-text"><span aria-hidden>🟢</span> GATEWAY ONLINE · guard: {riskControl.guardMode}</span>
            ) : (
              <span className="text-critical-text"><span aria-hidden>🔴</span> GATEWAY OFFLINE — Run <code className="font-mono">python -m uvicorn main:app --port 8000</code></span>
            )}
            {halt?.sandbox && <span className="text-notice-text">· sandbox mode</span>}
          </p>

          <label className="mt-3 block text-[11px] font-semibold text-text-secondary" htmlFor="kill-switch-reason">
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
              <label className="mt-2.5 block text-[11px] font-semibold text-text-secondary" htmlFor="kill-switch-token">
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

          <label className="mt-2.5 block text-[11px] font-semibold text-text-secondary" htmlFor="kill-switch-confirm">
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
            <small id="kill-switch-blocked" className="mt-1.5 block text-[10.5px] text-text-muted">
              <span aria-hidden>◌</span> {gate.blockedReason}
            </small>
          )}

          {result && (
            <div className={`banner ${result.ok ? "context-change" : "error"} mt-3`} role={result.ok ? "status" : "alert"}>
              <span aria-hidden>{result.ok ? "✓" : "✕"}</span>
              <div>{result.message}</div>
            </div>
          )}
        </div>
      )}
    </span>
  );
}
