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
 * prints underneath anyway. It was folded then, and on 2026-08-25 the three
 * duplicates were dropped outright: a fold whose contents are already on screen
 * is a claim made twice with a click in between, not a claim made once. The two
 * the drawing genuinely cannot carry — the NO bid as the venue SENDS it, and
 * how deep this read reached — are a `KpiRow` now, which is the object every
 * other section on the tab answers its measurements in.
 */

import type { CoherenceBooks, CoherenceBookView } from "@/lib/coherence/types";
import IdentityStrip from "./IdentityStrip";
import KpiRow from "./KpiRow";
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

      {/* THE TWO FACTS THE DRAWING CANNOT SAY, as the tab's KPI row rather
          than as a five-row fold. The fold held five and the chart's own
          reading already prints three of them — the best YES bid, the implied
          offer and the spread between them — so opening it was reading the
          same numbers twice. What only the fold carried is the NO bid as the
          venue SENDS it (every offer on this section is read off that ladder,
          and the chart draws the offer rather than its source) and how deep
          this read reached. Those two are measurements, so they answer in the
          row every other section answers in, and the claim is made once. */}
      <KpiRow
        readings={[
          {
            label: "Best NO bid",
            value: book.best_no_bid,
            withheld: "nobody is bidding the NO side, so no YES offer is implied",
            note: "the ladder every offer here is read off",
          },
          {
            label: "Depth read",
            value: book.depth === "full" ? "full ladder" : "top of book only",
            note: book.depth === "full"
              ? undefined
              : "the orderbook route refused an unauthenticated read",
          },
        ]}
        source="this book"
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

  return <BookDetail book={current} view={view} />;
}
