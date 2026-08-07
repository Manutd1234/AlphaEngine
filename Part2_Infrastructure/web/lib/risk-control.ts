/**
 * Client half of the guarded risk-control write path.
 * ===================================================
 *
 * One place shapes the request and classifies the response for every surface
 * that can halt, resume or flatten — the header kill switch and both
 * ExecutionHandoff mounts. Before this module existed, ExecutionHandoff built
 * its own fetch and never attached the operator credential, so a token-guarded
 * deployment answered every halt with a silent 401. Centralising the shaping
 * makes that class of bug structural rather than per-callsite.
 *
 * The confirmation stays typed-by-human: `confirm` passes through verbatim and
 * nothing here fills it in. The server normalises and compares — a client that
 * auto-validated the word would be a second click wearing a costume.
 */

import type { GuardMode } from "@/components/systems/types";

export type RiskAction = "halt" | "resume" | "flatten" | "cancel_all";

/** Mirror of CONFIRM_WORD in app/api/gateway/risk/route.ts. */
export const RISK_CONFIRM_WORD: Record<RiskAction, string> = {
  halt: "HALT",
  resume: "RESUME",
  flatten: "FLATTEN",
  cancel_all: "CANCEL",
};

/** Same normalisation the route applies before comparing. */
export function confirmArms(typed: string, action: RiskAction): boolean {
  return typed.trim().toUpperCase() === RISK_CONFIRM_WORD[action];
}

export interface RiskRequestInput {
  action: RiskAction;
  /** The literal typed word — callers must never fill this in themselves. */
  confirm: string;
  reason?: string;
  symbol?: string;
  /** systems.token; empty or whitespace means the header is omitted. */
  operatorToken?: string;
}

export interface ShapedRiskRequest {
  url: "/api/gateway/risk";
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

/**
 * JSON headers with the operator credential attached iff a token is set.
 * Every guarded write surface (risk actions, order ticket) must build its
 * headers here — the two silent-401 bugs this repo has had were both a
 * hand-rolled fetch that forgot the header.
 */
export function operatorHeaders(operatorToken?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = operatorToken?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function buildRiskRequest(input: RiskRequestInput): ShapedRiskRequest {
  return {
    url: "/api/gateway/risk",
    method: "POST",
    body: JSON.stringify({
      action: input.action,
      confirm: input.confirm,
      ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
    }),
    headers: operatorHeaders(input.operatorToken),
  };
}

export type RiskSubmitCode =
  | "ok"
  | "needs_confirmation"
  | "unauthorised"
  | "locked"
  | "gateway_missing"
  | "gateway_failed"
  | "invalid"
  | "network";

export interface RiskSubmitResult {
  ok: boolean;
  status: number;
  code: RiskSubmitCode;
  /** UI-ready one-liner. */
  message: string;
  /** The route's body, relayed for detail rendering (summary/orders/hint). */
  body: Record<string, unknown> | null;
}

/** Maps the route's status/code contract to UI-facing outcomes. */
export function classifyRiskResponse(status: number, body: unknown): RiskSubmitResult {
  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const code = typeof record?.code === "string" ? record.code : null;
  const summary = typeof record?.summary === "string" ? record.summary : null;
  const error = typeof record?.error === "string" ? record.error : null;

  if (status >= 200 && status < 300) {
    return { ok: true, status, code: "ok", message: summary ?? "Action accepted.", body: record };
  }
  if (status === 428) {
    return {
      ok: false,
      status,
      code: "needs_confirmation",
      message: error ?? "Type the confirmation word to proceed.",
      body: record,
    };
  }
  if (status === 401) {
    return {
      ok: false,
      status,
      code: "unauthorised",
      message: "The operator credential was rejected — check the token entered on the Reliability tab.",
      body: record,
    };
  }
  if (status === 503 && code === "operator_actions_disabled") {
    return { ok: false, status, code: "locked", message: error ?? "Operator actions are disabled here.", body: record };
  }
  if (status === 503 && code === "gateway_not_configured") {
    return {
      ok: false,
      status,
      code: "gateway_missing",
      message: error ?? "No risk gateway is connected in this environment.",
      body: record,
    };
  }
  if (status === 502 || status === 504) {
    const hint = typeof record?.hint === "string" ? ` ${record.hint}` : "";
    return { ok: false, status, code: "gateway_failed", message: `${error ?? "The risk gateway did not accept the action."}${hint}`, body: record };
  }
  return { ok: false, status, code: "invalid", message: error ?? `The request was refused (HTTP ${status}).`, body: record };
}

export async function submitRiskAction(
  input: RiskRequestInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RiskSubmitResult> {
  const shaped = buildRiskRequest(input);
  try {
    const response = await fetchImpl(shaped.url, {
      method: shaped.method,
      headers: shaped.headers,
      body: shaped.body,
    });
    const body = await response.json().catch(() => null);
    return classifyRiskResponse(response.status, body);
  } catch (err) {
    return {
      ok: false,
      status: 0,
      code: "network",
      message: `The request did not reach the server: ${err instanceof Error ? err.message : "unknown error"}`,
      body: null,
    };
  }
}

export interface RiskControlInfo {
  actions: RiskAction[];
  confirm: Record<RiskAction, string>;
  guard: { mode: GuardMode; tokenEnv: string };
  gatewayConnected: boolean;
}

/** Pre-flight probe: what this deployment permits, before anything is typed. */
export async function fetchRiskControl(fetchImpl: typeof fetch = fetch): Promise<RiskControlInfo | null> {
  try {
    const response = await fetchImpl("/api/gateway/risk", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as RiskControlInfo;
  } catch {
    return null;
  }
}
