"use client";

/**
 * Thumb-reach navigation for phones.
 *
 * All eleven workspaces reach a phone as a native `<select>` at the top of a
 * two-row header — correct for completeness, wrong for the hand holding the
 * device. This keeps the previous and next decision-loop stops within thumb
 * reach while the current label opens the complete searchable palette.
 *
 * Three targets, not eleven: eleven 44px targets across a 390px screen would
 * leave ~35px each before gaps, which is a row of mis-taps. The palette is the
 * honest answer to "where is Risk" — one tap, named, searchable — and both
 * adjacent stops remain visible from every workspace.
 *
 * It reuses `navigate()` rather than owning any state: hash writing, view
 * transitions and scroll reset all stay in one place, and `NAV_ITEMS` stays
 * the single source for what a workspace is called.
 */

import {
  NAV_ITEMS,
  nextWorkspaceView,
  previousWorkspaceView,
  type WorkspaceView,
} from "@/lib/workspace-nav";

const NAV_ITEM_BY_ID = new Map(NAV_ITEMS.map((item) => [item.id, item]));

export default function WorkspaceBottomNav({
  view,
  onNavigate,
  onOpenPalette,
}: {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onOpenPalette: () => void;
}) {
  const previous = NAV_ITEM_BY_ID.get(previousWorkspaceView(view)) ?? NAV_ITEMS[0];
  const current = NAV_ITEM_BY_ID.get(view) ?? NAV_ITEMS[0];
  const next = NAV_ITEM_BY_ID.get(nextWorkspaceView(view)) ?? NAV_ITEMS[0];

  return (
    <nav className="workspace-bottom-nav" aria-label="Workspace decision loop">
      <button
        type="button"
        onClick={() => onNavigate(previous.id)}
        aria-label={`Previous workspace: ${previous.label}`}
      >
        <span aria-hidden="true">←</span>
        <span className="workspace-bottom-nav__label">{previous.label}</span>
      </button>
      <button
        type="button"
        className="workspace-bottom-nav__current is-active"
        onClick={onOpenPalette}
        aria-current="page"
        aria-haspopup="dialog"
        aria-label={`${current.label}, current workspace. Open all desks and commands`}
      >
        <span className="workspace-bottom-nav__label">{current.label}</span>
        <small>All desks</small>
      </button>
      <button
        type="button"
        onClick={() => onNavigate(next.id)}
        aria-label={`Next workspace: ${next.label}`}
      >
        <span className="workspace-bottom-nav__label">{next.label}</span>
        <span aria-hidden="true">→</span>
      </button>
    </nav>
  );
}
