import { isDataQualityView, type DataQualityViewWire } from "@/lib/data-quality-ledger";
import { cacheByCapability } from "./cache";
import { latencySamples, recordLatency } from "./latency";
import { pending, resetShared, shared } from "./ledger";
import { outages } from "./outages";
import { redact, redactUrl } from "./redaction";
import { EventOrigin, emit, events } from "./ring";

// --------------------------------------------------------------------------
// Payload capture
// --------------------------------------------------------------------------

export interface CapturedBody {
  /** Parsed JSON, size-bounded and redacted. `null` when nothing was retained. */
  value: unknown;
  /** Serialised size of the ORIGINAL body, before truncation. */
  bytes: number;
  truncated: boolean;
}

/**
 * A single upstream HTTP call, as the inspector shows it.
 *
 * `url` is post-redaction by construction — the raw string is never stored, so
 * there is no path by which a later change accidentally serialises it.
 */
export interface UpstreamCall {
  provider: string;
  method: string;
  url: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  body?: CapturedBody;
}

/** Bodies above this are truncated. Enough for a quote, short of a year of bars. */
export const MAX_BODY_CHARS = 24_000;

/**
 * Bounded, redacted snapshot of a JSON value.
 *
 * Arrays are the size risk here — a bars response is thousands of rows — so long
 * arrays keep a head sample and say how many elements were dropped, which is
 * what a developer inspecting a schema actually needs. Depth is bounded for the
 * same reason a JSON tree widget needs it: an unexpectedly recursive payload
 * should not be able to hang the page that is meant to be debugging it.
 */
export function captureBody(value: unknown, maxChars = MAX_BODY_CHARS): CapturedBody {
  let serialised: string;
  try {
    serialised = JSON.stringify(value) ?? "null";
  } catch {
    return { value: "«unserialisable body»", bytes: 0, truncated: true };
  }
  const bytes = serialised.length;
  if (bytes <= maxChars) {
    return { value: JSON.parse(redact(serialised)), bytes, truncated: false };
  }

  // Over budget: keep a structurally faithful *sample* rather than a cut string,
  // because the reason to open a raw payload is almost always to check a shape,
  // and a shape survives sampling while it does not survive truncation.
  const sampled = JSON.stringify(shrink(value, 0)) ?? "null";
  if (sampled.length > maxChars) {
    // Still over after sampling. Degrade to a plain string so the result is
    // always valid JSON — a half-closed object would break the tree viewer that
    // is supposed to be the debugging tool.
    return { value: `${redact(sampled.slice(0, maxChars))}…`, bytes, truncated: true };
  }
  return { value: JSON.parse(redact(sampled)), bytes, truncated: true };
}

const MAX_ARRAY_SAMPLE = 25;
const MAX_DEPTH = 8;

function shrink(value: unknown, depth: number): unknown {
  if (depth >= MAX_DEPTH) return "«depth limit»";
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY_SAMPLE).map((item) => shrink(item, depth + 1));
    return value.length > MAX_ARRAY_SAMPLE
      ? [...head, `«+${value.length - MAX_ARRAY_SAMPLE} more elements»`]
      : head;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = shrink(item, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

// --------------------------------------------------------------------------
// Capture scope
// --------------------------------------------------------------------------

/**
 * The buffer an in-flight inspection writes its upstream calls into.
 *
 * `dispatch` opens one of these only when a caller asked to inspect, so the
 * normal request path allocates nothing and retains no bodies. Which scope is
 * "current" is resolved by an injected function rather than a module variable:
 * on the server that resolver is backed by `AsyncLocalStorage`, so concurrent
 * requests cannot write into each other's buffer. In the browser there is no
 * such hazard and no resolver is installed.
 */
export interface CaptureScope {
  calls: UpstreamCall[];
  /** Capture response bodies, not just call metadata. */
  bodies: boolean;
}

type CaptureResolver = () => CaptureScope | null;

let resolveCapture: CaptureResolver = () => null;

export function setCaptureResolver(resolver: CaptureResolver): void {
  resolveCapture = resolver;
}

export function currentCapture(): CaptureScope | null {
  return resolveCapture();
}

export interface UpstreamRecord {
  provider: string;
  method?: string;
  url: string;
  status?: number | null;
  ms: number;
  ok: boolean;
  error?: string;
  /** Parsed response body. Retained only inside an active capture scope. */
  payload?: unknown;
  /**
   * Contribute a latency sample under this key.
   *
   * Set only by callers that have no dispatch layer above them — the direct
   * exchange clients in `venues.ts` and `marketdata.ts`, which `/api/depth` and
   * `/api/tca` reach without going through the registry at all. Registry traffic
   * is sampled once at the dispatch boundary instead, and the keys are kept
   * distinct (`venue:binance` vs `binance`) so the two measurements — one hop
   * versus a whole failover-eligible attempt — are never averaged together.
   */
  latencyKey?: string;
}

/**
 * The single funnel every outbound provider request reports through.
 *
 * Called from `httpJson` (all keyed adapters) and from the direct exchange
 * clients in `venues.ts` / `marketdata.ts` that Binance reaches without going
 * through it. Recording in one place is what makes the health matrix's latency
 * column mean the same thing for every row.
 */
export function recordUpstream(record: UpstreamRecord, origin: EventOrigin = "server"): void {
  const url = redactUrl(record.url);
  // No unconditional `recordLatency` here. Registry provider latency is measured
  // once, at the dispatch boundary, so the health matrix's p50 means "what the
  // registry paid for an answer" for every row — counting a retried request's
  // three hops as three samples would make the flakiest provider look like the
  // busiest one. Only callers with nothing above them opt in via `latencyKey`.
  if (record.latencyKey) recordLatency(record.latencyKey, record.ms, record.ok);

  const scope = currentCapture();
  if (scope) {
    const call: UpstreamCall = {
      provider: record.provider,
      method: record.method ?? "GET",
      url,
      status: record.status ?? null,
      ms: record.ms,
      ok: record.ok,
      error: record.error,
    };
    if (scope.bodies && record.payload !== undefined) call.body = captureBody(record.payload);
    scope.calls.push(call);
  }

  emit(
    {
      level: record.ok ? "debug" : "warn",
      source: "Upstream",
      message: record.ok
        ? `${record.provider} ${record.method ?? "GET"} ${record.ms}ms`
        : `${record.provider} ${record.method ?? "GET"} failed after ${record.ms}ms`,
      fields: {
        provider: record.provider,
        url,
        status: record.status ?? null,
        ms: record.ms,
        error: record.error,
      },
    },
    origin,
  );
}

// --------------------------------------------------------------------------
// Reset (operator action + test isolation)
// --------------------------------------------------------------------------

export function resetTelemetry(
  options: { events?: boolean; latency?: boolean; cache?: boolean; outages?: boolean; shared?: boolean } = {},
): void {
  if (options.events) events.clear();
  if (options.latency) {
    // Clearing observation clears what *this instance* can see — its buckets,
    // its unpushed queue, and its copy of the merged view. The gateway ledger
    // keeps other instances' history and the next sync re-reads it; erasing
    // the shared record from here would let one instance rewrite the fleet's.
    latencySamples.clear();
    pending.samples = [];
    shared?.latency.clear();
  }
  if (options.cache) cacheByCapability.clear();
  if (options.outages) outages.clear();
  // Test isolation: forget the overlay and every pending delta.
  if (options.shared) resetShared();
}
