"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { commandScore } from "@/lib/command-score";

export interface Command {
  id: string;
  label: string;
  category: string;
  action: () => void;
  hotkey?: string;
}

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  /**
   * The palette knows nothing the page does not: every tab, rail section,
   * strategy and symbol is passed in by `page.tsx`, which owns those lists.
   * A palette that keeps its own copy is a second routing table, and second
   * tables drift.
   */
  commands: Command[];
}

/** Ids only, guarded exactly like the experiment log: storage may throw. */
const RECENTS_KEY = "alphaengine.commandbar.recents";
const RECENTS_MAX = 8;

function loadRecents(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveRecents(ids: string[]): void {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(ids.slice(0, RECENTS_MAX)));
  } catch {
    // Private browsing or quota: recents are a convenience, never a failure.
  }
}

/**
 * The ⌘K launcher, as a native modal dialog.
 *
 * `showModal()` is load-bearing, not stylistic. This component used to render a
 * `position: fixed; inset: 0; z-index: 10000` div — and it is a child of
 * `.workspace-header`, which carries `backdrop-filter: blur(18px)`. A filter
 * establishes a stacking context AND a containing block for fixed-position
 * descendants, so the overlay was sized and positioned against the *header
 * box* rather than the viewport, and its z-index was inert outside a context
 * it could not see. No z-index would have fixed it; the top layer does, by
 * leaving the containing block entirely.
 *
 * Matching is the unit-tested subsequence scorer in `lib/command-score` —
 * prefix, word-boundary and consecutive-run bonuses — so "hull" finds the
 * Hull trend model. With an empty query, the palette opens on this browser's
 * recent commands. The dialog's entry is a 0.98→1 scale via @starting-style;
 * SELECTION movement inside the list is deliberately instant — palette
 * latency is felt in single milliseconds.
 */
export default function CommandBar({ open, onClose, commands }: CommandBarProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recents, setRecents] = useState<string[]>([]);

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) {
      // Recents first, deduplicated out of the full list — the same command
      // twice would collide on option ids and read as a stutter.
      const byId = new Map(commands.map((c) => [c.id, c]));
      const recent = recents
        .map((id) => byId.get(id))
        .filter((c): c is Command => Boolean(c))
        .map((c) => ({ ...c, category: "Recent" }));
      const recentIds = new Set(recent.map((c) => c.id));
      return [...recent, ...commands.filter((c) => !recentIds.has(c.id))];
    }
    return commands
      .map((command) => {
        const label = commandScore(needle, command.label);
        const category = commandScore(needle, command.category);
        // The category match is real but weaker evidence of intent.
        const score = Math.max(
          label ?? -Infinity,
          category === null ? -Infinity : category - 4,
        );
        return { command, score };
      })
      .filter((entry) => entry.score !== -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map((entry) => entry.command);
  }, [commands, query, recents]);

  /**
   * Drives the dialog from the `open` prop. `showModal()` rather than the
   * `open` attribute: only the former puts the element in the top layer, and
   * only the former brings the backdrop, the focus trap and Escape with it.
   */
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (open && !node.open) {
      setQuery("");
      setCursor(0);
      setRecents(loadRecents());
      node.showModal();
      inputRef.current?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [open]);

  /**
   * `close` fires for Escape and for `close()` alike, so the parent's state
   * follows the dialog rather than the other way round. Without this, dismissing
   * with Escape would leave `open` true and the palette could not be reopened.
   */
  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    const onCloseEvent = () => onClose();
    node.addEventListener("close", onCloseEvent);
    return () => node.removeEventListener("close", onCloseEvent);
  }, [onClose]);

  const runCommand = (command: Command) => {
    const next = [command.id, ...recents.filter((id) => id !== command.id)].slice(0, RECENTS_MAX);
    setRecents(next);
    saveRecents(next);
    command.action();
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      className="command-bar"
      aria-label="Command launcher"
      // The backdrop is a sibling pseudo-element, so a click landing on the
      // dialog box itself is a click on `<dialog>` only when it hit the padding
      // around the panel — which is what dismiss-on-outside-click means here.
      onClick={(event) => { if (event.target === dialogRef.current) onClose(); }}
    >
      <div className="command-bar__panel">
        <div className="command-bar__search">
          <span className="command-bar__glyph" aria-hidden>⌘</span>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded
            aria-controls="command-bar-results"
            aria-activedescendant={filtered[cursor]?.id}
            value={query}
            onChange={(event) => { setQuery(event.target.value); setCursor(0); }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((c) => (filtered.length ? (c + 1) % filtered.length : 0));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((c) => (filtered.length ? (c - 1 + filtered.length) % filtered.length : 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                const picked = filtered[cursor];
                if (picked) runCommand(picked);
              }
            }}
            placeholder="Tab, section, model, ticker or control…"
            aria-label="Search commands"
          />
          <kbd>esc</kbd>
        </div>

        <ul className="command-bar__results" id="command-bar-results" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <li className="command-bar__empty">No tab, section, model or ticker matches that.</li>
          ) : (
            filtered.map((command, index) => (
              <li key={command.id}>
                <button
                  id={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={index === cursor ? "is-active" : undefined}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => runCommand(command)}
                >
                  <span className="command-bar__category">{command.category}</span>
                  <span className="command-bar__label">{command.label}</span>
                  {command.hotkey && <kbd>{command.hotkey}</kbd>}
                </button>
              </li>
            ))
          )}
        </ul>

        <p className="command-bar__footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>enter</kbd> to run</span>
          <span>Alt+1–8 jumps to a workspace · <kbd>?</kbd> shortcuts &amp; tour</span>
        </p>
      </div>
    </dialog>
  );
}
