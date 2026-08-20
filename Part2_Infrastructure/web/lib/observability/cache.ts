// --------------------------------------------------------------------------
// Cache accounting
// --------------------------------------------------------------------------

export interface CacheCounters {
  hits: number;
  misses: number;
  /** null until at least one lookup — 0% and "no data" are not the same. */
  hitRate: number | null;
}

export const cacheByCapability = new Map<string, { hits: number; misses: number }>();

export function recordCacheLookup(capability: string, hit: boolean): void {
  const row = cacheByCapability.get(capability) ?? { hits: 0, misses: 0 };
  if (hit) row.hits += 1;
  else row.misses += 1;
  cacheByCapability.set(capability, row);
}

function rate(hits: number, misses: number): number | null {
  const total = hits + misses;
  return total ? hits / total : null;
}

export function cacheStats(): { total: CacheCounters; byCapability: Record<string, CacheCounters> } {
  let hits = 0;
  let misses = 0;
  const byCapability: Record<string, CacheCounters> = {};
  for (const [capability, row] of cacheByCapability) {
    hits += row.hits;
    misses += row.misses;
    byCapability[capability] = { ...row, hitRate: rate(row.hits, row.misses) };
  }
  return { total: { hits, misses, hitRate: rate(hits, misses) }, byCapability };
}
