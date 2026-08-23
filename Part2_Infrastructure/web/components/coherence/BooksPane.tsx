"use client";

/**
 * The book as Kalshi actually publishes it, and the identity that follows.
 *
 * A reader arriving from any other venue expects bids and asks. What they get
 * here is two bid ladders, and the ask they would trade against is a reading of
 * the opposite one. Showing that directly — the two ladders, the implied offers
 * as a ghost above them, and the identity drawn as two bars that land on the
 * same tick — is the difference between knowing the algebra and believing it.
 */

import { useState } from "react";

import type { CoherenceBooks, CoherenceBookView } from "@/lib/coherence/types";
import IdentityStrip from "./IdentityStrip";
import LadderChart from "./LadderChart";

function BookDetail({ book }: { book: CoherenceBookView }) {
  return (
    <div className="coh-book">
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

      <LadderChart
        caption="Both bid ladders, and the offers they imply"
        yesBids={book.yes_bids}
        noBids={book.no_bids}
        yesAsks={book.yes_asks}
        unquotedReason={book.unquoted_reason}
      />

      <IdentityStrip
        yesAsk={book.best_yes_ask}
        noAsk={book.best_no_ask}
        spread={book.spread}
        identitySum={book.identity_sum}
        identityOnePlusSpread={book.identity_one_plus_spread}
        unquotedReason={book.unquoted_reason}
      />

      {book.depth === "top_of_book" ? (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> This book came from the market object&rsquo;s top-of-book fields because the
          orderbook route refused an unauthenticated read. It carries one level a side and cannot answer a depth
          question.
        </p>
      ) : null}
    </div>
  );
}

export default function BooksPane({ books, error }: { books: CoherenceBooks | null; error: string | null }) {
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
    <div className="coh-books">
      <p className="coh-books__origin">
        {books.origin === "tape"
          ? "Read from the recorded tape, newest snapshot per market."
          : "Read live from the exchange."}
      </p>

      <div className="seg coh-books__picker" role="group" aria-label="Choose a market">
        {books.books.map((book) => (
          <button
            key={book.ticker}
            type="button"
            aria-pressed={book.ticker === current.ticker}
            onClick={() => setSelected(book.ticker)}
          >
            {book.ticker.split("-").slice(-1)[0]}
          </button>
        ))}
      </div>

      <h4 className="coh-books__ticker">{current.ticker}</h4>
      <BookDetail book={current} />
    </div>
  );
}
