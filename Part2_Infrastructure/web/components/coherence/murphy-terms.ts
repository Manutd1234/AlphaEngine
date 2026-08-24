/**
 * The four terms of Murphy's decomposition, as data — what each one IS, said
 * once, beside the sign it enters with.
 *
 * Split out of `MurphyBars.tsx` on 2026-08-24, and for the file-length reason
 * rather than a design one: that component sat at 395 against the 400-line
 * one-way ratchet in `file-size.test.ts`, the tightest file on the tab, so any
 * future fix to the drawing had five lines to happen in. The seam is the one
 * that was already in the file — everything below is a statement about the
 * DECOMPOSITION, and everything left behind is a statement about the DRAWING
 * (heights, floors, insets, the waterfall's running sum). A change to what
 * Reliability means lands here; a change to how a two-pixel bar is floored
 * lands there.
 *
 * The prose in `meaning` is on-screen copy, rendered in the glossary `<dl>` at
 * the foot of the figure — the one place these definitions appear, after the
 * 2026-08-24 condensation removed their restatements from the waterfall's
 * reading and the inset's footnote. Edit them as copy, not as comments.
 */

export interface Term {
  key: string;
  name: string;
  sign: 1 | -1;
  raw: string | null;
  direction: string;
  meaning: string;
}

const MIN_PLACES = 8;
const MAX_PLACES = 14;
const EXTRA_PLACES = 2;

/**
 * A cut deep enough that every term still shows significant digits.
 *
 * Read off the wire strings rather than assumed: find the deepest first
 * significant digit among the terms, keep two places past it, and stay between
 * eight and fourteen so the labels remain a number rather than a wall. Eight
 * places suits a Brier of 1e-4 and does not suit a residue an order or two
 * below it, and the depth is not knowable before the numbers arrive.
 */
export function placesFor(raws: (string | null)[]): number {
  let deepest = MIN_PLACES;
  for (const raw of raws) {
    const fraction = /^-?\d*\.(\d*)$/.exec(raw?.trim() ?? "")?.[1] ?? "";
    const first = fraction.search(/[1-9]/);
    if (first >= 0) deepest = Math.max(deepest, first + 1 + EXTRA_PLACES);
  }
  return Math.min(deepest, MAX_PLACES);
}

/** How many times the second magnitude goes into the first, as a grouped integer. */
export function ratioOf(large: number, small: number): string {
  return Math.round(large / small).toLocaleString("en-GB");
}

/** The decomposition in rail order: the order the waterfall draws and the glossary lists. */
export function murphyTerms(
  reliability: string | null,
  resolution: string | null,
  uncertainty: string | null,
  binning: string | null,
  bandCount: number,
): Term[] {
  return [
    {
      key: "reliability",
      name: "Reliability",
      sign: 1,
      raw: reliability,
      direction: "lower is better; zero is perfect",
      meaning:
        "The mean squared gap between what a band was priced at and how often it happened — the only term a recalibration can repair, being the only property of the prices.",
    },
    {
      key: "resolution",
      name: "Resolution",
      sign: -1,
      raw: resolution,
      direction: "higher is better; it enters with a minus sign",
      meaning:
        "How far the bands' outcome rates spread from the base rate — how much the prices discriminated. Quote the base rate everywhere and this is zero: perfectly reliable, worth nothing, and only this term notices.",
    },
    {
      key: "uncertainty",
      name: "Uncertainty",
      sign: 1,
      raw: uncertainty,
      direction: "not a score, it belongs to the questions",
      meaning:
        "base × (1 − base). Nothing the exchange does changes it — why a raw Brier cannot be carried between corpora: easier questions produce a smaller number for free.",
    },
    {
      key: "binning",
      name: "Binning",
      sign: 1,
      raw: binning,
      direction: "smaller with finer bands",
      meaning:
        `The residue of grouping a continuum of prices into ${bandCount} bands, returned as whatever the other three leave over — read its size, not the fact that it fits.`,
    },
  ];
}
