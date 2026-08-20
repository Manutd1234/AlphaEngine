import { opsLedger } from "./ops-ledger";

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

/**
 * The operator-set blocks this instance knows about.
 *
 * The bare `Map` this replaces was exported, and two other modules used the
 * export: `capture.ts` called `.clear()` on it to service the operator's reset,
 * and `ledger.ts` imported it and then never read it — a dangling value import
 * that closed an import cycle for no reason at all. Both are the same defect: a
 * store with no owner is a store anyone may reach into, and nothing records
 * who did.
 *
 * The class deliberately owns ONLY this instance's map. The gateway-merged
 * overlay is the ledger's, and the free functions below are what reconcile the
 * two — an outage has to be written to both and read from either, and putting
 * that policy inside the container would give the container an opinion about a
 * structure it does not own.
 */
export class OutageRegistry {
  private readonly byProvider = new Map<string, SimulatedOutage>();

  set(record: SimulatedOutage): void {
    this.byProvider.set(record.provider, record);
  }

  get(provider: string): SimulatedOutage | undefined {
    return this.byProvider.get(provider);
  }

  /** True when a record was actually removed. */
  delete(provider: string): boolean {
    return this.byProvider.delete(provider);
  }

  providers(): string[] {
    return [...this.byProvider.keys()];
  }

  clear(): void {
    this.byProvider.clear();
  }
}

export const outageRegistry = new OutageRegistry();

export function simulateOutage(provider: string, ttlMs = OUTAGE_MAX_MS, note = "operator-simulated outage"): SimulatedOutage {
  const bounded = Math.min(OUTAGE_MAX_MS, Math.max(10_000, ttlMs));
  const record: SimulatedOutage = { provider, expiresAt: Date.now() + bounded, note };
  outageRegistry.set(record);
  // Mirrored into the shared overlay and queued as a command, so every other
  // instance honours the outage after its next sync. Both halves are the
  // ledger's own structures, so the ledger does them.
  opsLedger.queueOutage(record);
  return record;
}

export function clearOutage(provider: string): boolean {
  const known = outageRegistry.delete(provider);
  const knownShared = opsLedger.queueOutageCleared(provider);
  return known || knownShared;
}

export function clearAllOutages(): number {
  const n = activeOutages().length;
  outageRegistry.clear();
  opsLedger.queueAllOutagesCleared();
  return n;
}

export function outageFor(provider: string, now = Date.now()): SimulatedOutage | null {
  const record = outageRegistry.get(provider);
  if (record) {
    if (record.expiresAt > now) return record;
    outageRegistry.delete(provider);
  }
  return opsLedger.sharedOutage(provider, now);
}

export function activeOutages(now = Date.now()): SimulatedOutage[] {
  const providers = new Set<string>(outageRegistry.providers());
  for (const provider of opsLedger.sharedOutageProviders(now)) providers.add(provider);
  return [...providers]
    .map((provider) => outageFor(provider, now))
    .filter((o): o is SimulatedOutage => o !== null);
}
