"use client";

import { useEffect, useRef, useState } from "react";
import type { WorkspaceView } from "@/components/WorkspaceHeader";

interface CommandBarProps {
  open: boolean;
  onClose: () => void;
  onSelectTab: (tabId: WorkspaceView) => void;
  onSymbolSelect: (symbol: string) => void;
  onToggleKillSwitch: () => void;
}

interface Command {
  id: string;
  label: string;
  category: string;
  action: () => void;
  hotkey?: string;
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
 * Three more defects went with it, all of which `<dialog>` handles natively and
 * none of which had any implementation here: the palette rendered an `ESC` hint
 * with no Escape handler anywhere, focus was not trapped, and focus was never
 * restored to whatever opened it.
 *
 * Colours come from the token set. The previous version hard-coded nine dark
 * hexes, so the palette was an unreadable dark slab in the light theme.
 */
export default function CommandBar({
  open,
  onClose,
  onSelectTab,
  onSymbolSelect,
  onToggleKillSwitch,
}: CommandBarProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const commands: Command[] = [
    { id: "tab-overview", label: "Overview", category: "Workspace", action: () => onSelectTab("overview"), hotkey: "Alt+1" },
    { id: "tab-research", label: "Research — Quant Researcher", category: "Workspace", action: () => onSelectTab("research"), hotkey: "Alt+2" },
    { id: "tab-execution", label: "Execution — Quant Trader", category: "Workspace", action: () => onSelectTab("live"), hotkey: "Alt+3" },
    { id: "tab-portfolio", label: "Portfolio — Portfolio Manager", category: "Workspace", action: () => onSelectTab("portfolio"), hotkey: "Alt+4" },
    { id: "tab-risk", label: "Risk — Risk Manager", category: "Workspace", action: () => onSelectTab("risk"), hotkey: "Alt+5" },
    { id: "tab-data", label: "Data — Data Engineer", category: "Workspace", action: () => onSelectTab("data"), hotkey: "Alt+6" },
    { id: "tab-reliability", label: "Reliability — DevOps / SRE", category: "Workspace", action: () => onSelectTab("reliability"), hotkey: "Alt+7" },
    { id: "tab-developer", label: "Developer — Quant Developer", category: "Workspace", action: () => onSelectTab("developer"), hotkey: "Alt+8" },

    { id: "sym-btc", label: "BTCUSDT — Bitcoin / USDT spot", category: "Symbol", action: () => onSymbolSelect("BTCUSDT") },
    { id: "sym-eth", label: "ETHUSDT — Ethereum / USDT spot", category: "Symbol", action: () => onSymbolSelect("ETHUSDT") },
    { id: "sym-sol", label: "SOLUSDT — Solana / USDT spot", category: "Symbol", action: () => onSymbolSelect("SOLUSDT") },

    { id: "act-kill", label: "Kill switch — halt and flatten", category: "Risk control", action: onToggleKillSwitch },
  ];

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? commands.filter((c) =>
      c.label.toLowerCase().includes(needle) || c.category.toLowerCase().includes(needle))
    : commands;

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
            placeholder="Workspace, ticker or control…"
            aria-label="Search commands"
          />
          <kbd>esc</kbd>
        </div>

        <ul className="command-bar__results" id="command-bar-results" role="listbox" aria-label="Commands">
          {filtered.length === 0 ? (
            <li className="command-bar__empty">No command, workspace or ticker matches that.</li>
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
          <span>Alt+1–8 jumps to a workspace directly</span>
        </p>
      </div>
    </dialog>
  );
}
