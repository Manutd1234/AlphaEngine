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
 * the switcher AND, since 2026-08-25, the market picker: a picker names the
 * SUBJECT every view is a question about, and drawn down here it sat on a row
 * of its own under the switcher, so Books opened on three rows of chrome where
 * every other section on the tab opens on one.
 *
 * WHAT STAYED HERE IS THE FALLBACK, and the split is the point. The section
 * holds which ticker was CHOSEN; this pane resolves which book is DRAWN,
 * because only the read knows what came back. A repoll that drops the chosen
 * market must fall to the first book rather than to a blank card, and a
 * section that resolved it from up there would be resolving against a payload
 * it does not hold.
 *
 * `BookDetailView` is two options and not three since 2026-08-24: maker
 * dispersion was never a view of a book — a book is one venue's most aggressive
 * resting order and the RFQ channel is several professionals answering
 * independently — and it is a VIEW of this section again, drawn by `RfqPane`.
 *
 * THE LADDER VIEW OPENS ON ITS DRAWING. Until the fourth pass of 2026-08-24 it
 * opened on a five-row definition list, three rows of which the chart's reading
 * prints underneath anyway. The replacement makes every native level operable,
 * keeps the exact ledger collapsed, and carries the read scope in its own head.
 * That is one bounded instrument rather than a chart, a long table, and a
 * detached one-tile depth row all describing the same ladder.
 */

import type { CoherenceBooks, CoherenceBookView } from "@/lib/coherence/types";
import IdentityStrip from "./IdentityStrip";
import LadderChart from "./LadderChart";

/**
 * The section's three views. This pane draws two of them.
 *
 * `history` is the recorded tape and `BookHistory` draws it — a different READ
 * (the deployment's own DuckDB rather than the venue) answering a different
 * question (what this market has been quoted at, not what it is). The id lives
 * in this union because the section's switcher is typed on it and one union is
 * what stops the two files disagreeing about which views exist.
 */
export type BookDetailView = "ladder" | "identity" | "history";

function BookDetail({ book, view }: { book: CoherenceBookView; view: BookDetailView }) {
  if (view === "identity") {
    return (
      <div className="coh-book">
        <IdentityStrip
          key={book.ticker}
          yesAsk={book.best_yes_ask}
          noAsk={book.best_no_ask}
          bestYesBid={book.best_yes_bid}
          bestNoBid={book.best_no_bid}
          spread={book.spread}
          identitySum={book.identity_sum}
          identityOnePlusSpread={book.identity_one_plus_spread}
          yesBids={book.yes_bids}
          noBids={book.no_bids}
          unquotedReason={book.unquoted_reason}
        />
      </div>
    );
  }

  return (
    <div className="coh-book">
      {/* One instrument owns the native rails, mirrored price, read scope,
          sweep simulation and collapsed exact ledger. No summary tile follows
          the ledger, so changing depth never changes the page's alignment. */}
      <LadderChart
        key={book.ticker}
        caption="This market&rsquo;s two ladders"
        yesBids={book.yes_bids}
        noBids={book.no_bids}
        yesAsks={book.yes_asks}
        depth={book.depth}
        unquotedReason={book.unquoted_reason}
      />
    </div>
  );
}

export default function BooksPane({
  books,
  error,
  view = "ladder",
  selected = null,
}: {
  books: CoherenceBooks | null;
  error: string | null;
  /** Which drawing to give the screen to. Defaults so a direct render still works. */
  view?: BookDetailView;
  /** The ticker the section's picker chose, or null for "whichever came first". */
  selected?: string | null;
}) {
  if (error && !books) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> Books could not be read: {error}
      </p>
    );
  }
  if (!books) {
    return <p className="console-empty muted" role="status" aria-busy="true">Reading the books…</p>;
  }
  if (!books.books.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> {books.notes[0] ?? "No book has been read yet."}
      </p>
    );
  }

  const current = books.books.find((book) => book.ticker === selected) ?? books.books[0];

  return <BookDetail book={current} view={view} />;
}
