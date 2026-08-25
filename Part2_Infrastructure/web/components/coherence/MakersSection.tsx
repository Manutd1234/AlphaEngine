"use client";

/**
 * Makers — what several professionals say when the book shows one opinion,
 * or none.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `dispersion` was a rail section
 * during the promotion pass of 2026-08-24, was folded into Books as two of its
 * four views that evening, and returns on 2026-08-25 under the id it was
 * published under — so `#markets/dispersion` resolves natively again and its
 * stand-in entry in `RELOCATED_SECTIONS` is deleted rather than re-pointed.
 *
 * WHY IT IS NOT A VIEW OF BOOKS. The fold's argument was that a book is one
 * venue's most aggressive resting order and the RFQ channel is several
 * professionals pricing the same event independently, and that both answer
 * "what is this quoted at". True, and too coarse: at that width every section
 * on the tab answers "what is this quoted at". A book is ONE number the
 * exchange publishes; a maker panel is N independent answers to a question the
 * exchange never asked. Those are different objects with different failure
 * modes — a book can be thin, a panel can be unsigned — and the four-state
 * table this section carries exists precisely because they are confused.
 *
 * The seam is also the read, and it is the sharpest one on the tab. Books reads
 * the exchange's public book; this reads a SIGNED private-channel call on a
 * 25-second gateway budget. While the two were one section the gate was a
 * `CHANNEL_VIEWS.includes(view)` predicate whose whole job was to keep the
 * slowest call on the desk from firing for a reader who came to look at a
 * ladder. As two sections the console gates each on itself and the predicate
 * is gone.
 *
 * IT IS STILL NOT WARMED, and that is deliberate. `MarketsConsole`'s warm plan
 * spends a read when a reader looks like they are about to open a section —
 * and this is the one section on the tab where that trade is wrong, because the
 * read is signed, slow, and on the demo deployment answers "no view, unsigned"
 * every time. A reader who wants it presses it.
 *
 * LABELLED "Makers" AND NOT "Dispersion", which is house practice on this row
 * — `live` renders "Execution", `activity` renders "Blotter". The id is what
 * the hash, the sweep and the relocation table speak. "Dispersion" names the
 * measurement and is still the name of the view that draws it; the SECTION is
 * about who is doing the quoting, and a reader scanning a rail should not have
 * to know the statistic to find the people.
 *
 * This file owns the head and the switcher; `RfqPane` owns the read and the
 * figures and draws neither — the shape `BasketSection` uses over
 * `PortfolioPane`, and the reason `RfqPane` stays in `coherence-pane-head`'s
 * DEMOTED map. The switcher is a `.seg` and never a nested `<WorkspaceSubtabs>`.
 */

import { useState } from "react";

import RfqPane, { type RfqView } from "./RfqPane";
import PaneHead from "./PaneHead";
import SectionFrame from "./SectionFrame";

/** The panel itself, then the channel that did or did not carry it. */
const VIEWS: ReadonlyArray<[RfqView, string]> = [
  ["quotes", "Dispersion"],
  ["channel", "Channel"],
];

export default function MakersSection({ active }: { active: boolean }) {
  const [view, setView] = useState<RfqView>("quotes");

  return (
    <SectionFrame
      className="coh-makers"
      aria-labelledby="markets-dispersion-heading"
      head={
        <PaneHead
          kicker="Makers"
          title="What independent makers say about one event"
          id="markets-dispersion-heading"
          note="a signed channel, read only when this section is open"
          lede="A book publishes the most aggressive opinion on an event rather than the typical one, and this is the only place the venue exposes several professionals answering separately."
        />
      }
      views={VIEWS}
      view={view}
      onView={setView}
      viewsLabel="Makers view"
    >
      <RfqPane view={view} active={active} />
    </SectionFrame>
  );
}
