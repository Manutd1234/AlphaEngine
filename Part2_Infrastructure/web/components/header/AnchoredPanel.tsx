"use client";

/**
 * The one dropdown the header's three controls all open.
 *
 * Account, Settings and the kill switch each carried an identical 12-utility
 * positioning string — `absolute right-0 top-[calc(100%+10px)] z-[60]
 * w-[min(Npx,calc(100vw-28px))] …` — copied three times. Three copies of a
 * positioning rule is how they stopped agreeing: the width clamped to the
 * viewport in all three, and the *inline offset* clamped in none of them, so
 * below the wrap breakpoint every one of them opened off the left edge. Fixing
 * that in three places was the shape of the bug, so it now lives in one.
 *
 * What this component owns: position, width, elevation. What it deliberately
 * does not own: `open` state, dismissal, and focus return. Those stay with the
 * callers because each has its own rules — QuickSettings answers an open-counter
 * from the account menu, the kill switch focuses its confirm input, the account
 * panel keeps itself open while signing out — and a shared component that tried
 * to generalise all three would have to be told about each of them anyway.
 *
 * `role="dialog" aria-modal="false"` is the house pattern for panels inside the
 * header: the header's `backdrop-filter` is a containing block, so a genuinely
 * fixed/modal dialog cannot be positioned against the viewport from in here.
 * Focus is never trapped; Escape and click-away dismiss.
 */

import type { CSSProperties, ReactNode } from "react";

interface AnchoredPanelProps {
  /** Matches the trigger's `aria-controls`. */
  id: string;
  /** Id of the heading inside `children`. */
  labelledBy: string;
  /**
   * Desk-width panel width in px, clamped to the viewport by the stylesheet.
   * A number rather than a class so the three sizes stay readable at the call
   * site instead of hiding in a variant name.
   */
  width: number;
  /**
   * Height-clamp and scroll the body. Only QuickSettings needs it, and it needs
   * it for a real reason recorded at its call site: an absolutely-positioned
   * panel inside a sticky header cannot be scrolled to once it passes the fold.
   */
  scroll?: boolean;
  children: ReactNode;
}

export default function AnchoredPanel({
  id,
  labelledBy,
  width,
  scroll = false,
  children,
}: AnchoredPanelProps) {
  return (
    <div
      id={id}
      role="dialog"
      aria-modal="false"
      aria-labelledby={labelledBy}
      className={scroll ? "anchored-panel anchored-panel--scroll" : "anchored-panel"}
      style={{ "--panel-w": `${width}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
