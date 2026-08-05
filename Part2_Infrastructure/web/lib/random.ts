/**
 * Seeded PRNG shared by everything that must be reproducible.
 * ===========================================================
 *
 * Extracted from `syntheticBars` so the Monte Carlo resampler and the synthetic
 * data generator draw from the same, pinned Mulberry32 stream. The sequence for
 * a given seed is part of the app's reproducibility contract — a run's seed in
 * the capsule is only meaningful if the generator never changes.
 */

/** Mulberry32 — small, fast, deterministic. Seed 0 is remapped to 1 so an
 *  all-zero hash cannot produce the degenerate all-zeros stream. */
export function mulberry32(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The 31-multiplier string hash `syntheticBars` has always used, exported so
 *  the response can cite the seed a synthetic dataset was built from. */
export function seedFromString(s: string): number {
  let seed = 0;
  for (let i = 0; i < s.length; i++) seed = (seed * 31 + s.charCodeAt(i)) >>> 0;
  return seed;
}
