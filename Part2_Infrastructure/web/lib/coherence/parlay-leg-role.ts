/** Explain one required leg's exact contribution to a Fréchet band. */
export function parlayLegBandRole(probability: number | null, quotedMinimum: number | null): string {
  if (probability === null) return "Unquoted; range unavailable";
  if (probability === quotedMinimum) return "Sets maximum; also affects minimum";
  return "Affects minimum";
}
