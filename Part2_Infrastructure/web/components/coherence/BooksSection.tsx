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
 * `ReliabilityConsole`'s header comment records. Two views, one seg — and
 * since 2026-08-25 the seg is `SectionFrame`'s rather than this file's.
 *
 * THE MARKET PICKER CAME UP HERE WITH THE FRAME, out of `BooksPane`, and the
 * move is what the frame is for. A picker is the SUBJECT every view of a
 * section is a question about, and this one was drawn inside the pane on a
 * `.coh-event__head` row of its own — so Books opened on a heading, then a
 * control, then a drawing, where Lattice and Stake opened on one row holding
 * both. Same two controls, three rows against two, and a reader moving down
 * the rail met the difference rather than the reason for it.
 *
 * The SELECTION comes with it, because a picker whose state lives in the pane
 * cannot be drawn by the section. `BooksPane` keeps the FALLBACK — the first
 * book when nothing is chosen, or when a repoll drops the chosen ticker — for
 * the reason `UniverseSection` keeps its own: the resolved subject has to
 * survive a read that no longer carries it, and only the pane knows what came
 * back.
 */

import { useState } from "react";

import type { CoherenceBooks } from "@/lib/coherence/types";
import { booksRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import BooksPane, { type BookDetailView } from "./BooksPane";
import LiveTape from "./LiveTape";
import { toUnit } from "./FrechetBand";
import { useLiveSeries } from "@/lib/coherence/use-live-series";
import MarketPicker from "./MarketPicker";
import PaneHead from "./PaneHead";
import SectionFrame from "./SectionFrame";

/** The two views, in the order they are pressed. */
const VIEWS: ReadonlyArray<[BookDetailView, string]> = [
  ["ladder", "Ladder"],
  ["identity", "Identity"],
];

export default function BooksSection({ active }: { active: boolean }) {
  const [view, setView] = useState<BookDetailView>("ladder");
  const [selected, setSelected] = useState<string | null>(null);
  // ONE read, gated on the section. The `!onChannel` half of this gate went
  // with the channel on 2026-08-25: while the RFQ panel was two of this
  // section's four views, a predicate here had to keep a signed 25-second
  // private-channel call from firing beside a public book read. `MakersSection`
  // owns that call now and the console gates it on its own section, so there is
  // no second read here to be exclusive with.
  const books = useCoherenceRead<CoherenceBooks>(booksRoute(), active);

  const books_ = books.data?.books ?? [];
  // The resolved subject, agreed with the pane rather than guessed at: the
  // picker has to show the ticker the drawing is actually of, and after a
  // repoll that dropped the chosen market they are not the same string.
  const current = books_.find((book) => book.ticker === selected)?.ticker ?? books_[0]?.ticker ?? "";
  const drawn = books_.find((book) => book.ticker === current) ?? null;

  /* The best YES bid over time, keyed by the MARKET. The bid and not the
     implied ask, because the bid is what the venue actually sends — the ask on
     every other figure here is read off the opposite ladder, and a tape of a
     derived number would put two inferences between the reader and the venue.
     No reference line: a price has no level it ought to be at, which is exactly
     what distinguishes this section from the baskets. */
  const bidTape = useLiveSeries(
    `books:${current}:bid`,
    books.updatedAt,
    drawn ? toUnit(drawn.best_yes_bid) : null,
  );

  return (
    <SectionFrame
      className="coh-books"
      aria-labelledby="markets-books-heading"
      head={
        /* Provenance rides in the head's note slot, because it is true of both
           book views and it is what the rest of the section rests on. */
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
      }
      views={VIEWS}
      view={view}
      onView={setView}
      viewsLabel="Books view"
      subject={books_.length > 1 ? (
        /* A filtered listbox and not a `.seg`: one button per market is around
           a hundred and ninety buttons on this watchlist, which filled the card
           before any book was drawn. `MarketPicker`'s header has the argument. */
        <MarketPicker
          options={books_.map((book) => ({ ticker: book.ticker, unquotedReason: book.unquoted_reason }))}
          selected={current}
          onSelect={setSelected}
          label="Choose a market"
        />
      ) : current ? (
        /* One book is no choice, so there is no control — but the ticker is not
           chrome, it is WHICH market the drawing below is of, and the picker was
           the only thing saying it. A watchlist that opens one market would
           otherwise draw an unattributed ladder. */
        <span className="coh-books__ticker">{current}</span>
      ) : null}
    >
      <BooksPane books={books.data} error={books.error} view={view} selected={selected} />

      {current ? (
        <LiveTape
          points={bidTape}
          caption={`What ${current} has been bid, poll by poll`}
          ariaLabel="The best YES bid over the polls seen since this tab opened"
          reading="The bid as the venue sends it; every offer on this section is read off the opposite ladder, so this is the one price here that is not an inference."
        />
      ) : null}
    </SectionFrame>
  );
}
