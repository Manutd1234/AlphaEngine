"use client";

/**
 * A symbol picker that shows every symbol when you open it.
 *
 * WHAT WAS WRONG WITH THE DATALIST THIS REPLACES
 *
 * The field was `<input list="research-symbols">`. A native `<datalist>` filters
 * its options against the input's CURRENT value, so with `BTCUSDT` already in
 * the box exactly one option matched and the dropdown showed a single row. The
 * only way to see the other thirty-one was to select-all, delete, and then open
 * it — which is not a discoverable gesture, and made a thirty-two symbol roster
 * look like a text field with one suggestion.
 *
 * That is native behaviour, not a bug in the old markup, and there is no
 * attribute that turns it off. A datalist cannot do "show everything on open",
 * so the control has to stop being one.
 *
 * WHY NOT JUST A `<select>`
 *
 * Because the field accepts symbols that are not on the list, and that is load-
 * bearing rather than incidental. `classify()` recognises twenty crypto bases
 * while the roster names twelve, so ATOMUSDT, ARBUSDT, OPUSDT, SUIUSDT,
 * APTUSDT, NEARUSDT and POLUSDT all backtest correctly today and none of them
 * appear in the list. Equities reach four providers the same way. A `<select>`
 * shows all its options — the thing being asked for — and silently deletes the
 * ability to type any of those. So: a real combobox, which does both.
 *
 * WHAT IT DELIBERATELY KEEPS FROM THE OLD FIELD
 *
 * Free text, uppercasing, and the empty-field fallback to BTCUSDT all behave
 * exactly as before, because a picker that rejects an unlisted ticker would be
 * a narrower control wearing a nicer dropdown.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { RESEARCH_SYMBOLS, type ResearchSymbol } from "@/lib/research-symbols";

/**
 * Match on ticker, issuer name or sector.
 *
 * Typing "bank" should find the financials and "bit" should find Bitcoin —
 * a roster of thirty-two is only navigable if a reader who knows the company
 * but not the ticker can still get there. An empty query matches EVERYTHING,
 * which is the entire point of this component.
 */
export function filterSymbols(query: string, roster: ResearchSymbol[] = RESEARCH_SYMBOLS): ResearchSymbol[] {
  const q = query.trim().toUpperCase();
  if (!q) return roster;
  return roster.filter((s) =>
    s.symbol.toUpperCase().includes(q)
    || s.name.toUpperCase().includes(q)
    || s.sector.toUpperCase().includes(q));
}

export default function SymbolCombobox({
  value,
  onCommit,
  id = "symbol",
  label = "Symbol",
}: {
  value: string;
  /** Fired when a value is settled — a pick, a blur, or Enter. Never per keystroke. */
  onCommit: (symbol: string) => void;
  id?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  /**
   * What is in the box while typing.
   *
   * Held separately from `value` so a half-typed ticker never reaches the sweep.
   * The old field committed on every keystroke, so typing "ETHUSDT" fired runs
   * for "E", "ET", "ETH"… — the debounce upstream hid it, but the control was
   * still describing intermediate states as decisions.
   */
  const [draft, setDraft] = useState(value);
  const [cursor, setCursor] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  /**
   * The symbol we last committed, held until the parent's state catches up.
   *
   * See `useEffect` below — this exists purely to sequence the auto-run signal.
   */
  const pending = useRef<string | null>(null);

  /**
   * Re-emit a native `change` once the committed symbol has reached the parent.
   *
   * `Controls` auto-runs the sweep from a single native `change` listener on the
   * panel root — one listener for every slider, select and field in the subtree,
   * which is why adding a control there needs no wiring. React's `onChange` is
   * the `input` event, and a value set from a listbox click fires no native
   * `change` at all, so without this a pick would update the symbol and then sit
   * there until the 700 ms idle fallback noticed. The old `<datalist>` got this
   * for free: picking an option fires `input` AND `change`.
   *
   * The event is dispatched from an effect keyed on `value` — the committed prop
   * — rather than inline in `commit()`, and that ordering is the whole point.
   * The panel's listener calls `commitRequest`, which closes over `req`; firing
   * synchronously would hand it the request from BEFORE this pick and it would
   * either run the previous symbol or dedupe itself away as unchanged.
   */
  useEffect(() => {
    if (pending.current === null || pending.current !== value) return;
    pending.current = null;
    inputRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [value]);

  // When the sweep changes the symbol from elsewhere — a cross-link, a restored
  // experiment — the box has to follow. Guarded on `open` so a re-render mid-typing
  // cannot yank the caret out from under someone.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  /**
   * The list is filtered by the DRAFT, except immediately after opening.
   *
   * `justOpened` is the whole fix in one flag. On open the query is suppressed
   * so every symbol is listed even though the box is full — which is precisely
   * what the datalist could not do. The moment a key is pressed, filtering
   * resumes and the control behaves like a normal typeahead.
   */
  const [justOpened, setJustOpened] = useState(false);
  const matches = useMemo(
    () => filterSymbols(justOpened ? "" : draft),
    [draft, justOpened],
  );

  const openList = () => {
    setJustOpened(true);
    setOpen(true);
    // Put the cursor on the current symbol rather than the top of the list, so
    // arrow-down from an open list moves from where you are, not from the start.
    const at = RESEARCH_SYMBOLS.findIndex((s) => s.symbol === value.toUpperCase());
    setCursor(at >= 0 ? at : 0);
  };

  const commit = (next: string) => {
    // Same normalisation the old field applied on blur, unchanged: uppercase,
    // trimmed, and an empty box falls back rather than sending "" to the engine.
    const clean = next.trim().toUpperCase() || "BTCUSDT";
    setDraft(clean);
    setOpen(false);
    setJustOpened(false);
    // Only arm the auto-run signal when the symbol actually changed. Opening the
    // list and clicking away commits the value that was already there, and that
    // is not an edit — re-running the sweep for it would turn idle browsing of
    // the roster into repeated work.
    if (clean !== value.toUpperCase()) pending.current = clean;
    onCommit(clean);
  };

  // Close on an outside click. `pointerdown` rather than `click` so the list is
  // gone before a click on another control lands — closing on `click` lets the
  // list swallow the first press on whatever you were reaching for.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        commit(draft);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  return (
    <div className="symbol-combo" ref={rootRef}>
      <label className="field" htmlFor={id}>{label}</label>
      <div className="symbol-combo__field">
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[cursor] ? `${listId}-${matches[cursor].symbol}` : undefined}
          value={draft}
          // Clicking the field opens the full list. This is the reported bug:
          // the old control required emptying the box first.
          onMouseDown={() => { if (!open) openList(); }}
          onFocus={() => { if (!open) openList(); }}
          onChange={(event) => {
            setDraft(event.target.value.toUpperCase());
            setJustOpened(false); // typing resumes filtering
            setCursor(0);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (!open) return openList();
              setJustOpened(false);
              const delta = event.key === "ArrowDown" ? 1 : -1;
              setCursor((c) => (matches.length ? (c + delta + matches.length) % matches.length : 0));
            } else if (event.key === "Enter") {
              event.preventDefault();
              // An open list with a highlighted row commits that row; otherwise
              // the typed text stands, which is what keeps unlisted tickers usable.
              commit(open && matches[cursor] ? matches[cursor].symbol : draft);
            } else if (event.key === "Escape") {
              // Abandons the edit rather than committing it — the one gesture
              // that has to leave the sweep untouched.
              event.preventDefault();
              setDraft(value);
              setOpen(false);
              setJustOpened(false);
            } else if (event.key === "Tab") {
              commit(draft);
            }
          }}
        />
        <button
          type="button"
          className="symbol-combo__toggle"
          // Labelled, because a bare glyph is unreadable to a screen reader and
          // this button is the affordance the whole fix hangs on.
          aria-label={open ? "Hide symbol list" : "Show all symbols"}
          tabIndex={-1}
          onMouseDown={(event) => {
            // Prevent the input's own mousedown/focus from also firing, which
            // would open and then immediately close on the same press.
            event.preventDefault();
            if (open) {
              setOpen(false);
              setJustOpened(false);
            } else {
              openList();
              inputRef.current?.focus();
            }
          }}
        >
          <span aria-hidden>▾</span>
        </button>
      </div>

      {open ? (
        <ul className="symbol-combo__list" id={listId} role="listbox" aria-label="Symbols">
          {matches.length === 0 ? (
            // Not an empty box. An unlisted ticker is a legitimate entry, so the
            // control says so rather than implying the value is rejected.
            <li className="symbol-combo__empty">
              No listed symbol matches “{draft}”. Press Enter to use it anyway.
            </li>
          ) : (
            matches.map((s, index) => (
              <li key={s.symbol}>
                <button
                  id={`${listId}-${s.symbol}`}
                  type="button"
                  role="option"
                  aria-selected={s.symbol === value.toUpperCase()}
                  className={index === cursor ? "is-active" : undefined}
                  onMouseEnter={() => setCursor(index)}
                  // `mousedown`, not `click`: the input's blur fires first on a
                  // click and would commit the draft, closing the list before
                  // the pick is registered.
                  onMouseDown={(event) => { event.preventDefault(); commit(s.symbol); }}
                >
                  <span className="symbol-combo__ticker num">{s.symbol}</span>
                  <span className="symbol-combo__name">{s.name}</span>
                  <span className="symbol-combo__sector">{s.sector}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
