export const SPECTRUM_MODES = [
  { index: 0, subscript: "₁", spoken: "one" },
  { index: 1, subscript: "₂", spoken: "two" },
  { index: 2, subscript: "₃", spoken: "three" },
] as const;

export interface SpectrumYDomain {
  min: number;
  max: number;
}

const DOMAIN_PADDING = 0.08;
const FLAT_DOMAIN_HALF_SPAN = 1;

/**
 * A spectrum may cross zero. Including zero in the observed extent before
 * padding keeps the axis visible for positive-only and negative-only inputs,
 * while a symmetric fallback gives the all-zero state a finite scale.
 */
export function spectrumYDomain(values: readonly number[]): SpectrumYDomain {
  const finite = values.filter(Number.isFinite);
  const rawMin = Math.min(0, ...finite);
  const rawMax = Math.max(0, ...finite);
  const span = rawMax - rawMin;

  if (!Number.isFinite(span) || span <= Number.EPSILON) {
    return { min: -FLAT_DOMAIN_HALF_SPAN, max: FLAT_DOMAIN_HALF_SPAN };
  }

  const padding = span * DOMAIN_PADDING;
  return { min: rawMin - padding, max: rawMax + padding };
}

/** Map a density value into the plot's signed vertical extent. */
export function spectrumYPosition(
  value: number,
  domain: SpectrumYDomain,
  top: number,
  bottom: number,
): number {
  const span = domain.max - domain.min;
  if (!(span > 0) || !Number.isFinite(value)) return (top + bottom) / 2;
  const ratio = Math.min(1, Math.max(0, (domain.max - value) / span));
  return top + ratio * (bottom - top);
}

/** Keep an off-domain signed centroid on the nearest visible endpoint. */
export function spectrumXPosition(
  alpha: number,
  alphaLow: number,
  alphaHigh: number,
  left: number,
  right: number,
): number {
  if (!(alphaHigh > alphaLow) || !Number.isFinite(alpha)) return (left + right) / 2;
  const ratio = Math.min(1, Math.max(0, (alpha - alphaLow) / (alphaHigh - alphaLow)));
  return left + ratio * (right - left);
}
