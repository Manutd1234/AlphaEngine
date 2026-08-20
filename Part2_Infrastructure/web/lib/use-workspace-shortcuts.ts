"use client";

/**
 * The two global keystrokes the desk shell owns, and where they must live.
 *
 * ⌘K belongs to the shell rather than to `WorkspaceHeader` because the palette
 * it opens cannot render inside that element: `.workspace-header` carries a
 * `backdrop-filter`, which is a containing block for fixed-position
 * descendants, so a dialog rendered inside it is positioned against the header
 * box rather than the viewport. The dialog has to be a sibling of the header,
 * and the shortcut follows the thing it controls.
 *
 * "?" opens the shortcuts-and-tour overlay, which is a sibling for the same
 * reason. Both listeners bind once, for the life of the shell, so a tab switch
 * can never change how many of them are attached.
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

export interface WorkspaceShortcuts {
  commandBarOpen: boolean;
  setCommandBarOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsOpen: boolean;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
}

export function useWorkspaceShortcuts(): WorkspaceShortcuts {
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandBarOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Unless the keystroke belongs to an editable target, where a question mark
   * is just a question mark.
   */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(?:INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      setShortcutsOpen((prev) => !prev);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { commandBarOpen, setCommandBarOpen, shortcutsOpen, setShortcutsOpen };
}
