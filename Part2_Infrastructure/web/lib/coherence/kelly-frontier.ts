export interface KellyFrontierCandidate {
  probability: number;
  price: number;
  fullFraction: number;
}

export interface KellyFrontierPoint {
  scale: number;
  growth: number;
  floor: number;
  cash: number;
}

/** Replay the server's terminal-wealth and expected-log equations at one scale. */
export function replayKellyScale(
  candidates: readonly KellyFrontierCandidate[],
  scale: number,
): KellyFrontierPoint | null {
  const fractions = candidates.map((candidate) => candidate.fullFraction * scale);
  const cash = 1 - fractions.reduce((sum, fraction) => sum + fraction, 0);
  let growth = 0;
  let floor = Number.POSITIVE_INFINITY;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const wealth = cash + fractions[index] / candidate.price;
    if (!Number.isFinite(wealth) || wealth <= 0) return null;
    growth += candidate.probability * Math.log(wealth);
    floor = Math.min(floor, wealth);
  }

  return { scale, growth, floor, cash };
}
