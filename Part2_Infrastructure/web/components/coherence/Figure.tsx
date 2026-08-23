"use client";

/**
 * The frame every diagram on this tab is drawn in.
 *
 * The tab makes one argument in several shapes — a basket against a dollar, two
 * ladders facing each other, an identity that always balances — and the reader
 * has to be able to move between them without relearning the furniture. So
 * every figure gets the same parts in the same order: a caption above that says
 * what is being shown, the drawing, and a footnote below that says what the
 * drawing cannot say.
 *
 * The footnote is not decoration. Every diagram here can be missing a leg, a
 * side or a whole book, and a chart that quietly omits what it could not
 * measure reads as a complete picture of a smaller world. `missing` renders in
 * the same place, in the same voice, every time.
 *
 * Nothing here carries meaning in colour alone: each state also has a
 * typographic mark and a word, which is what `forced-colors.test.ts` and the
 * house rule require and what makes the figures legible in Windows High
 * Contrast and to a reader who cannot separate red from green.
 */

import { type ReactNode } from "react";

export interface FigureProps {
  /** What this figure shows, as a sentence fragment. Always present. */
  caption: string;
  /** The reading a viewer should take away, when there is one. */
  reading?: string | null;
  /** What the drawing could not include, and why. Rendered when present. */
  missing?: string | null;
  /** Screen-reader description of the drawing itself. */
  ariaLabel: string;
  children: ReactNode;
}

export default function Figure({ caption, reading, missing, ariaLabel, children }: FigureProps) {
  return (
    <figure className="coh-figure">
      <figcaption className="coh-figure__caption">{caption}</figcaption>
      <div className="coh-figure__plot" role="img" aria-label={ariaLabel}>
        {children}
      </div>
      {reading ? <p className="coh-figure__reading">{reading}</p> : null}
      {missing ? (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span> {missing}
        </p>
      ) : null}
    </figure>
  );
}

/**
 * The empty state a figure renders instead of an axis with nothing on it.
 *
 * A blank plot area and a plot area with nothing in it look identical, and one
 * of them means the feed is down. This says which.
 */
export function FigureEmpty({ reason }: { reason: string }) {
  return (
    <p className="coh-figure__empty">
      <span aria-hidden="true">◌</span> {reason}
    </p>
  );
}

/**
 * A labelled state chip: mark, word, and optionally a figure.
 *
 * The mark comes first so the sentence still parses when colour is stripped —
 * "▲ Dutch book, 0.9800" reads the same in monochrome as in full colour.
 */
export function StateChip({
  mark,
  word,
  value,
  tone,
}: {
  mark: string;
  word: string;
  value?: string | null;
  tone: "good" | "warn" | "critical" | "muted";
}) {
  return (
    <span className={`coh-chip is-${tone}`}>
      <span className="coh-chip__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="coh-chip__word">{word}</span>
      {value ? <span className="coh-chip__value">{value}</span> : null}
    </span>
  );
}
