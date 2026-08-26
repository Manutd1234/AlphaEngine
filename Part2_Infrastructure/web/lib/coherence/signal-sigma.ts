/**
 * The sigma inside a refusal, read back out of the sentence that carries it.
 *
 * A run the noise floor refused arrives with `signal_reason` set to one
 * sentence — "the terminal move is 0.71 pre-event sigmas, below the floor of 2"
 * — and nothing numeric beside it. The sigma is the whole of what the floor
 * decided on, and on the live ledger 159 of 159 refusals carry it in exactly
 * this shape. Two figures read it: the Control view draws every refusal's
 * distance from the gate, and the Mechanism view names which stage of a
 * meeting fell short.
 *
 * NOT `?? 0`. A run with no sentence, or a sentence in another shape, returns
 * `null` and the caller draws a gap. A refusal the parser cannot read is not a
 * refusal at zero sigma; it is one the figure has no position for.
 *
 * The accepted runs carry no sentence at all (`signal_reason` is null for the
 * 89 that cleared), and `sigma_pre_per_bar` — which would place them on the
 * same axis — is in the run dataclass and not on the wire. That is the gap the
 * gateway change closes; until then this parser is the only source of a sigma
 * on this tab, and it covers the refused side only.
 */

const REFUSAL = /([0-9]+(?:\.[0-9]+)?)\s*pre-event sigmas?,?\s*below the floor of\s*([0-9]+(?:\.[0-9]+)?)/i;

export interface RefusalSigma {
  /** How many pre-event sigmas the terminal move represented. */
  readonly sigma: number;
  /** The floor it fell short of, as the sentence states it. */
  readonly floor: number;
}

/** The sigma and floor a refusal sentence names, or `null` when it names neither. */
export function refusalSigma(reason: string | null | undefined): RefusalSigma | null {
  if (!reason) return null;
  const match = REFUSAL.exec(reason);
  if (!match) return null;
  const sigma = Number(match[1]);
  const floor = Number(match[2]);
  if (!Number.isFinite(sigma) || !Number.isFinite(floor)) return null;
  return { sigma, floor };
}

/**
 * Fixed-width buckets over [0, floor), the last one closed at the floor, so a
 * sigma of exactly the floor — which would have cleared — cannot land inside.
 * Mirrors `PriceHistogram`'s idiom: fixed width, nothing dropped, an out-of-range
 * value clamped into the end bucket rather than off the figure.
 */
export function sigmaBuckets(sigmas: readonly number[], floor: number, width: number): number[] {
  const count = Math.max(1, Math.ceil(floor / width));
  const out = new Array<number>(count).fill(0);
  for (const sigma of sigmas) {
    const index = Math.min(count - 1, Math.max(0, Math.floor(sigma / width)));
    out[index] += 1;
  }
  return out;
}
