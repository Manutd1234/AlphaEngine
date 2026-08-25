"use client";

/**
 * The readout for a figure whose facts share ONE x, and differ down the y.
 *
 * `useMarkReadout` answers "what is this mark" — it finds the element under the
 * cursor, reads its own `<title>`, and positions one reading beside it. That is
 * the right model for a band, a ladder, a waterfall: every fact belongs to a
 * shape a reader can point at.
 *
 * It is the wrong model for a panel of measures over one axis. The settled
 * record carries seven figures per run — Brier, skill, base rate, uncertainty,
 * bias slope, median horizon, market count — and the question a reader has at a
 * given run is "what were ALL of these, then". A per-mark readout answers that
 * seven times, once per press, and never lets two be compared, because
 * `useMarkReadout` positions a single `getBBox` and structurally shows one.
 *
 * So this reads an INDEX rather than an element: the run under the pointer, or
 * the run the arrows have walked to, and the caller turns that index into as
 * many rows as it likes. `useCrosshair` in `chart-kit` already did the pointer
 * half for the price charts and has never been used on this engine; what is
 * added here is the keyboard half and the spoken half, because a hover-only
 * affordance is the exact defect `useMarkReadout` was written to end.
 *
 * ONE TAB STOP, SAME AS THE OTHER. Arrows walk runs, Home and End jump to the
 * ends, Escape lets go — the same four gestures, so a reader who has met one
 * figure on this tab has met both.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useCrosshair } from "@/components/chart-kit";

export interface SharedXRow {
  label: string;
  value: string;
  color?: string;
}

export interface SharedXReading {
  title: string;
  rows: SharedXRow[];
}

export interface SharedX {
  /** How many positions the axis carries. */
  count: number;
  /** The axis's ends, in user units. */
  x0: number;
  x1: number;
  /** Everything true at one position, which is what the reader came for. */
  read: (index: number) => SharedXReading;
  /** Tooltip box width, in user units. Sized by the caller's longest label. */
  width?: number;
  /**
   * Which end a keyboard reader arrives at.
   *
   * BELONGS TO THE AXIS, NOT TO THIS HOOK, which is why it is a field and not a
   * constant. This was hard-coded to the last position on the reasoning that a
   * record of runs in time arrives at "now" — right for that axis and wrong for
   * an ordered one. On a 124-strike ladder the last position is the far tail,
   * where survival is nearest zero and the mass is thinnest: the least
   * informative end, and the one a sighted reader's eye reaches last. A
   * keyboard reader should not be put there by default because a different
   * figure wanted it.
   *
   * Defaults to "last", so every caller written before this field keeps its
   * behaviour exactly.
   */
  arriveAt?: "first" | "last";
}

export function useSharedXReadout(shared: SharedX | undefined) {
  const svgRef = useRef<SVGSVGElement>(null);
  const count = shared?.count ?? 0;
  const { index: hovered, handlers: cross } = useCrosshair(count, shared?.x0 ?? 0, shared?.x1 ?? 1);
  const [walked, setWalked] = useState<number | null>(null);

  // The pointer wins while it is over the figure, because a reader whose hand
  // is on the mouse is asking with the mouse. The walked index survives
  // underneath it, so leaving the figure returns to where the keyboard was
  // rather than clearing a reading the reader never dismissed.
  const index = hovered ?? walked;

  const onKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    if (!count) return;
    const at = walked ?? -1;
    const moves: Record<string, number | "first" | "last"> = {
      ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last",
    };
    if (event.key in moves) {
      event.preventDefault();
      const delta = moves[event.key];
      const next = delta === "first" ? 0
        : delta === "last" ? count - 1
        : Math.min(count - 1, Math.max(0, at + delta));
      setWalked(next);
      return;
    }
    if (event.key === "Escape") { event.preventDefault(); setWalked(null); }
  }, [count, walked]);

  /**
   * ARRIVAL SAYS SOMETHING, which is the whole reason the mark readout exists.
   * Its own header records the defect: a keyboard reader tabs to a plot, is
   * told nothing, and has to guess that arrows do something. Measured here on
   * 2026-08-26 — focus landed, tabIndex was 0, arrows worked, and the live
   * region was empty until the first press.
   *
   * WHICH END IT ARRIVES AT IS THE CALLER'S, via `arriveAt`. It defaults to the
   * last position — a record of runs in time arrives at "now" — but that is a
   * property of the axis rather than of this hook, and a strike ladder wants
   * the first. Home and End reach either end in one press regardless.
   *
   * Native `focusin`, not React's `onFocus`, for the reason measured on the
   * other hook: React's synthetic focus handler does not fire on an `<svg>`.
   */
  const countRef = useRef(count);
  countRef.current = count;
  const arriveRef = useRef(shared?.arriveAt ?? "last");
  arriveRef.current = shared?.arriveAt ?? "last";
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onIn = () => setWalked((at) => {
      if (at !== null || countRef.current === 0) return at;
      return arriveRef.current === "first" ? 0 : countRef.current - 1;
    });
    svg.addEventListener("focusin", onIn);
    return () => svg.removeEventListener("focusin", onIn);
  }, []);

  const reading = shared && index !== null && index >= 0 && index < count
    ? shared.read(index)
    : null;

  return {
    svgRef,
    index: reading ? index : null,
    reading,
    // Same rule the mark readout keeps: an axis with nothing on it must not put
    // an empty control in the tab order.
    interactive: count > 0,
    /**
     * Spoken by a live region OUTSIDE the `role="img"` wrapper.
     *
     * Prose rather than the tooltip's two columns: a screen reader saying
     * "Brier 0.000115 skill 0.99929" runs two numbers together with nothing
     * between them, and the units are the only thing telling them apart.
     */
    announce: reading
      ? `${reading.title}. ${reading.rows.map((r) => `${r.label} ${r.value}`).join(", ")}.`
      : "",
    handlers: {
      onPointerMove: cross.onPointerMove,
      onPointerLeave: cross.onPointerLeave,
      onKeyDown,
    },
  };
}
