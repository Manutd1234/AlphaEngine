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
import { useState } from "react";

import { combosRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { BandsView, caveatCount, GatewayNotes, NotesView } from "./CombosViews";
// The Parlays view left `CombosViews` when the 2026-08-26 redo would have put
// that file over the ceiling; it carries the card and the leg table with it.
import { ParlaysView } from "./ParlaysView";
// The Bounds view left `CombosViews` when that file crossed the ceiling: it
// draws the PORTFOLIO a bound is tested with, where the other two draw a
// parlay against its band.
import { BoundsView } from "./CombosBounds";
import ParlayReadCost from "./ParlayReadCost";
import { StateChip } from "./Figure";
import SectionVerdict from "./SectionVerdict";

const FORMULA = "max(0, Σpᵢ − (n−1))  ≤  P(all legs)  ≤  min pᵢ";

/** Which of the Dutch-book section's three parlay views this render draws. */
export type ComboView = "bands" | "parlays" | "bounds";

export default function CombosPane({ active, view }: { active: boolean; view: ComboView }) {
  /**
   * A named parlay, or the first few the exchange lists.
   *
   * The exchange lists about a thousand open parlays and this read takes six of
   * them, so a reader after a PARTICULAR one had no way to ask: it was in the
   * answer or it was not, and it usually was not — a different six came back on
   * every read. `asked` is what the reader typed; `ticker` is what has been
   * submitted, so the read does not refire on every keystroke.
   */
  const [asked, setAsked] = useState("");
  const [ticker, setTicker] = useState<string | null>(null);
  const { data, error, refresh } = useCoherenceRead<CoherenceCombos>(combosRoute(6, ticker), active);

  const search = (
    <form
      className="coh-combos__find"
      onSubmit={(event) => {
        event.preventDefault();
        setTicker(asked.trim() || null);
      }}
    >
      <label htmlFor="coh-parlay-ticker">Parlay</label>
      <input
        id="coh-parlay-ticker"
        type="search"
        value={asked}
        placeholder="a parlay ticker, or blank for the listed few"
        onChange={(event) => setAsked(event.target.value)}
      />
      <button type="submit">Read it</button>
      {ticker ? (
        <button type="button" onClick={() => { setAsked(""); setTicker(null); }}>
          Back to the listed few
        </button>
      ) : null}
    </form>
  );

  // No head on any of these branches: the section's head is `CertificatePane`'s
  // and is drawn above whatever this returns. A demoted pane that kept its own
  // would put two card titles in one card.
  if (error && !data) {
    // A FIGURE, NOT A SENTENCE, and this branch is the one that needed it most.
    // On a rate-limited or keyless deployment it IS the view, and one grey line
    // reads as a broken tab rather than as a venue that did not answer. The
    // read has a shape — one listing call, then one bulk book call across
    // shards — and drawing it tells "the venue is slow" from "the venue is
    // listing nothing" without opening a fold.
    return (
      <>
        {search}
        <SectionVerdict pending={<><span aria-hidden="true">✕</span> The parlays could not be read: {error}</>} />
        <ParlayReadCost data={null} error={error} ticker={ticker} />
        {/* THE ONE CONTROL A FAILED READ OWES A READER. The poll is twenty
            seconds and the failure often is not the venue's fault twice in a
            row, so waiting is the only thing this pane offered and it offered
            it silently. */}
        <div className="coh-combos__retry">
          <button type="button" onClick={refresh}>Read again</button>
        </div>
      </>
    );
  }
  if (!data) return <SectionVerdict pending="Reading the listed parlays…" />;
  if (data.state !== "available" || !data.combos.length) {
    // Three answers used to arrive here as one sentence with the gateway's own
    // reason thrown away; `notes` carries the venue's account of which.
    const notes = data.notes ?? [];
    return (
      <>
        {/* The search stays on this branch too. Asking for a ticker the
            exchange is not listing lands here, and without it a reader would
            have no way back to the listed few except reloading the tab. */}
        {search}
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
      {/* Two chips, not four: the count chips restated the section note, which
          already carries both figures. In the band since 2026-08-25, where the
          other five sections put their answer. */}
      <SectionVerdict>
        <StateChip mark={data.outside_band ? "▲" : "●"} word="Priced outside their band"
                   value={String(data.outside_band)} tone={data.outside_band ? "critical" : "good"} />
        <StateChip mark={data.violations ? "▲" : "●"} word="Bounds violated"
                   value={String(data.violations)} tone={data.violations ? "critical" : "good"} />
      </SectionVerdict>

      {/* The formula only. The sentence that used to sit above it — two
          probabilities do not determine the probability of both — went back to
          being the SECTION's lede on 2026-08-25, which is where it was
          published and where `CombosSection` now carries it. It lived here for
          one day because the fold into Dutch book left it with nowhere to be,
          and a claim made in two places is a claim a reader reads twice. */}
      <code className="coh-combo__formula">{FORMULA}</code>

      {search}

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
            <summary>{`What this read reports, and what it cannot, ${caveatCount(data.combos)} ${caveatCount(data.combos) === 1 ? "caveat" : "caveats"}`}</summary>
            <NotesView combos={data.combos} />
          </details>
          {/* A SIBLING, not a child. These two were nested — the gateway's
              notes lived inside `NotesView`, which this fold wraps — so
              reaching one list meant opening two disclosures. */}
          <GatewayNotes notes={data.notes} />
        </>
      )}
    </>
  );
}
