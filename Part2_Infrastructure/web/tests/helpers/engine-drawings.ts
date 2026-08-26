/**
 * What counts as a drawing on the two engine tabs, as data rather than as code.
 *
 * SPLIT OUT OF `engine-opens-on-a-drawing.test.ts` on 2026-08-26, when that file
 * crossed the 400 line ceiling. The seam is the one it already had: this list is
 * a REGISTER — every name on it is a component asserted elsewhere in that suite
 * to open on a drawing itself — and the file it left is the walk that uses it.
 *
 * Splitting a list out of the suite that reads it is the move the ceiling asks
 * for and the one to be careful with: a register nobody reads is a register that
 * drifts. `engine-opens-on-a-drawing` is the only importer, and its LOCAL table
 * re-verifies every name here that is not a primitive, which is what stops this
 * becoming a way to exempt a view without writing down that you did.
 */

/**
 * The components that ARE a drawing when a view opens with one.
 *
 * `Figure`, `Plot` and a bare `<svg>` are the primitives. The rest are this
 * engine's own figures — each renders a `<Figure>` as its own first element,
 * which is why naming them here is not a loophole: it is one indirection, and
 * the suite below asserts that each of them still opens on a drawing too.
 */
export const DRAWINGS = [
  "Figure", "Plot", "svg",
  "MarginAxis", "ValueStrip", "PayoffByState", "ComboBandStrips", "FrechetBand",
  "SlackStrip", "CalibrationGauge", "CalibrationTrend", "IndexPane",
  "ReliabilityDiagram", "MurphyBars", "LessonFigure", "DollarBar",
  // The six added on 2026-08-25, one per Proofs section, and the chain two of
  // them are drawn with. Each is verified to open on a drawing ITSELF by the
  // LOCAL table at the foot of this file, which is what stops this list being
  // a way to exempt a view without writing down that you did.
  "CheckLadder", "StateCoverage", "ParlayLegs", "HorizonAxis",
  "MeasurabilityStrip", "GroupPins", "FormationDiagram",
  // The one figure on the tab whose name says nothing about being one; it is
  // local to `IndexPane` and there is no second `Chart` under `coherence/`.
  "Chart",
  // Diffusion's. Wired in 2026-08-25 with the branch mode below, so these are
  // reached rather than merely declared. `SurvivalChart` and `MeetingsEmpty`
  // are local to `KalshiArm` and `MeetingTable`; both open on a `<Figure>`.
  "ClockAgreement", "EpisodeWatch", "MeetingTable", "SurvivalChart", "MeetingsEmpty",
  "MeetingCalendar",
  // The mechanism's windows with the ledger's meetings on them, 2026-08-26.
  // Replaced a constant-only timeline; opens on a `<Figure>` itself.
  "StageWindows",
  // The Control view's two figures, 2026-08-26: every refusal's distance
  // below the noise floor, and the ranked percentiles as a dot strip. Both
  // open on a `<Figure>` themselves; replaced two HTML-era bar charts.
  "FloorDistance", "ControlRank",
  // Findings, 2026-08-26: the evidence field (t across, shuffled p up, area
  // from n) replaced a one-axis dot plot, and the evidence matrix replaced a
  // `ValueStrip` of `n` that carried three distinct values over fourteen bars.
  // Both open on a `<Figure>` themselves.
  "EffectField", "EvidenceMatrix",
  // Findings / Instrument, 2026-08-25. It replaced a `ValueStrip` that drew
  // two rows of "not measured" on the live read — an empty frame that also
  // duplicated the last two rows of the table beneath it.
  "InstrumentFit",
  // Coherence test / Proof, 2026-08-26. It replaced a `ValueStrip` of the
  // certificate's own two row counts — 189 against 0, the second floored to a
  // 1px hairline and excluded from that strip's floor note — with the room
  // every inequality has left, sorted. Verified to open on a drawing itself by
  // the LOCAL table at the foot of this file.
  "ConstraintLadder",
  // Basket, 2026-08-26. It replaced `MarginAxis` on the no-legs branch — the
  // ordinary answer, where a linear axis puts an optimum of -0.000000, a
  // threshold of 0.0001 and zero on the same pixel and the figure is one
  // horizontal rule. Four magnitudes on a decade scale instead. `MarginAxis`
  // keeps the Coherence test's verdict view, where the question is a yes/no.
  "ShortfallScale",
  // Coherence index / By family, 2026-08-26. The strip it sits above rows on
  // the SERIES, of which the watchlist has two; the families are the events,
  // twenty-six of them, and those are what this draws.
  "FamilyRidge",
];

