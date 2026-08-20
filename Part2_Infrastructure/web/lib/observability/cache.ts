// --------------------------------------------------------------------------
// Cache accounting
// --------------------------------------------------------------------------

export interface CacheCounters {
  hits: number;
  misses: number;
  /** null until at least one lookup — 0% and "no data" are not the same. */
  hitRate: number | null;
}

/**
 * Hit and miss counts per capability.
 *
 * The bare `Map` this replaces was exported so that `capture.ts` could call
 * `.clear()` on it — the operator's "reset observation" action reaching into
 * another module's store with no method in between. It also handed every
 * importer the live counter rows, which is worse than it sounds for a *counter*:
 * the increment is read-modify-write, and a second writer that had a row
 * reference could push the recorded hit rate somewhere no lookup ever produced.
 *
 * Two counters and a reset is a small thing to own, and that is the point — the
 * owner costs eight lines and removes the ambient write.
 */
export class CacheLedger {
  private readonly byCapability = new Map<string, { hits: number; misses: number }>();

  record(capability: string, hit: boolean): void {
    const row = this.byCapability.get(capability) ?? { hits: 0, misses: 0 };
    if (hit) row.hits += 1;
    else row.misses += 1;
    this.byCapability.set(capability, row);
  }

  /** Copied rows: a reader holding a live one could increment the ledger. */
  entries(): Array<[string, { hits: number; misses: number }]> {
    return [...this.byCapability.entries()].map(([capability, row]) => [capability, { ...row }]);
  }

  clear(): void {
    this.byCapability.clear();
  }
}

export const cacheLedger = new CacheLedger();

export function recordCacheLookup(capability: string, hit: boolean): void {
  cacheLedger.record(capability, hit);
}

function rate(hits: number, misses: number): number | null {
  const total = hits + misses;
  return total ? hits / total : null;
}

export function cacheStats(): { total: CacheCounters; byCapability: Record<string, CacheCounters> } {
  let hits = 0;
  let misses = 0;
  const byCapability: Record<string, CacheCounters> = {};
  for (const [capability, row] of cacheLedger.entries()) {
    hits += row.hits;
    misses += row.misses;
    byCapability[capability] = { ...row, hitRate: rate(row.hits, row.misses) };
  }
  return { total: { hits, misses, hitRate: rate(hits, misses) }, byCapability };
}
