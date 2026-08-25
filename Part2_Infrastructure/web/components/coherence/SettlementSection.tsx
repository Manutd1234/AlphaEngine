"use client";

/**
 * Settlement — what a contract actually resolves against, which is not the
 * price on screen.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `settlement` was a rail section
 * during the promotion pass of 2026-08-24, was folded into Universe as three of
 * its five views that evening, and returns on 2026-08-25 with the id it was
 * published under — so this RESTORES a `#markets/settlement` link rather than
 * costing one, and deletes the entry that stood in for it.
 *
 * WHY IT IS NOT A VIEW OF UNIVERSE. The fold was argued at the time — the
 * families are priced against an outcome, and the published variable that
 * outcome is read from is the next question the baskets raise — and the
 * argument is still true. What it got wrong is that "the next question" is a
 * DIFFERENT question, and a switcher holds views of one. Universe was asking
 * what a family costs and what it settles against on the same five-button row,
 * and the reader counted the buttons: "the universe section has too many
 * subtabs". Three of the five were this.
 *
 * The seam is also the read. Universe draws from `/universe`, which the console
 * holds and shares with the lattice and the stake; this section draws from
 * `/settlement`, which nothing else on the desk asks for. One section, one
 * read, which is the rule `stake` was promoted back for.
 *
 * THIS FILE OWNS THE HEAD AND THE SWITCHER; `SettlementPane` owns the reads and
 * the three figures and goes on drawing neither — the shape `BasketSection`
 * uses over `PortfolioPane`. One head per section is what
 * `coherence-pane-head.test.ts` holds, and the pane stays in its DEMOTED map
 * unchanged. The switcher is a `.seg` and never a nested `<WorkspaceSubtabs>`:
 * a second rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole` records.
 *
 * THE PANE'S LEAD SENTENCE MOVED UP HERE, which is the whole reason a wrapper
 * is worth having. `SettlementPane` opened with this claim because as three
 * views of Universe it had no head of its own to put it in; with a head above
 * it the claim was made twice in forty pixels, which is the reading the tab was
 * reported for. The pane keeps what the head cannot carry — the window length
 * and the city, which are this read's own answer and not prose.
 *
 * INDEX, NOT "READING". The pane's view id is `reading` and stays `reading` —
 * it is the view's name in code — but the word on the control is what the view
 * DRAWS, and what it draws is the published index against the window it settles
 * on. "Reading" beside "Formation" and "Pending" read as three nouns for one
 * thing.
 */

import { useState } from "react";

import SettlementPane, { type SettlementView } from "./SettlementPane";
import PaneHead from "./PaneHead";
import SectionFrame from "./SectionFrame";

/** The three views, in the order they are pressed. */
const VIEWS: ReadonlyArray<[SettlementView, string]> = [
  ["reading", "Index"],
  ["formation", "Formation"],
  ["pending", "Pending"],
];

export default function SettlementSection(
  { active, view, onView }: { active: boolean; view: SettlementView; onView: (next: SettlementView) => void },
) {

  return (
    <SectionFrame
      className="coh-settle-section"
      aria-labelledby="markets-settlement-heading"
      head={
        <PaneHead
          kicker="Settlement"
          title="What these contracts actually resolve against"
          id="markets-settlement-heading"
          note="one published index, read per minute"
          lede="A contract settles on the mean of a published index over a window, never on the price on screen, and the gap between the two is basis a position carries for free."
        />
      }
      views={VIEWS}
      view={view}
      onView={onView}
      viewsLabel="Settlement view"
    >
      <SettlementPane view={view} active={active} />
    </SectionFrame>
  );
}
