/**
 * The tab rail, as DATA — the ids, the labels and the order a reader meets them.
 *
 * Split out of `WorkspaceHeader.tsx` on 2026-08-25, when the eleventh tab would
 * have pushed that file past the four-hundred-line ceiling. The seam is a real
 * one rather than a convenience: thirty-two files import `WorkspaceView` or
 * `NAV_ITEMS`, and almost none of them render a header — the routing hooks, the
 * hash whitelist, the command palette, the tour, the bottom nav and the sweep
 * all want the LIST, not the component. `WorkspaceHeader` re-exports both so
 * none of those thirty-two had to change.
 *
 * THE IDS DISAGREE WITH THE LABELS ON PURPOSE, and that is house practice on
 * this row rather than a mistake to tidy: `live` renders "Execution", `codex`
 * renders "Strategies", `activity` renders "Blotter". An id is a public deep
 * link and never changes; a label is what a reader reads. So `coherence` — the
 * only Kalshi tab id `origin/main` ever published — keeps every
 * `#coherence/<section>` link in the world resolving natively while reading
 * "Proofs", and `markets` is reused rather than re-invented because the tests,
 * the relocation table and the desk sweep already speak it.
 */

export type WorkspaceView =
  | "overview"
  | "research"
  | "live"
  | "portfolio"
  | "risk"
  | "data"
  | "reliability"
  | "developer"
  | "markets"
  | "coherence"
  | "diffusion";

export const NAV_ITEMS: { id: WorkspaceView; label: string; role: string; accessibleLabel?: string }[] = [
  { id: "overview", label: "Overview", role: "All Roles" },
  { id: "research", label: "Research", role: "Quant" },
  { id: "live", label: "Execution", role: "Trader", accessibleLabel: "Execution" },
  { id: "portfolio", label: "Portfolio", role: "PM" },
  { id: "risk", label: "Risk", role: "Risk" },
  { id: "data", label: "Data", role: "Data", accessibleLabel: "Data operations" },
  { id: "reliability", label: "Reliability", role: "SRE" },
  { id: "developer", label: "Developer", role: "Dev" },
  // The Kalshi engine reaches the reader as TWO tabs, in the order the argument
  // runs: what the exchange quotes, then what this engine proves about it. Ten
  // destinations, which is the count the priority ladder below is measured
  // against.
  //
  // THE IDS DISAGREE WITH THE LABELS ON PURPOSE, and that is house practice on
  // this row rather than a mistake to tidy: `live` renders "Execution",
  // `codex` renders "Strategies", `activity` renders "Blotter". An id is a
  // public deep link and never changes; a label is what a reader reads. So
  // `coherence` — the only Kalshi tab id `origin/main` ever published — keeps
  // every `#coherence/<section>` link in the world resolving natively while
  // reading "Proofs", and `markets` is reused rather than re-invented because
  // the tests, the relocation table and the desk sweep already speak it.
  //
  // "Quotes" and "Proofs" are six characters each, against "Markets" (7) and
  // "Coherence" (9): this ten-tab row is NARROWER than the ten-tab row the
  // header ladder was last measured against.
  { id: "markets", label: "Quotes", role: "Quant", accessibleLabel: "Prediction market quotes" },
  { id: "coherence", label: "Proofs", role: "Quant", accessibleLabel: "Prediction market coherence" },
  // THE ELEVENTH, added 2026-08-25. Diffusion was a Proofs section and was
  // never the same question as the rail it sat on: everything else there argues
  // from one poll of the exchange — does this family admit a probability, what
  // does the failure hand back — while this argues from a recorded research
  // panel and answers how long absorption takes. Four groups over eleven views
  // is a rail's worth of subject behind one button, and it had already grown a
  // third switcher level to hold it.
  //
  // "Diffusion" is nine characters, so this row is wider than the ten-tab row
  // the ladder was last measured against and the measurement has to be re-run:
  // `scripts/header-ladder-measure.mjs`, and `14p` owns the rule.
  { id: "diffusion", label: "Diffusion", role: "Quant", accessibleLabel: "Information diffusion into prices" },
];
