"use client";

/**
 * The family a per-event read is taken against, chosen the same way twice.
 *
 * `certify` is solved per event, so both sections built on it — Dutch book and
 * Certificate — have to ask which family before they can ask anything else.
 * They were one section until the rail split on 2026-08-24 and the picker was
 * markup inside it; two copies of that markup is two chances for the two
 * sections to disagree about how a family is chosen, which on a shared read
 * cache means two chances to key the cache differently and read the exchange
 * twice for one answer.
 *
 * REJECTED: hoisting the SELECTION into `CoherenceConsole` alongside the
 * universe read. It would keep the two sections on one family, which sounds
 * like an improvement and is not: the console would then own state that only
 * two of its ten sections can use, and a reader who picks a family to read a
 * proof has not asked for the neighbouring section to move with them. The read
 * cache already makes the second read free when they do happen to agree.
 *
 * The label and the control share a line — as a grid item the label blocks onto
 * the row above the thing it names — which is what `.coh-certificate__pick`
 * carries, and it is a `.seg` rather than a `<select>` because the whole list
 * is two or three tickers and a closed dropdown hides which ones.
 */

export interface FamilyPickerProps {
  /** Every family the universe read answered for, in the order it sent them. */
  tickers: readonly string[];
  /** The one being read now. Never null: a section with no family reads nothing. */
  selected: string;
  onSelect: (ticker: string) => void;
  /** What choosing does here, for the group's accessible name. */
  label: string;
}

export default function FamilyPicker({ tickers, selected, onSelect, label }: FamilyPickerProps) {
  return (
    <div className="coh-certificate__pick">
      <span className="muted">Family</span>
      <div className="seg coh-books__picker" role="group" aria-label={label}>
        {tickers.map((ticker) => (
          <button
            key={ticker}
            type="button"
            aria-pressed={ticker === selected}
            onClick={() => onSelect(ticker)}
          >
            {ticker}
          </button>
        ))}
      </div>
    </div>
  );
}
