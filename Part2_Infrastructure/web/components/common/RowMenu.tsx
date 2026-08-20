"use client";

import { ReactNode, useCallback, useEffect, useId, useRef } from "react";

/**
 * A per-row action menu that is not clipped by the table it lives in.
 *
 * The previous shape was `position: absolute; z-index: 20` inside a
 * `position: relative` cell. Every blotter and matrix in this workspace sits in
 * a `.table-wrap` with `overflow: auto`, and z-index cannot lift an element out
 * of an ancestor's overflow — so the menu was clipped by the scroller on any
 * row near its edge, which is exactly the last row, the one people reach for.
 *
 * `popover="auto"` renders it in the top layer, outside every clip and every
 * stacking context, and brings light dismiss (click anywhere else) and Escape
 * with it — both of which the `<details>` version had to be closed by clicking
 * the summary again.
 *
 * Positioned from `getBoundingClientRect()` rather than CSS `anchor()`, which
 * is not yet supported widely enough to be the only path.
 */
export default function RowMenu({
  label,
  children,
}: {
  /** Accessible name for the trigger, e.g. "Actions for BTCUSDT". */
  label: string;
  children: ReactNode;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /** Right-aligned under the trigger, flipped up when the viewport is short. */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const anchor = trigger.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = menu;
    const margin = 6;

    const left = Math.min(
      Math.max(margin, anchor.right - width),
      window.innerWidth - width - margin,
    );
    const below = anchor.bottom + margin;
    const top = below + height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchor.top - height - margin);

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  }, []);

  /**
   * The top layer does not scroll with the table underneath it, so a menu left
   * open through a scroll would float away from its row. It closes instead —
   * but only while it is open.
   *
   * A capturing `scroll` listener on `window` receives the scroll of EVERY box
   * on the page, and this component renders once per row: per position, per
   * provider, per run, per order. Registering unconditionally on mount put one
   * such listener on the window for the life of every row, and because visited
   * workspaces stay mounted behind `hidden` they accumulate across the whole
   * session — counted live in the browser, the desk went from 4 to 16 capture
   * listeners while merely visiting tabs on an empty fixture book, and never
   * gave one back. On a populated blotter that is one synchronous handler per
   * row on every scroll frame.
   *
   * Registering inside `toggle` binds the cost to the one menu that is open,
   * which is at most one: zero listeners while nobody has opened anything.
   * `passive`, because neither handler calls `preventDefault` and a capturing
   * window listener is exactly where a browser has to assume it might.
   */
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const close = () => {
      if (menu.matches(":popover-open")) menu.hidePopover();
    };
    const listen = () => {
      window.addEventListener("scroll", close, { capture: true, passive: true });
      window.addEventListener("resize", close, { passive: true });
    };
    const unlisten = () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
    /**
     * `toggle`, not `beforetoggle`. A closed popover is `display: none`, so at
     * `beforetoggle` it has no box and `offsetWidth`/`offsetHeight` are both 0 —
     * the placement maths runs on zeroes and the menu lands hard against the
     * right edge of the viewport. By `toggle` it is in the top layer and
     * measurable, and this still runs before the browser paints the frame.
     */
    const onToggle = (event: Event) => {
      if ((event as ToggleEvent).newState === "open") {
        place();
        listen();
      } else {
        unlisten();
      }
    };
    menu.addEventListener("toggle", onToggle);
    return () => {
      menu.removeEventListener("toggle", onToggle);
      unlisten();
    };
  }, [place]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="row-menu__trigger"
        aria-label={label}
        popoverTarget={menuId}
      >
        <span aria-hidden>···</span>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        popover="auto"
        className="row-menu__items"
        // Any action closes the menu; without this the popover stays open over
        // a row whose state the click just changed.
        onClick={() => menuRef.current?.hidePopover()}
      >
        {children}
      </div>
    </>
  );
}
