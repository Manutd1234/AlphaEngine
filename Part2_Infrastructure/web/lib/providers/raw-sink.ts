/**
 * Carries the raw vendor body from `httpJson` out to the dispatch site.
 *
 * The raw body exists in exactly one place — inside `httpJson`, between
 * `res.json()` and the adapter normalising it — and it is gone by the time
 * `dispatch` has a `ContractResult` to attach violations to. That gap is why
 * the boundary notice's claim that raw payloads reach the quarantine sample was
 * false: `quarantinePayload` was handed `data`, the normalised object.
 *
 * `AsyncLocalStorage` rather than a module-level variable, for the reason
 * `trace.ts` already gives: a route handler serves concurrent requests and a
 * bare global would hand one dispatch another's body. That is not a
 * theoretical race — it would attribute one provider's malformed payload to a
 * different provider's quarantine sample.
 *
 * Distinct from `trace.ts`'s capture scope on purpose. That one is opt-in and
 * only records bodies when the inspector asks with `raw=1`; this must run on
 * every dispatch, because a contract check nobody switched on is not a check.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { Violation } from "@/lib/providers/contracts";
import { checkRawBody } from "@/lib/providers/raw-contract-check";

interface RawSink {
  capability: string;
  violations: Violation[];
  /** The last raw body seen in this dispatch, for the quarantine sample. */
  body: unknown;
  seen: boolean;
}

const storage = new AsyncLocalStorage<RawSink>();

/** Run one dispatch with a sink open, and report what the raw checks found. */
export async function withRawChecks<T>(
  capability: string,
  fn: () => Promise<T>,
): Promise<{ result: T; violations: Violation[]; body: unknown; seen: boolean }> {
  const sink: RawSink = { capability, violations: [], body: undefined, seen: false };
  const result = await storage.run(sink, fn);
  return { result, violations: sink.violations, body: sink.body, seen: sink.seen };
}

/**
 * Check one raw body against its provider's predicate, inside `httpJson`.
 *
 * Never throws. A contract check must not be the reason a request dies — the
 * same rule `dispatch` already applies to the normalised contract, and for the
 * same reason: the check is evidence, not a gate on the fetch itself.
 */
export function recordRawBody(provider: string, body: unknown): void {
  const sink = storage.getStore();
  if (!sink) return;
  sink.body = body;
  try {
    const outcome = checkRawBody(provider, sink.capability, body);
    if (!outcome) return;
    sink.seen = true;
    sink.violations.push(...outcome.violations);
  } catch {
    // A predicate that throws is a bug in the predicate, not a bad payload.
    // Swallowed here so it cannot take a working fetch down with it.
  }
}
