"use client";

/**
 * The book half and the dispersion half of section `books`, on one switcher.
 *
 * The section used to stack four arguments down a single column: the ladder,
 * the identity that follows from it, and then the RFQ panel's chips and its
 * twelve-column table. Lesson 0 — that `yes_ask + no_ask` is always
 * `1 + spread`, so the "buy both sides for under a dollar" branch is
 * unreachable rather than rare — arrived as a 96px strip underneath a 150px
 * chart, which is not where an argument that retires a published strategy
 * belongs. Three views give each of them the screen.
 *
 * The switcher is a `.seg` and never a nested `<WorkspaceSubtabs>`: a second
 * rail instance fights the first over the `--rail-h` publisher, as
 * `CoherenceConsole`'s header comment records.
 *
 * The switcher is also what stops a read. The RFQ route is a signed
 * private-channel call on a 25s budget, and it is now asked for only while
 * Dispersion is on screen; the books read is asked for only while it is not.
 * The section polls one route at a time instead of two.
 */

import { useState } from "react";

import type { CoherenceBooks } from "@/lib/coherence/types";
import BooksPane from "./BooksPane";
import RfqPane from "./RfqPane";

export type BooksView = "ladder" | "identity" | "dispersion";

export interface BooksSectionProps {
  books: CoherenceBooks | null;
  error: string | null;
  /** False while another tab or another section is in front. Polls gate on it. */
  active: boolean;
  /**
   * Announces which view is open. The books read lives in `CoherenceConsole`,
   * which cannot see this state otherwise and needs it to stop polling the
   * exchange while Dispersion is the view on screen.
   */
  onViewChange?: (view: BooksView) => void;
}

export default function BooksSection({ books, error, active, onViewChange }: BooksSectionProps) {
  const [view, setView] = useState<BooksView>("ladder");
  const open = (next: BooksView) => {
    setView(next);
    onViewChange?.(next);
  };

  return (
    <div className="coh-books">
      {/* Provenance first, above the switcher, because it is true of every view
          and it is what the rest of the section rests on. */}
      {books ? (
        <p className="coh-books__origin">
          {books.origin === "tape"
            ? "Books read from the recorded tape, newest snapshot per market."
            : "Books read live from the exchange."}
        </p>
      ) : null}

      <div className="seg" role="group" aria-label="Books view">
        <button type="button" aria-pressed={view === "ladder"} onClick={() => open("ladder")}>
          Ladder
        </button>
        <button type="button" aria-pressed={view === "identity"} onClick={() => open("identity")}>
          Identity
        </button>
        <button type="button" aria-pressed={view === "dispersion"} onClick={() => open("dispersion")}>
          Dispersion
        </button>
      </div>

      {view === "dispersion" ? (
        /* Maker dispersion sits in this section for the reason the channel
           exists: a book shows the most aggressive opinion on one market, and
           for a combo it shows nothing at all. */
        <RfqPane active={active && view === "dispersion"} />
      ) : (
        <BooksPane books={books} error={error} view={view} />
      )}
    </div>
  );
}
