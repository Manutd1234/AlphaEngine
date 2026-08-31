"use client";

/**
 * What this market has been quoted at from the deployment's recorded tape.
 *
 * The wrapper owns the four refusal states so an outage, an unconfigured
 * recorder, an unwatched market and a one-reading tape remain full Figure
 * frames. Only a readable two-or-more-point history reaches the interactive
 * flipbook; an unavailable read is never flattened into an unframed sentence.
 */

import type { CoherenceBookHistory } from "@/lib/coherence/types-history";

import { BookHistoryFlipbook } from "./BooksInstruments";
import Figure, { FigureEmpty } from "./Figure";

const CAPTION = "What this market has been quoted at, off the recorded tape";
const ARIA = "Best YES bid and implied ask over the recorded tape";

function refusal(history: CoherenceBookHistory): string {
  if (history.state === "unavailable") {
    return `The tape could not be opened: ${history.notes[0] ?? "no reason given"}. `
      + "That is this deployment's own store failing, not an answer about the market.";
  }
  if (history.state === "unconfigured") {
    return "This deployment has never recorded a book. The recorder is off — COHERENCE_POLL_S "
      + "is unset — so there is no history to read rather than a history that is empty.";
  }
  const held = history.recorded.length;
  return `The tape holds no book for this market. It carries ${held} `
    + `${held === 1 ? "ticker" : "tickers"}, so the recorder has run; this market is not among them.`;
}

export default function BookHistory({ history, error }: {
  history: CoherenceBookHistory | null;
  error: string | null;
}) {
  if (error && !history) {
    return (
      <Figure caption={CAPTION} ariaLabel={ARIA}>
        <FigureEmpty reason={`The recorded tape could not be read: ${error}. That is a gateway failure, not an answer about the market.`} />
      </Figure>
    );
  }

  if (!history) {
    return (
      <Figure caption={CAPTION} ariaLabel={ARIA}>
        <FigureEmpty reason="Reading the recorded tape…" busy />
      </Figure>
    );
  }

  if (history.state !== "ok" || history.points.length < 2) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel={ARIA}
        missing={
          history.state === "ok"
            ? "One reading is a dot, and a dot on a time axis reads as a flat line — the tape needs a second poll."
            : null
        }
      >
        <FigureEmpty reason={history.state === "ok" ? "Only one book has been recorded for this market." : refusal(history)} />
      </Figure>
    );
  }

  return <BookHistoryFlipbook history={history} />;
}
