/**
 * Learned licence state — a capability-scoped breaker for a settled refusal.
 *
 * Distinct from `breaker.ts` because the blast radius is different: a 403 on
 * Tiingo's news endpoint says nothing about Tiingo's quotes, and folding it
 * into the provider-scoped breaker took three news requests to knock the
 * vendor out for everything. Keyed on (provider, capability) and remembered
 * for a day, so the dispatch loop can skip without a call and say why.
 */

import { emit } from "../observability";
import { store, type Store } from "./store";
import type { Capability } from "./types";

/**
 * A capability-scoped breaker for a refusal that will not change.
 *
 * Tiingo declares `news` and answers 403 on the free plan; before this, every
 * uncached news dispatch paid a Tiingo round trip to read the same refusal,
 * booked it as a failure, and three of them could open Tiingo's circuit for
 * quotes and bars as well. A 401/402/403 on a declared capability is now
 * remembered per (provider, capability) for a day; while the record lives the
 * dispatch loop skips that provider for that capability without a call and
 * says why. Per instance, like the breaker — the ops-sync body is pinned to
 * the gateway contract, and a licence is not worth a wire change.
 *
 * "Close circuit" from the operator console forgets these too, so the next
 * request re-probes: that is the retry affordance.
 */
export const LICENCE_TTL_MS = 24 * 60 * 60_000;

export interface LicenceBlock {
  status: number | null;
  learnedAt: number;
  detail: string;
}

function licenceKey(id: string, capability: Capability): string {
  return `licence:${id}:${capability}`;
}

export function markUnlicensed(
  id: string,
  capability: Capability,
  status: number | null,
  detail: string,
  s: Store = store,
): void {
  const already = s.get<LicenceBlock>(licenceKey(id, capability));
  s.set<LicenceBlock>(licenceKey(id, capability), { status, learnedAt: Date.now(), detail }, LICENCE_TTL_MS);
  if (already) return;
  emit({
    level: "warn",
    source: "Licence",
    message: `${id} ${capability}: HTTP ${status ?? "?"} — not licensed on this key; skipping for ${LICENCE_TTL_MS / 3_600_000}h on this instance`,
    fields: { provider: id, capability, status },
  });
}

export function licenceBlock(
  id: string,
  capability: Capability,
  s: Store = store,
): (LicenceBlock & { expiresInMs: number }) | null {
  const block = s.get<LicenceBlock>(licenceKey(id, capability));
  if (!block) return null;
  return { ...block, expiresInMs: s.ttl(licenceKey(id, capability)) ?? 0 };
}

/** Every capability this provider has been recorded as unlicensed for. */
export function licenceBlocks(id: string, s: Store = store): Array<LicenceBlock & { capability: Capability; expiresInMs: number }> {
  return s.keys(`licence:${id}:`).flatMap((key) => {
    const block = s.get<LicenceBlock>(key);
    if (!block) return [];
    return [{ ...block, capability: key.slice(`licence:${id}:`.length) as Capability, expiresInMs: s.ttl(key) ?? 0 }];
  });
}

/** Operator forget. Returns how many blocks were holding this provider out. */
export function clearLicence(id: string, s: Store = store): number {
  const keys = s.keys(`licence:${id}:`);
  for (const key of keys) s.del(key);
  return keys.length;
}

export function describeLicenceSkip(block: LicenceBlock & { expiresInMs: number }, now = Date.now()): string {
  const agoMin = Math.max(0, Math.round((now - block.learnedAt) / 60_000));
  const ago = agoMin < 60 ? `${agoMin} min ago` : `${Math.round(agoMin / 60)} h ago`;
  const left = Math.max(1, Math.round(block.expiresInMs / 3_600_000));
  return `HTTP ${block.status ?? "?"} learned ${ago}; re-probes in ${left} h (this instance)`;
}
