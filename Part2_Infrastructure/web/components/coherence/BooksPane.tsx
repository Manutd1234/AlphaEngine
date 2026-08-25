"use client";

/**
 * The book as Kalshi actually publishes it, and the identity that follows.
 *
 * A reader arriving from any other venue expects bids and asks. What they get
 * here is two bid ladders, and the ask they would trade against is a reading of
 * the opposite one. Showing that directly — the two ladders with the implied
 * offers as a ghost above them on Ladder, and the identity drawn as two bars
 * that land on the same tick on Identity — is the difference between knowing
 * the algebra and believing it.
 *
 * The two drawings are one view each rather than one column, because a 96px
 * identity strip read as a footnote to the chart above it. `BooksSection` owns
 * the switcher; this pane owns the market picker, which rides the ticker
 * heading so that only one `.seg` ever sits under the view rail.
 *
 * `BookDetailView` is two options and not three since 2026-08-24: maker
 * dispersion was never a view of a book — a book is one venue's most aggressive
 * resting order and the RFQ channel is several professionals answering
 * independently — and it is a VIEW of this section again, drawn by `RfqPane`.
 *
 * THE LADDER VIEW OPENS ON ITS DRAWING. Until the fourth pass of 2026-08-24 it
 * opened on a five-row definition list, three rows of which the chart's reading
 * prints underneath anyway. The list is folded now, with a summary that names
 * what is in it; the two facts the drawing cannot carry — the NO bid as the
 * venue sends it, and whether the read reached past the top of book — are the
 * reason it is folded rather than deleted.
 */

import { useState } from "react";

import type { CoherenceBooks, CoherenceBookView } from "@/lib/coherence/types";
import IdentityStrip from "./IdentityStrip";
import MarketPicker from "./MarketPicker";
import LadderChart from "./LadderChart";

/** The two views this pane draws. Dispersion is the RFQ half, not a book. */
export type BookDetailView = "ladder" | "identity";

function BookDetail({ book, view }: { book: CoherenceBookView; view: BookDetailView }) {
  if (view === "identity") {
    return (
      <div className="coh-book">
        <IdentityStrip
          yesAsk={book.best_yes_ask}
          noAsk={book.best_no_ask}
          spread={book.spread}
          identitySum={book.identity_sum}
          identityOnePlusSpread={book.identity_one_plus_spread}
          unquotedReason={book.unquoted_reason}
        />
      </div>
    );
  }

  return (
    <div className="coh-book">
      {/* THE DRAWING FIRST, and the five facts folded under it since the fourth
          pass of 2026-08-24. The chart's own reading prints the best YES bid,
          the implied offer and the spread between them — three of the five —
          so above the chart the list was the same numbers read twice, and a
          reader met a definition list before they met a book. What the fold
          keeps is the two the drawing genuinely cannot say: the best NO bid as
          the venue sends it, and how deep this read reached. */}
      <LadderChart
        caption="This market&rsquo;s two ladders"
        yesBids={book.yes_bids}
        noBids={book.no_bids}
        yesAsks={book.yes_asks}
        unquotedReason={book.unquoted_reason}
      />

      <details className="disclosure">
        <summary>The five figures this book was read from, and how deep the read went</summary>
        <dl className="coh-book__facts">
          <div>
            <dt>Best YES bid</dt>
            <dd>{book.best_yes_bid ?? "—"}</dd>
          </div>
          <div>
            <dt>Best NO bid</dt>
            <dd>{book.best_no_bid ?? "—"}</dd>
          </div>
          <div>
            <dt>Implied YES ask</dt>
            <dd>{book.best_yes_ask ?? "—"}</dd>
          </div>
          <div>
            <dt>Spread</dt>
            <dd>{book.spread ?? "—"}</dd>
          </div>
          <div>
            <dt>Depth read</dt>
            <dd>{book.depth === "full" ? "full ladder" : "top of book only"}</dd>
          </div>
        </dl>

        {book.depth === "top_of_book" ? (
          <p className="coh-event__note">
            <span aria-hidden="true">◌</span> One level a side, from the market object&rsquo;s top-of-book fields: the
            orderbook route refused an unauthenticated read, so depth cannot be answered.
          </p>
        ) : null}
      </details>
    </div>
  );
}

export default function BooksPane({
  books,
  error,
  view = "ladder",
}: {
  books: CoherenceBooks | null;
  error: string | null;
  /** Which drawing to give the screen to. Defaults so a direct render still works. */
  view?: BookDetailView;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  if (error && !books) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> Books could not be read: {error}
      </p>
    );
  }
  if (!books) {
    return <p className="console-empty muted">Reading the books…</p>;
  }
  if (!books.books.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> {books.notes[0] ?? "No book has been read yet."}
      </p>
    );
  }

  const current = books.books.find((book) => book.ticker === selected) ?? books.books[0];

  return (
    <>
      {/* The picker belongs to the heading, not to the view rail: two controls
          stacked one under the other read as one broken rail. It is a filtered
          listbox rather than a `.seg` since 2026-08-25 — one button per market
          is around a hundred and ninety buttons on this watchlist, which filled
          the card before any book was drawn. `MarketPicker`'s header has the
          argument. */}
      <div className="coh-event__head">
        <h4 className="coh-books__ticker">{current.ticker}</h4>
        <MarketPicker
          options={books.books.map((book) => ({
            ticker: book.ticker,
            unquotedReason: book.unquoted_reason,
          }))}
          selected={current.ticker}
          onSelect={setSelected}
          label="Choose a market"
        />
      </div>

      <BookDetail book={current} view={view} />
    </>
  );
}
