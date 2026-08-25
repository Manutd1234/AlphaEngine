"use client";

/**
 * What this event is quoted at: two ladders as sent, the identity they satisfy,
 * and what independent makers say when the book shows one opinion or none.
 *
 * The section used to stack four arguments down one column: the ladder, the
 * identity that follows from it, and then the RFQ panel's chips and its
 * twelve-column table. Lesson 0 — that `yes_ask + no_ask` is always
 * `1 + spread`, so the "buy both sides for under a dollar" branch is unreachable
 * rather than rare — arrived as a 96px strip underneath a 150px chart, which is
 * not where an argument that retires a published strategy belongs. Four views
 * give each of them the screen.
 *
 * MAKER DISPERSION HAS LEFT FOR THE THIRD AND LAST TIME, on 2026-08-25, and
 * the reason is worth stating because it was folded back here twice. The
 * argument for keeping it was that a book is one venue's most aggressive
 * resting order, the RFQ channel is several professionals pricing the same
 * event independently, and both answer "what is this quoted at". At that width
 * every section on this tab answers "what is this quoted at". A book is ONE
 * number the exchange publishes; a maker panel is N independent answers to a
 * question the exchange never asked — different objects, different failure
 * modes, and a four-state table exists over there precisely because the two get
 * confused. `MakersSection` owns it under the id it was published under.
 *
 * WHAT LEAVES WITH IT IS THE LAST OF THE PLUMBING. While Dispersion was a view
 * of Books the CONSOLE owned the book read and had to be told which view was
 * open — a `booksView` state up there and an `onViewChange` callback down
 * through here — purely so a signed 25-second private-channel call and a public
 * book read were never in flight together. That callback went when the reads
 * came here; the predicate that replaced it goes now, because there is no
 * second read in this file to be exclusive with. One section, one read, gated
 * on the section.
 *
 * The switcher is a `.seg` and never a nested `<WorkspaceSubtabs>`: a second
 * rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole`'s header comment records. Two views, one seg.
 */

import { useState } from "react";

import type { CoherenceBooks } from "@/lib/coherence/types";
import { booksRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import BooksPane, { type BookDetailView } from "./BooksPane";
import PaneHead from "./PaneHead";

export default function BooksSection({ active }: { active: boolean }) {
  const [view, setView] = useState<BookDetailView>("ladder");
  // ONE read, gated on the section. The `!onChannel` half of this gate went
  // with the channel on 2026-08-25: while the RFQ panel was two of this
  // section's four views, a predicate here had to keep a signed 25-second
  // private-channel call from firing beside a public book read. `MakersSection`
  // owns that call now and the console gates it on its own section, so there is
  // no second read here to be exclusive with.
  const books = useCoherenceRead<CoherenceBooks>(booksRoute(), active);

  return (
    <section className="card console-card coh-books" aria-labelledby="markets-books-heading">
      {/* Provenance rides in the head's note slot, because it is true of both
          book views and it is what the rest of the section rests on. */}
      <PaneHead
        kicker="Books"
        title="Two bid ladders & the offers they imply"
        id="markets-books-heading"
        note={books.data
          ? books.data.origin === "tape"
            ? "recorded tape, newest snapshot per market"
            : "read live from the exchange"
          : "reading the exchange"}
        lede="Kalshi sends YES bids and NO bids and no asks at all, so every offer on this section is read off the opposite ladder."
      />

      <div className="seg" role="group" aria-label="Books view">
        <button type="button" aria-pressed={view === "ladder"} onClick={() => setView("ladder")}>
          Ladder
        </button>
        <button type="button" aria-pressed={view === "identity"} onClick={() => setView("identity")}>
          Identity
        </button>
      </div>

      <BooksPane books={books.data} error={books.error} view={view} />
    </section>
  );
}
