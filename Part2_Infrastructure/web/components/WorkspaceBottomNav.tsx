"use client";

/**
 * Thumb-reach navigation for phones.
 *
 * The eight workspaces reach a phone as a native `<select>` at the top of a
 * two-row header — correct for completeness, wrong for the hand holding the
 * device. This puts the four the decision loop actually walks within thumb
 * reach and hands the rest to the command palette, which lists all eight with
 * their descriptions.
 *
 * Four plus a menu, not eight: eight 44px targets across a 390px screen leaves
 * ~48px each with no gaps, which is a row of mis-taps. The palette is the
 * honest answer to "where is Risk" — one tap, named, searchable.
 *
 * It reuses `navigate()` rather than owning any state: hash writing, view
 * transitions and scroll reset all stay in one place, and `NAV_ITEMS` stays
 * the single source for what a workspace is called.
 */

import { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";

/** The decision loop's own order — evidence, then intent, then the book. */
const THUMB_REACH: WorkspaceView[] = ["overview", "research", "live", "portfolio"];

export default function WorkspaceBottomNav({
  view,
  onNavigate,
  onOpenPalette,
}: {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onOpenPalette: () => void;
}) {
  const items = THUMB_REACH
    .map((id) => NAV_ITEMS.find((item) => item.id === id))
    .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

  return (
    <nav className="workspace-bottom-nav" aria-label="Primary workspaces">
      {items.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={active ? "page" : undefined}
            className={active ? "is-active" : undefined}
          >
            {item.label}
          </button>
        );
      })}
      <button
        type="button"
        onClick={onOpenPalette}
        /* The other four desks are here rather than crammed into the row —
           the palette names them and can be searched. */
        aria-label="All desks and commands"
      >
        All desks
      </button>
    </nav>
  );
}
