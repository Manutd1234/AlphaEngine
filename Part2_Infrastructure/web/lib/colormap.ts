/**
 * Perceptual diverging colormap for the parameter surface.
 * ========================================================
 *
 * The heatmap encodes a signed quantity (Sharpe) around a meaningful zero, so
 * the scale is diverging — two hues with a neutral midpoint — never a
 * sequential ramp like Viridis, which would paint "no edge" as a saturated
 * colour. Interpolating in OKLab instead of sRGB keeps midtones from going
 * muddy and makes lightness change monotonically along each arm, so "more
 * colour" reliably reads as "more Sharpe".
 *
 * Anchor colours deliberately duplicate the `--diverging-*` tokens in
 * `app/globals.css` (CSS variables are unreachable from lib code). Keeping
 * both midpoints on the theme's neutral surface makes zero read as no edge,
 * never as a faint positive or negative signal.
 */

export type RGB = [number, number, number];

export interface DivergingRamp {
  neg: RGB;
  mid: RGB;
  pos: RGB;
}

/** Mirrors --diverging-neg/mid/pos in the light theme (globals.css). */
export const SHARPE_RAMP_LIGHT: DivergingRamp = {
  neg: [148, 47, 62], // #942f3e
  mid: [228, 214, 202], // #e4d6ca
  pos: [111, 56, 32], // #6f3820
};

/** Mirrors the red ↔ graphite ↔ blue dark-theme ramp. */
export const SHARPE_RAMP_DARK: DivergingRamp = {
  neg: [255, 127, 134], // #ff7f86
  mid: [32, 40, 50], // #202832
  pos: [109, 178, 255], // #6db2ff
};

const RAMP_INK = {
  dark: [0, 0, 0] as RGB, // --heatmap-ink-dark
  light: [255, 255, 255] as RGB, // --heatmap-ink-light
} as const;

const srgbToLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (v: number) => {
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(255, Math.max(0, c * 255)));
};

function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Choose the theme ink with the stronger contrast against a generated ramp
 * colour. Heatmap cells span both light and dark fills, so inherited table ink
 * cannot remain readable at both poles.
 */
export function readableRampInk(background: string): string {
  const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(background);
  if (!match) return "var(--heatmap-ink-dark)";
  const fill: RGB = [Number(match[1]), Number(match[2]), Number(match[3])];
  return contrastRatio(RAMP_INK.dark, fill) >= contrastRatio(RAMP_INK.light, fill)
    ? "var(--heatmap-ink-dark)"
    : "var(--heatmap-ink-light)";
}

/** Björn Ottosson's OKLab, the standard constants. */
export function srgbToOklab([r, g, b]: RGB): [number, number, number] {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToSrgb([L, a, b]: [number, number, number]): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Blend two sRGB colours through OKLab. t = 0 → a, t = 1 → b. */
export function mixOklab(a: RGB, b: RGB, t: number): RGB {
  const la = srgbToOklab(a);
  const lb = srgbToOklab(b);
  return oklabToSrgb([
    la[0] + (lb[0] - la[0]) * t,
    la[1] + (lb[1] - la[1]) * t,
    la[2] + (lb[2] - la[2]) * t,
  ]);
}

/** Mild ease that spends more colour resolution near zero, where the
 *  interesting distinction (edge vs no edge) lives. */
const EASE_EXP = 0.85;

/**
 * Map a value in [-absMax, absMax] onto the ramp. Values beyond the range
 * clamp to the poles; absMax ≤ 0 degenerates to the midpoint.
 */
export function divergingScale(
  absMax: number,
  ramp: DivergingRamp,
): (v: number) => string {
  return (v: number) => {
    const t = absMax > 0 ? Math.max(-1, Math.min(1, v / absMax)) : 0;
    const end = t >= 0 ? ramp.pos : ramp.neg;
    const [r, g, b] = mixOklab(ramp.mid, end, Math.abs(t) ** EASE_EXP);
    return `rgb(${r},${g},${b})`;
  };
}

/** Evenly spaced CSS stops from −1 to +1 for a legend gradient. */
export function rampStops(ramp: DivergingRamp, n = 9): string[] {
  const scale = divergingScale(1, ramp);
  return Array.from({ length: n }, (_, i) => scale(-1 + (2 * i) / (n - 1)));
}
