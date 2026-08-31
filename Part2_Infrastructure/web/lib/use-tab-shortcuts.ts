"use client";

/**
 * `Alt+1`…`Alt+9`, then `Alt+0`: shortcuts for the first ten workspaces.
 *
 * Lifted out of `components/WorkspaceHeader.tsx` on 2026-08-24, when the tenth
 * tab pushed that file over the 400-line ceiling. The seam is a real one rather
 * than a convenient line: everything here is a window-level keystroke and knows
 * nothing about the header's boxes, its chips or its resize publisher — which
 * is why it can be read, and asserted on, without a component around it. It
 * sits beside `use-workspace-shortcuts.ts`, which owns the shell's other two
 * global keystrokes for the same reason.
 */

import { useEffect } from "react";

import { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";

export function useTabShortcuts(onViewChange: (view: WorkspaceView) => void): void {
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      // e.code, not e.key: on macOS Option+digit types "¡™£…" so a key-range
      // test never matches and the advertised digit shortcut silently died
      // on every Mac. Physical-key codes are layout- and modifier-stable.
      //
      // Digit0 is the TENTH tab, not the zeroth. There is no digit chord for
      // the eleventh workspace, which remains reachable from the tablist and
      // command palette; claiming Alt+11 would be a dead control. 1–9 then 0
      // is what every browser's own tab strip does for the first ten.
      if (e.altKey && !e.ctrlKey && !e.metaKey && /^Digit[0-9]$/.test(e.code)) {
        // Never while typing — Alt+digit composes characters in text fields.
        const target = e.target as HTMLElement | null;
        if (target && (target.isContentEditable
          || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) {
          return;
        }
        e.preventDefault();
        const digit = Number(e.code.slice(5));
        const index = digit === 0 ? 9 : digit - 1;
        if (index >= 0 && index < NAV_ITEMS.length) {
          onViewChange(NAV_ITEMS[index].id);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onViewChange]);
}
