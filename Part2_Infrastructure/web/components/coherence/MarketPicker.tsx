"use client";

/**
 * One market out of a family's whole strike ladder, chosen by typing.
 *
 * WHAT THIS REPLACES, AND WHY IT COULD NOT STAY. `BooksPane` drew its picker as
 * a `.seg` with one button per market. On the live watchlist that is around a
 * hundred and ninety buttons — the reader's screenshot shows eleven rows of
 * them filling the card before any book is drawn — and every one carried a
 * strike like `T66599.99`, which is eleven near-identical glyphs. A segmented
 * control is for two to five peers a reader can take in at a glance; at a
 * hundred and ninety it is not a control, it is the content.
 *
 * NOT `FamilyPicker`, AND THE DIFFERENCE IS THE LIST LENGTH. That control is
 * the right one for four or five families: it opens on the whole roster,
 * because with five rows showing everything IS the affordance. A hundred and
 * ninety rows cannot be scanned, so this one opens on a filter and the roster
 * is what the filter leaves. Same closed state on purpose — the ticker and its
 * position in the list, "T66599.99, 12 of 190" — so a reader who has used one
 * has used the other.
 *
 * NOT `SymbolCombobox` EITHER, for the reason `FamilyPicker`'s header gives
 * about itself: that control accepts free text because `classify()` recognises
 * more symbols than its roster names. A market that is not in this list has no
 * book to draw — the read IS the roster — so free text here would offer a
 * question the gateway cannot answer.
 *
 * GROUPED BY FAMILY, because the ladder is. `KXBTCD-26AUG2410-T66599.99` is a
 * strike on an event, and the books read spans several events; sorting by
 * ticker alone interleaves two ladders and makes the strike order meaningless.
 * The group heading is the event and the row is the strike.
 *
 * The filter matches the WHOLE ticker rather than the strike alone, so typing
 * either `26AUG24` or `66599` narrows to something a reader meant.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

export interface MarketOption {
  ticker: string;
  /** Why this market has no offer, when the book says so. Shown against the row. */
  unquotedReason?: string | null;
}

/** The event a market belongs to: everything before the strike segment. */
function familyOf(ticker: string): string {
  const parts = ticker.split("-");
  return parts.length > 1 ? parts.slice(0, -1).join("-") : ticker;
}

/** The strike segment a reader is actually choosing between. */
function strikeOf(ticker: string): string {
  const parts = ticker.split("-");
  return parts.length > 1 ? parts[parts.length - 1] : ticker;
}

export default function MarketPicker({
  options,
  selected,
  onSelect,
  label,
}: {
  options: readonly MarketOption[];
  selected: string;
  onSelect: (ticker: string) => void;
  /** What choosing does here, for the control's accessible name. */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const index = Math.max(0, options.findIndex((option) => option.ticker === selected));
  const current = options[index];

  const shown = useMemo(() => {
    const q = query.trim().toUpperCase();
    return q ? options.filter((option) => option.ticker.toUpperCase().includes(q)) : [...options];
  }, [options, query]);

  // The active row is clamped rather than left pointing past the end: a filter
  // that shortens the list under an arrow key would otherwise commit nothing.
  useEffect(() => setActiveIndex((at) => Math.min(at, Math.max(0, shown.length - 1))), [shown.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const close = (focusButton = true) => {
    setOpen(false);
    setQuery("");
    if (focusButton) rootRef.current?.querySelector<HTMLButtonElement>(".coh-market__button")?.focus();
  };

  const commit = (at: number) => {
    const option = shown[at];
    if (option) onSelect(option.ticker);
    close();
  };

  const onKey = (event: React.KeyboardEvent) => {
    const last = shown.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(activeIndex + 1, last),
      ArrowUp: Math.max(activeIndex - 1, 0),
      Home: 0,
      End: last,
      // A ladder is long enough that one row per press is not navigation.
      PageDown: Math.min(activeIndex + 10, last),
      PageUp: Math.max(activeIndex - 10, 0),
    };
    if (event.key in moves) {
      event.preventDefault();
      setActiveIndex(moves[event.key]);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      commit(activeIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  return (
    <div className="coh-market" ref={rootRef}>
      <span className="muted">Market</span>
      <div className="coh-market__control">
        <button
          type="button"
          className="coh-market__button"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label}
          onClick={() => {
            if (open) return close(false);
            setActiveIndex(index);
            setOpen(true);
            requestAnimationFrame(() => inputRef.current?.focus());
          }}
        >
          <span className="coh-market__ticker">{current ? strikeOf(current.ticker) : "—"}</span>
          <span className="coh-market__count">
            {options.length > 1 ? `${index + 1} of ${options.length}` : "the only one read"}
          </span>
          <span className="coh-market__caret" aria-hidden="true">{open ? "▴" : "▾"}</span>
        </button>

        {open ? (
          <div className="coh-market__panel">
            <input
              ref={inputRef}
              type="text"
              className="coh-market__filter"
              value={query}
              placeholder="Filter by strike or event"
              aria-label={`${label} — filter`}
              aria-controls={listId}
              aria-activedescendant={shown.length ? `${listId}-${activeIndex}` : undefined}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKey}
            />
            {/* The count is what a filtered list otherwise hides: a reader who
                has narrowed 190 to 3 should be told, and one who has narrowed
                to 0 must be told, or an empty box reads as a broken control. */}
            <p className="coh-market__tally">
              {shown.length === options.length
                ? `${options.length} markets in this read`
                : `${shown.length} of ${options.length} match`}
            </p>
            {shown.length ? (
              <ul id={listId} ref={listRef} className="coh-market__list" role="listbox" aria-label={label}>
                {shown.map((option, at) => {
                  const family = familyOf(option.ticker);
                  const newGroup = at === 0 || familyOf(shown[at - 1].ticker) !== family;
                  return (
                    <li
                      key={option.ticker}
                      id={`${listId}-${at}`}
                      role="option"
                      aria-selected={option.ticker === selected}
                      className={`coh-market__option${at === activeIndex ? " is-active" : ""}`}
                      onPointerUp={() => commit(at)}
                      onPointerMove={() => setActiveIndex(at)}
                    >
                      {/* The event, once per run of its strikes. Presentational:
                          a heading inside a listbox would put a second landmark
                          where a reader expects only options. */}
                      {newGroup ? <span className="coh-market__group">{family}</span> : null}
                      <span className="coh-market__strike">{strikeOf(option.ticker)}</span>
                      {option.unquotedReason ? (
                        <span className="coh-market__unquoted">
                          <span aria-hidden="true">○</span> {option.unquotedReason}
                        </span>
                      ) : null}
                      <span className="coh-market__mark" aria-hidden="true">
                        {option.ticker === selected ? "✓" : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="coh-market__empty">
                <span aria-hidden="true">○</span> No market in this read matches &ldquo;{query}&rdquo;. Clear the
                filter to see all {options.length}.
              </p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
