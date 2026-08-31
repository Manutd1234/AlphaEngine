/** Structured transport evidence shared by the Proofs read hook and UI. */

export const COHERENCE_REQUEST_ID_HEADER = "X-AlphaEngine-Request-Id";
export const COHERENCE_BUDGET_CLASS_HEADER = "X-AlphaEngine-Budget-Class";
export const COHERENCE_BUDGET_MS_HEADER = "X-AlphaEngine-Budget-Ms";

export interface CoherenceTransportMeta {
  requestId: string;
  endpointClass: string | null;
  status: number | null;
  code: string | null;
  hint: string | null;
  deadlineMs: number;
}

interface GatewayFailurePayload {
  code?: unknown;
  requestId?: unknown;
  endpointClass?: unknown;
  hint?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveMilliseconds(value: string | null): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A browser-owned id means even a connection failure has a correlation key. */
export function coherenceRequestId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `proof-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function coherenceTransportMeta(
  response: Response,
  payload: GatewayFailurePayload | null,
  requestedId: string,
  deadlineMs: number,
): CoherenceTransportMeta {
  const serverBudgetMs = positiveMilliseconds(response.headers.get(COHERENCE_BUDGET_MS_HEADER));
  return {
    requestId: text(response.headers.get(COHERENCE_REQUEST_ID_HEADER))
      ?? text(payload?.requestId)
      ?? requestedId,
    endpointClass: text(response.headers.get(COHERENCE_BUDGET_CLASS_HEADER))
      ?? text(payload?.endpointClass),
    status: response.status,
    code: text(payload?.code),
    hint: text(payload?.hint),
    // The browser owns a slightly wider guard so it can receive the route's
    // typed timeout response. What the operator needs to see is the first
    // deadline that can actually end the read, never the wider of the two.
    deadlineMs: serverBudgetMs == null ? deadlineMs : Math.min(deadlineMs, serverBudgetMs),
  };
}

export function localTransportMeta(
  requestId: string,
  deadlineMs: number,
  code: string,
  hint: string,
): CoherenceTransportMeta {
  return {
    requestId,
    endpointClass: null,
    status: null,
    code,
    hint,
    deadlineMs,
  };
}

/** Copy for a scheduled retry; the loop itself remains the timing authority. */
export function nextRetryReading(
  retryAt: Date | null,
  consecutiveFailures: number,
  now = new Date(),
): string | null {
  if (!retryAt || consecutiveFailures < 1) return null;
  const seconds = Math.max(1, Math.min(30, Math.ceil((retryAt.getTime() - now.getTime()) / 1000)));
  return consecutiveFailures >= 3
    ? `Circuit probe in at most ${seconds}s`
    : `Retry in about ${seconds}s`;
}
