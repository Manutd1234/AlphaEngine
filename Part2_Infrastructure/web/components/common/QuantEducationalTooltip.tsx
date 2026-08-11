"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";

interface QuantEducationalTooltipProps {
  term: string;
  definition: string;
  formula?: string;
  plainEnglish: string;
}

/**
 * The term explainer, as a top-layer popover.
 *
 * It used to be `position: absolute; z-index: 9999` inside an inline
 * `position: relative` span. z-index cannot escape an ancestor's `overflow`,
 * and this appears inside cards and inside `.table-wrap` scrollers — so the
 * panel was clipped to whatever box it happened to sit in, and 9999 bought
 * nothing. `popover` renders it in the browser's top layer, outside every
 * clip and every stacking context.
 *
 * Position comes from `getBoundingClientRect()` rather than CSS anchor
 * positioning: `anchor()` is not supported widely enough to be the only path,
 * and a tooltip that lands in the corner on a third of browsers is worse than
 * one that never uses the newer syntax.
 *
 * `popover="manual"` rather than `"auto"`: `auto` closes on any outside
 * pointer-down, which fights the hover-to-open behaviour this has always had.
 * Dismissal is handled explicitly below, including Escape.
 */
export default function QuantEducationalTooltip({
  term,
  definition,
  formula,
  plainEnglish,
}: QuantEducationalTooltipProps) {
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  /** Pins the panel above the trigger, clamped into the viewport. */
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const panel = popoverRef.current;
    if (!trigger || !panel) return;
    const anchor = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const margin = 8;

    const left = Math.min(
      Math.max(margin, anchor.left + anchor.width / 2 - width / 2),
      window.innerWidth - width - margin,
    );
    // Above by default; below when there is not room, so the panel never sits
    // half off the top of a viewport it was opened near.
    const above = anchor.top - height - margin;
    const top = above >= margin ? above : anchor.bottom + margin;

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }, []);

  useEffect(() => {
    const panel = popoverRef.current;
    if (!panel || typeof panel.showPopover !== "function") return;
    if (open) {
      if (!panel.matches(":popover-open")) panel.showPopover();
      place();
    } else if (panel.matches(":popover-open")) {
      panel.hidePopover();
    }
  }, [open, place]);

  // The top layer does not scroll with the page, so a panel left open through
  // a scroll would detach from its trigger. Close instead of chasing it.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="quant-tooltip-trigger"
        aria-label={`Learn about ${term}`}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        /* Hover-to-open only where hover exists. iOS synthesises
           mouseenter → click for a single tap, so the two handlers cancelled
           each other and the tooltip never opened on a phone at all. */
        onMouseEnter={() => {
          if (window.matchMedia("(hover: hover)").matches) setOpen(true);
        }}
        onMouseLeave={() => {
          if (window.matchMedia("(hover: hover)").matches) setOpen(false);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <span aria-hidden>ⓘ</span> {term}
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        role="tooltip"
        popover="manual"
        className="quant-tooltip"
      >
        <strong className="quant-tooltip__term">{term}</strong>
        <p className="quant-tooltip__definition">{definition}</p>
        {formula && <code className="quant-tooltip__formula">{formula}</code>}
        <p className="quant-tooltip__plain">
          <strong>In plain English:</strong> {plainEnglish}
        </p>
      </div>
    </>
  );
}
