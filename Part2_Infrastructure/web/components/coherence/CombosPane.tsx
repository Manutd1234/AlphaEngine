"use client";

/**
 * Kalshi's parlays, against the bands their own legs impose.
 *
 * This is the one relation on the exchange that is stated rather than inferred:
 * a combo ticker carries its legs, so the conjunction is not a guess. It is
 * also the relation that pins down the least. The legs give a band and never a
 * price, and the three views are built around that gap rather than around a
 * verdict.
 *
 * IT WAS THE `combos` RAIL SECTION UNTIL THE CONSOLIDATION OF 2026-08-24, and
 * it is three views of `certificate` — "Dutch book" — now. The fold is the
 * argument's own seam rather than a tidy-up: the Fréchet bounds test IS a
 * coherence test, run on parlays instead of on a family's strikes. Same
 * failure, same verdict vocabulary; the only difference is that here the leg
 * structure is quoted by the venue and there it is inferred from the strikes.
 *
 * WHAT THE FOLD COST, because `combos` was PUBLISHED and the six ids demoted
 * earlier that day were not. `#coherence/combos` is a link someone may hold
 * from `origin/main`; `RELOCATED_SECTIONS` lands it on Dutch book rather than on
 * the rail default, but it lands on the SECTION — which of the six views opens
 * is component state the hash cannot name, so a reader arriving on that link
 * meets Verdict and presses Parlays. `lib/sections.ts` records the trade.
 *
 * So this file draws no head, owns no switcher and returns no `<section>`.
 * `CertificatePane` owns all three and passes `view` down. What stayed here is
 * the read, the formula, the two chips and the three drawings.
 *
 * The failure mode these views avoid is a reader taking "inside the band" for
 * "fairly priced". They are not the same claim and the second is not available:
 * every price between the two bounds is consistent with some dependence between
 * the legs, and nothing on this exchange quotes dependence. So the band width
 * leads, the position inside the band is called a position, and "mispriced"
 * appears only where a price is outside its band and a portfolio proves it.
 *
 * The second failure mode is the ask. Parlays are quoted one-sided almost
 * without exception — nobody bids for a parlay — so `price_basis` is "ask" and
 * the bounds are built from leg MIDS. A parlay priced above Πpᵢ is therefore
 * the expected reading even under independence, and calling that "positive
 * dependence" would be reading the maker's margin as information about the
 * world. `basisCaveat` says so ONCE per basis, in the Notes disclosure and as
 * the band figure's `missing` line. It used to print again forty pixels above
 * that figure, on all six cards.
 *
 * NOTES BECAME A DISCLOSURE RATHER THAN A FOURTH VIEW, and that is the
 * consolidation's one copy decision here. A six-button seg is already the
 * widest control on the desk; a seventh for a page of caveats would have made
 * the switcher the loudest thing in the card. So the caveats ride under Bounds
 * — the view whose verdict they qualify — behind a `<details>` that names what
 * is inside it. "summarise the content more, use dropdowns, hide, summarise,
 * remove but keep the details": nothing was removed.
 *
 * REFUSED: folding `basisCaveat` into the section's lede to say it once for the
 * whole section. It is not one caveat — it is three, one per `price_basis`, and
 * which one applies is a property of the parlay in front of the reader rather
 * than of the section. Said in the lede it would be right for the common case
 * and wrong for the rare quoted-both-sides one, which is the case a reader most
 * needs told apart.
 *
 * The three views, and every table under them, are `CombosViews.tsx`: the
 * density pass put this file over the 400-line ceiling and the switcher is the
 * seam the component already had.
 */

import type { CoherenceComboRow, CoherenceCombos } from "@/lib/coherence/types-lab";
import { toCenticents } from "@/lib/coherence/fixed-point";
import { combosRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { BandsView, NotesView, ParlaysView } from "./CombosViews";
// The Bounds view left `CombosViews` when that file crossed the ceiling: it
// draws the PORTFOLIO a bound is tested with, where the other two draw a
// parlay against its band.
import { BoundsView } from "./CombosBounds";
import { StateChip } from "./Figure";

const FORMULA = "max(0, Σpᵢ − (n−1))  ≤  P(all legs)  ≤  min pᵢ";

/** Which of the Dutch-book section's three parlay views this render draws. */
export type ComboView = "bands" | "parlays" | "bounds";

export default function CombosPane({ active, view }: { active: boolean; view: ComboView }) {
  const { data, error } = useCoherenceRead<CoherenceCombos>(combosRoute(), active);

  // No head on any of these branches: the section's head is `CertificatePane`'s
  // and is drawn above whatever this returns. A demoted pane that kept its own
  // would put two card titles in one card.
  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The parlays could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the listed parlays…</p>;
  if (data.state !== "available" || !data.combos.length) {
    // Three answers used to arrive here as one sentence with the gateway's own
    // reason thrown away; `notes` carries the venue's account of which.
    const notes = data.notes ?? [];
    return (
      <>
        <p className="console-empty">
          <span aria-hidden="true">◌</span>{" "}
          {data.state !== "available"
            ? "The parlays could not be read on this poll, so nothing here describes the exchange's listings."
            : "No open parlay's book was reachable: each needs a book call per leg, so a read that finds none returns nothing rather than a band from part of one."}
        </p>
        {notes.length ? (
          <ul className="coh-notes">
            {notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        ) : null}
      </>
    );
  }

  const violated = data.rows.filter((row) => row.violated);
  const satisfied = data.rows.filter((row) => !row.violated);
  const tightest = satisfied.reduce<CoherenceComboRow | null>((best, row) => {
    const slack = toCenticents(row.slack);
    if (slack == null) return best;
    const bestSlack = best == null ? null : toCenticents(best.slack);
    return bestSlack == null || slack < bestSlack ? row : best;
  }, null);

  return (
    <>
      {/* The formula only. The sentence that used to sit above it — two
          probabilities do not determine the probability of both — went back to
          being the SECTION's lede on 2026-08-25, which is where it was
          published and where `CombosSection` now carries it. It lived here for
          one day because the fold into Dutch book left it with nowhere to be,
          and a claim made in two places is a claim a reader reads twice. */}
      <code className="coh-combo__formula">{FORMULA}</code>

      {/* Two chips, not four: the count chips restated the section note, which
          already carries both figures. */}
      <div className="coh-status__chips">
        <StateChip mark={data.outside_band ? "▲" : "●"} word="Priced outside their band"
                   value={String(data.outside_band)} tone={data.outside_band ? "critical" : "good"} />
        <StateChip mark={data.violations ? "▲" : "●"} word="Bounds violated"
                   value={String(data.violations)} tone={data.violations ? "critical" : "good"} />
      </div>

      {view === "bands" ? (
        <BandsView combos={data.combos} />
      ) : view === "parlays" ? (
        <ParlaysView combos={data.combos} />
      ) : (
        <>
          <BoundsView rows={data.rows} violated={violated} tightest={tightest} />
          {/* Kept, not removed: the caveats say which claims this read is NOT
              making, and a reader who reaches a bounds verdict is the one who
              needs them. The summary names what is inside, so nobody has to
              open it to find out whether it is worth opening. */}
          <details className="disclosure">
            <summary>What this read reports, and what it cannot</summary>
            <NotesView combos={data.combos} notes={data.notes} />
          </details>
        </>
      )}
    </>
  );
}
