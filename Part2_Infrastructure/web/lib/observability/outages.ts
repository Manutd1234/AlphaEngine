import { pending, shared, sharedFresh } from "./ledger";

// --------------------------------------------------------------------------
// Simulated outages
// --------------------------------------------------------------------------

export interface SimulatedOutage {
  provider: string;
  expiresAt: number;
  note: string;
}

/**
 * Self-expiring on purpose.
 *
 * A permanent operator-set block is a foot-gun: someone verifies failover on a
 * Friday, walks away, and the deployment serves degraded data until a human
 * notices. An expiry means the worst case is a bounded window, and the remaining
 * time is shown in the UI so nobody is surprised by the restore either.
 */
export const OUTAGE_MAX_MS = 15 * 60_000;

export const outages = new Map<string, SimulatedOutage>();

export function simulateOutage(provider: string, ttlMs = OUTAGE_MAX_MS, note = "operator-simulated outage"): SimulatedOutage {
  const bounded = Math.min(OUTAGE_MAX_MS, Math.max(10_000, ttlMs));
  const record: SimulatedOutage = { provider, expiresAt: Date.now() + bounded, note };
  outages.set(provider, record);
  // Mirror into the shared overlay and queue the command, so every other
  // instance honours the outage after its next sync — and so a clear queued
  // earlier in this same batch cannot cancel a newer set.
  shared?.outages.set(provider, record);
  pending.outageCleared = pending.outageCleared.filter((p) => p !== provider);
  pending.outageSet = pending.outageSet.filter((o) => o.provider !== provider);
  pending.outageSet.push(record);
  return record;
}

export function clearOutage(provider: string): boolean {
  const known = outages.delete(provider);
  const knownShared = shared?.outages.delete(provider) ?? false;
  pending.outageSet = pending.outageSet.filter((o) => o.provider !== provider);
  if (!pending.outageCleared.includes(provider)) pending.outageCleared.push(provider);
  return known || knownShared;
}

export function clearAllOutages(): number {
  const n = activeOutages().length;
  outages.clear();
  shared?.outages.clear();
  pending.outageSet = [];
  pending.outageCleared = ["*"];
  return n;
}

export function outageFor(provider: string, now = Date.now()): SimulatedOutage | null {
  const record = outages.get(provider);
  if (record) {
    if (record.expiresAt > now) return record;
    outages.delete(provider);
  }
  if (sharedFresh(now)) {
    const remote = shared!.outages.get(provider);
    if (remote) {
      if (remote.expiresAt > now) return remote;
      shared!.outages.delete(provider);
    }
  }
  return null;
}

export function activeOutages(now = Date.now()): SimulatedOutage[] {
  const providers = new Set<string>(outages.keys());
  if (sharedFresh(now)) for (const provider of shared!.outages.keys()) providers.add(provider);
  return [...providers]
    .map((provider) => outageFor(provider, now))
    .filter((o): o is SimulatedOutage => o !== null);
}
