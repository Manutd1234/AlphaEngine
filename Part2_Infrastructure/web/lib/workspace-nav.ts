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
 * The current registry has eleven tabs and seventy rail sections; its three
 * quantitative destinations read Markets, Proofs and Diffusion and expose 68
 * engine views (26 / 29 / 16).
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
  // The quantitative engine reaches the reader as THREE tabs, in the order the
  // argument runs: what the exchange quotes, what this engine proves about it,
  // then how quickly new information is absorbed. Eleven destinations share
  // this row.
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
  // "MARKETS" SINCE 2026-08-25, AND THE WIDTH WAS MEASURED RATHER THAN
  // REASONED ABOUT. The label had been "Quotes" partly because six characters
  // beat seven on a row the header ladder is known to be tight on, and a
  // first pass at re-measuring reported the row already clipping at 46 of 93
  // widths, worst 62px over at 1660 — which would have made a wider label
  // reckless.
  //
  // That reading was an artefact of HOW it was taken. `header-ladder-measure.mjs`
  // injects the widest strings the header can ever carry AND sweeps by
  // resizing rather than navigating fresh at each width, which is the exact
  // measurement error this repository's own notes warn about. Re-measured with
  // fresh loads and the desk's real content, the row overflows at NO width
  // either side of the rename and never goes to two rows; the seventh
  // character costs 0px with real content and 7px against the injected worst
  // case, in a band (1600–2000) that is already over by ~60px before any of
  // this and has been since before the eleventh tab. That is a real limit of
  // the ladder and it is recorded in `14p`'s banner; it is not this label's
  // to carry.
  //
  // The ID stays `markets`, so every `#markets/<section>` link, the relocation
  // table and the desk sweep are untouched.
  { id: "markets", label: "Markets", role: "Quant", accessibleLabel: "Prediction market quotes" },
  { id: "coherence", label: "Proofs", role: "Quant", accessibleLabel: "Prediction market coherence" },
  // THE ELEVENTH, added 2026-08-25. Diffusion was a Proofs section and was
  // never the same question as the rail it sat on: everything else there argues
  // from one poll of the exchange — does this family admit a probability, what
  // does the failure hand back — while this argues from a recorded research
  // panel and answers how long absorption takes. Before extraction, four groups
  // over eleven views sat behind one button and had grown a third switcher
  // level. The current Diffusion tab has seven sections and sixteen addressable
  // views.
  //
  // "Diffusion" is nine characters. The old ten-tab comparison is historical;
  // the current header is the eleven-tab row and must be measured as such by
  // `scripts/header-ladder-measure.mjs`, with `14p` owning the rule.
  { id: "diffusion", label: "Diffusion", role: "Quant", accessibleLabel: "Information diffusion into prices" },
];

/**
 * The decision-loop neighbours, derived from the same order the header renders.
 *
 * The footer formerly copied eleven `nextId` edges while the phone navigator
 * froze a separate four-item prefix. Both became hidden migration work whenever
 * a tab moved or landed. Keeping the index private means callers can ask for a
 * neighbour without gaining a second mutable navigation registry.
 */
const NAV_INDEX_BY_ID = new Map<WorkspaceView, number>(
  NAV_ITEMS.map((item, index) => [item.id, index]),
);

export function nextWorkspaceView(view: WorkspaceView): WorkspaceView {
  const index = NAV_INDEX_BY_ID.get(view) ?? 0;
  return NAV_ITEMS[(index + 1) % NAV_ITEMS.length].id;
}

export function previousWorkspaceView(view: WorkspaceView): WorkspaceView {
  const index = NAV_INDEX_BY_ID.get(view) ?? 0;
  return NAV_ITEMS[(index - 1 + NAV_ITEMS.length) % NAV_ITEMS.length].id;
}
