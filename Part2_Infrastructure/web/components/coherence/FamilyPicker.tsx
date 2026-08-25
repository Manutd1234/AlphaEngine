"use client";

/**
 * The family a per-event read is taken against, chosen the same way everywhere.
 *
 * `certify` and `/surface` are solved per event, so every section built on one
 * has to ask which family before it can ask anything else. Four sections do,
 * across both tabs; one control is what stops four copies of the markup
 * disagreeing about how a family is chosen, which on a shared read cache means
 * four chances to key the cache differently and read the exchange twice for one
 * answer.
 *
 * WHY THIS IS A LISTBOX NOW, AND WAS A `.seg` BEFORE. The old argument was that
 * "the whole list is two or three tickers and a closed dropdown hides which
 * ones". Both halves stopped being true. The watchlist reads five families, not
 * three, and their tickers are long enough that the row wrapped to two lines on
 * an ordinary viewport — `KXMVECROSSCATEGORY-SHARD1-S2026D454E16D73F` is
 * forty-odd glyphs and there were four of them. More decisively, the 2026-08-25
 * split made Coherence test, Basket and Parlays three sections rather than
 * three groups inside one, and a section is allowed exactly one row of chrome
 * before its drawing. A wrapping row of pills is two.
 *
 * What the old argument was RIGHT about is that a closed control hides the
 * roster, so the closed state names the count — "KXHIGHNY-26AUG24, 1 of 5" —
 * and the reader learns there are five without opening anything.
 *
 * NOT `SymbolCombobox`. That control accepts free text on purpose, because
 * `classify()` recognises twenty crypto bases while its roster names twelve. A
 * family that is not on this list cannot be certified at all — the universe read
 * IS the roster — so free text here would offer a question the gateway cannot
 * answer.
 *
 * NOT A NATIVE `<select>` EITHER: each row carries the shard and the last
 * verdict beside the ticker, and an `<option>` renders one string.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

/** One choosable family, with whatever the calling section already knows of it. */
export interface FamilyOption {
  ticker: string;
  /** Exchange shard. Collateral is per shard, so it changes what is reachable. */
  shard?: number | null;
  /** One word from the last certify, when the section has one. */
  verdict?: string | null;
}

export interface FamilyPickerProps {
  options: readonly FamilyOption[];
  /** The one being read now. Never null: a section with no family reads nothing. */
  selected: string;
  onSelect: (ticker: string) => void;
  /** What choosing does here, for the control's accessible name. */
  label: string;
}

/** Typographic, never coloured-shape: the status vocabulary is house-wide. */
const VERDICT_MARK: Record<string, string> = {
  coherent: "●",
  incoherent: "▲",
  untestable: "○",
};

export default function FamilyPicker({ options, selected, onSelect, label }: FamilyPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const index = Math.max(0, options.findIndex((option) => option.ticker === selected));
  const current = options[index];

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    if (focusButton) rootRef.current?.querySelector("button")?.focus();
  }, []);

  // Pointer-down rather than click: a click that starts inside and ends outside
  // would otherwise leave the list open under a reader who has moved on.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // The active option is scrolled into view rather than left below the fold:
  // arrowing past the visible rows is how a keyboard reader loses their place.
  useEffect(() => {
    if (!open) return;
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openAt = (start: number) => {
    setActiveIndex(start);
    setOpen(true);
    requestAnimationFrame(() => listRef.current?.focus());
  };

  const commit = (at: number) => {
    const option = options[at];
    if (option) onSelect(option.ticker);
    close();
  };

  const onListKey = (event: React.KeyboardEvent) => {
    const last = options.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(activeIndex + 1, last),
      ArrowUp: Math.max(activeIndex - 1, 0),
      Home: 0,
      End: last,
    };
    if (event.key in moves) {
      event.preventDefault();
      setActiveIndex(moves[event.key]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const onButtonKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openAt(index);
    }
  };

  return (
    <div className="coh-family" ref={rootRef}>
      <span className="muted">Family</span>
      {/* The button and its list share a box so the list anchors to the CONTROL
          rather than to the row, which also holds the label. Without it an
          absolutely positioned list hangs from wherever its static position
          happened to land. */}
      <div className="coh-family__control">
      <button
        type="button"
        className="coh-family__button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt(index))}
        onKeyDown={onButtonKey}
      >
        <span className="coh-family__ticker">{current?.ticker ?? "—"}</span>
        {/* The count is the thing a closed control would otherwise hide. Words,
            not a middle dot: this is a label, and the house rule keeps that
            mark between same-kind measurements in tabular type. */}
        <span className="coh-family__count">
          {options.length > 1 ? `${index + 1} of ${options.length}` : "the only one read"}
        </span>
        <span className="coh-family__caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <ul
          id={listId}
          ref={listRef}
          className="coh-family__list"
          role="listbox"
          aria-label={label}
          aria-activedescendant={`${listId}-${activeIndex}`}
          tabIndex={-1}
          onKeyDown={onListKey}
        >
          {options.map((option, at) => (
            <li
              key={option.ticker}
              id={`${listId}-${at}`}
              role="option"
              aria-selected={option.ticker === selected}
              className={`coh-family__option${at === activeIndex ? " is-active" : ""}`}
              onPointerUp={() => commit(at)}
              onPointerMove={() => setActiveIndex(at)}
            >
              <span className="coh-family__ticker">{option.ticker}</span>
              {typeof option.shard === "number" ? (
                <span className="coh-family__shard">shard {option.shard}</span>
              ) : null}
              {option.verdict ? (
                <span className="coh-family__verdict">
                  <span aria-hidden="true">{VERDICT_MARK[option.verdict] ?? "◌"}</span> {option.verdict}
                </span>
              ) : null}
              {/* The selected row is marked as well as announced: `aria-selected`
                  reaches a screen reader and nothing else, and the house rule is
                  that nothing carries meaning in colour alone. */}
              <span className="coh-family__mark" aria-hidden="true">
                {option.ticker === selected ? "✓" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      </div>
    </div>
  );
}
