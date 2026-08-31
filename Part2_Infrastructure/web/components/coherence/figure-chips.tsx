/**
 * The two chips a figure renders beside its plot, and nothing else.
 *
 * Both lived at the bottom of `Figure.tsx` until 2026-08-26 — forty-two lines
 * with no interaction in them, in the one file on this engine whose ceiling
 * is measured in single digits. `Figure.tsx` re-exports both, so every
 * importer keeps its line and the shell keeps the room the next slices need
 * (a `controls` slot for sliders and toggles, outside the image).
 */

/**
 * The empty state a figure renders instead of an axis with nothing on it.
 *
 * A blank plot area and a plot area with nothing in it look identical, and one
 * of them means the feed is down. This says which.
 */
export function FigureEmpty({ reason, busy = false }: { reason: string; busy?: boolean }) {
  return (
    <p className="coh-figure__empty" role={busy ? "status" : undefined} aria-busy={busy || undefined}>
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
    <span className={`coh-chip is-${tone}`} title={value ? `${word}: ${value}` : word}>
      <span className="coh-chip__mark" aria-hidden="true">
        {mark}
      </span>
      <span className="coh-chip__word">{word}</span>
      {/* The whole chip carries the hover text because either the word or value
          may truncate inside a narrow owner. The full DOM text remains the
          screen-reader reading. */}
      {value ? <span className="coh-chip__value">{value}</span> : null}
    </span>
  );
}
