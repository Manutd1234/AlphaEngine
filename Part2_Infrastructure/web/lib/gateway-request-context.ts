/** Bounded, sanitised context carried across the browser-to-gateway hop. */

import { randomUUID } from "node:crypto";

export const GATEWAY_REQUEST_ID_HEADER = "X-AlphaEngine-Request-Id";
export const GATEWAY_BUDGET_CLASS_HEADER = "X-AlphaEngine-Budget-Class";
export const GATEWAY_BUDGET_MS_HEADER = "X-AlphaEngine-Budget-Ms";
export const GATEWAY_REMAINING_BUDGET_HEADER = "X-AlphaEngine-Remaining-Budget-Ms";

export const GATEWAY_BUDGETS_MS = {
  H1: 3_000,
  H2: 8_000,
  H3: 15_000,
  H4: 25_000,
} as const;

export type GatewayBudgetClass = keyof typeof GATEWAY_BUDGETS_MS;

export interface GatewayRequestContext {
  readonly requestId: string;
  readonly budgetClass: GatewayBudgetClass;
  readonly totalBudgetMs: number;
  readonly startedAtMs: number;
  readonly deadlineAtMs: number;
  readonly signal: AbortSignal;
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function isBudgetClass(value: string | null): value is GatewayBudgetClass {
  return value != null && Object.hasOwn(GATEWAY_BUDGETS_MS, value);
}

function boundedClass(requested: string | null, ceiling: GatewayBudgetClass): GatewayBudgetClass {
  if (!isBudgetClass(requested)) return ceiling;
  return GATEWAY_BUDGETS_MS[requested] <= GATEWAY_BUDGETS_MS[ceiling] ? requested : ceiling;
}

function safeRequestId(candidate: string | null): string {
  const trimmed = candidate?.trim() ?? "";
  return REQUEST_ID.test(trimmed) ? trimmed : randomUUID();
}

/**
 * Build a context from a fixed route ceiling. The incoming millisecond header
 * is deliberately ignored: callers may request a known class, never invent a
 * duration or widen the route selected by the server.
 */
export function gatewayRequestContext(
  request: Request,
  ceiling: GatewayBudgetClass,
  now = Date.now(),
  requestIdCandidate = request.headers.get(GATEWAY_REQUEST_ID_HEADER),
): GatewayRequestContext {
  const budgetClass = boundedClass(request.headers.get(GATEWAY_BUDGET_CLASS_HEADER), ceiling);
  const totalBudgetMs = GATEWAY_BUDGETS_MS[budgetClass];
  return {
    requestId: safeRequestId(requestIdCandidate),
    budgetClass,
    totalBudgetMs,
    startedAtMs: now,
    deadlineAtMs: now + totalBudgetMs,
    signal: request.signal,
  };
}

export function remainingGatewayBudgetMs(context: GatewayRequestContext, now = Date.now()): number {
  return Math.max(0, Math.ceil(context.deadlineAtMs - now));
}

/** Headers safe to send to the authoritative gateway; no origin or credential. */
export function gatewayRequestHeaders(
  context: GatewayRequestContext,
  now = Date.now(),
  maximumMs = context.totalBudgetMs,
): Record<string, string> {
  const remainingMs = Math.min(remainingGatewayBudgetMs(context, now), Math.max(0, maximumMs));
  return {
    [GATEWAY_REQUEST_ID_HEADER]: context.requestId,
    [GATEWAY_BUDGET_CLASS_HEADER]: context.budgetClass,
    [GATEWAY_REMAINING_BUDGET_HEADER]: String(remainingMs),
  };
}

/** Headers returned on every branch, including configuration and transport faults. */
export function gatewayResponseHeaders(
  context: GatewayRequestContext,
  now = Date.now(),
): Record<string, string> {
  const elapsedMs = Math.max(0, now - context.startedAtMs);
  return {
    "Cache-Control": "no-store",
    [GATEWAY_REQUEST_ID_HEADER]: context.requestId,
    [GATEWAY_BUDGET_CLASS_HEADER]: context.budgetClass,
    [GATEWAY_BUDGET_MS_HEADER]: String(context.totalBudgetMs),
    "Server-Timing": `gateway;dur=${elapsedMs};desc="Next gateway proxy", `
      + `budget;desc="${context.budgetClass} ${context.totalBudgetMs}ms ceiling"`,
  };
}
