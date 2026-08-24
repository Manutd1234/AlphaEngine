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
 * MAKER DISPERSION LEFT AND CAME BACK on 2026-08-24, both within the day. It was
 * promoted to a rail section because a view is not addressable by URL, and it
 * returns because this is where the subject reads: a book is one venue's most
 * aggressive resting order, the RFQ channel is several professionals pricing
 * the same event independently, and both answer "what is this quoted at". That
 * question is the whole of the Quotes tab, which is the rail this section is on
 * after the last of that day's four restructures — the tenth tab went away with
 * the merge and came back with the split, and the answer did not change either
 * time.
 *
 * WHAT DOES NOT COME BACK IS THE PLUMBING, and it is worth saying why the shape
 * is different this time. While Dispersion was a view of Books the CONSOLE
 * owned the exchange's book read and had to be told which view was open — a
 * `booksView` state up there and an `onViewChange` callback down through here —
 * purely so a signed 25-second private-channel call and a public book read were
 * never in flight together. Both reads live in this file now, each gated on the
 * views that draw it, so the predicate is beside the thing it predicates and no
 * callback climbs back up. The console gates the section; this gates the view.
 *
 * The switcher is a `.seg` and never a nested `<WorkspaceSubtabs>`: a second
 * rail instance fights the first over the `--rail-h` publisher, as
 * `ReliabilityConsole`'s header comment records. Four views, one seg.
 */

import { useState } from "react";

import type { CoherenceBooks } from "@/lib/coherence/types";
import { booksRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import BooksPane, { type BookDetailView } from "./BooksPane";
import PaneHead from "./PaneHead";
import RfqPane, { type RfqView } from "./RfqPane";

/** The book's own two views, then the channel's two. */
type BooksView = BookDetailView | RfqView;

/** Which of the four are the RFQ channel's, so one predicate gates its call. */
const CHANNEL_VIEWS: ReadonlyArray<BooksView> = ["quotes", "channel"];

export default function BooksSection({ active }: { active: boolean }) {
  const [view, setView] = useState<BooksView>("ladder");
  // Two reads, two gates, and they are mutually exclusive by construction: the
  // exchange's public book for the two ladder views, the signed RFQ channel for
  // the two channel views. Never both, which is the property the console used
  // to hold with a callback.
  const onChannel = CHANNEL_VIEWS.includes(view);
  const books = useCoherenceRead<CoherenceBooks>(booksRoute(), active && !onChannel);

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
        <button type="button" aria-pressed={view === "quotes"} onClick={() => setView("quotes")}>
          Dispersion
        </button>
        <button type="button" aria-pressed={view === "channel"} onClick={() => setView("channel")}>
          Channel
        </button>
      </div>

      {onChannel ? (
        <RfqPane view={view as RfqView} active={active && onChannel} />
      ) : (
        <BooksPane books={books.data} error={books.error} view={view as BookDetailView} />
      )}
    </section>
  );
}
