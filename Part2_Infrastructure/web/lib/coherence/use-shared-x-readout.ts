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
 *
 * THE AXIS MAY BE POSITIONAL, since 2026-08-26. `useCrosshair` maps the pointer
 * to `round(frac * (count - 1))`, which is right only when the positions are
 * evenly spaced — and nine of ten crosshair candidates on this engine are not:
 * `use-live-series` appends a null when a poll fails and the tape keeps its
 * width across the gap by design, so the marks are unevenly spaced exactly
 * where the tape is most informative; runs sit at their own stamps; strikes at
 * their own prices. An axis that hands over `positions` gets the NEAREST one
 * under the pointer instead, and this hook then owns where the readout is
 * drawn (`at`) — the shell used to do that sum itself, with the even-spacing
 * assumption baked in. Without `positions` nothing here changes: the three
 * figures outside this engine that share an axis never set it.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useCrosshair } from "@/components/chart-kit";

import { useLinkedX } from "./linked-x";

export interface SharedXRow {
  label: string;
  value: string;
  color?: string;
  /**
   * The number `value` was printed from, when there is one. A pinned
   * comparison's `diff` reads it; null (or absent) when the value is a dash,
   * so a dash is never subtracted from a dash.
   */
  raw?: number | null;
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
   * Where each position sits, in user units — for an axis drawn BY VALUE.
   *
   * Optional, and absent on every caller written before it: the pointer then
   * maps by even spacing exactly as it did. Present, the pointer maps to the
   * nearest declared position, and `at` is read from here rather than summed
   * by the shell. Not required to be sorted; the search is a scan, because an
   * axis here carries hundreds of positions at most.
   */
  positions?: readonly number[];
  /**
   * The pair this axis belongs to, if any. Two figures declaring the same key
   * follow each other's index — one position drawn on both, spoken once. See
   * `linked-x.tsx` for the one condition under which that is honest: both
   * members count the same thing.
   */
  link?: string;
  /**
   * Whether a reader may hold one position and read every other against it.
   * Enter or Space on the keyboard, a click with a pointer; Escape lets go of
   * the walked position first and of the pin on a second press.
   */
  pin?: boolean;
  /** How a row differs from its pinned counterpart. Called only when both carry `raw`. */
  diff?: (current: SharedXRow, pinned: SharedXRow) => string;
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

  /**
   * The positional half. `useCrosshair` still runs above — hooks must, and it
   * is still the pointer half for an evenly spaced axis — but when the axis
   * declares its positions the pointer is read HERE instead. The pointer's x
   * in user units is the sum `useCrosshair` does and does not export: the same
   * rect-and-viewBox arithmetic, copied rather than reached, so the two halves
   * cannot disagree about where the pointer is.
   */
  const positions = shared?.positions;
  const [pointed, setPointed] = useState<number | null>(null);
  const onPositionalMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!positions || positions.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = rect.width / event.currentTarget.viewBox.baseVal.width || 1;
    const x = (event.clientX - rect.left) / scale;
    let best = 0;
    for (let i = 1; i < positions.length; i += 1) {
      if (Math.abs(positions[i] - x) < Math.abs(positions[best] - x)) best = i;
    }
    setPointed(best < count ? best : null);
  }, [positions, count]);
  const leavePositional = useCallback(() => setPointed(null), []);

  // The pointer wins while it is over the figure, because a reader whose hand
  // is on the mouse is asking with the mouse. The walked index survives
  // underneath it, so leaving the figure returns to where the keyboard was
  // rather than clearing a reading the reader never dismissed.
  const pointer = positions ? pointed : hovered;

  /**
   * THE LINK, and the one line that keeps it away from everyone else.
   *
   * `own` is this figure's live index — the pointer while it is over the
   * figure, the walked position while the figure has focus — and it exists
   * ONLY when the axis declared a `link`. Computed for every figure it would
   * empty `announce` on blur, and today the walked reading keeps speaking
   * after focus leaves; the three figures outside this engine rely on that.
   * A linked figure reads its own index first, then what its partner
   * published, then where its own keyboard last stood.
   */
  const link = shared?.link;
  const { followed, publish } = useLinkedX(link, useId());
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState<number | null>(null);
  const own = link ? (pointer ?? (focused ? walked : null)) : null;
  const index = link ? (own ?? followed ?? walked) : (pointer ?? walked);
  // A follower says nothing: one keypress on the publisher is one utterance.
  const following = link !== undefined && own === null && followed !== null;
  // Publish in an effect, never during render, and only what is live. When
  // the pointer LEAVES an unfocused figure the partner is cleared too, so it
  // does not stand on a position nobody is asking about; a blur is not a
  // leave — the walked position stays for the partner to arrive on.
  const pointerRef = useRef<number | null>(null);
  useEffect(() => {
    if (own !== null) publish(own);
    else if (pointerRef.current !== null) publish(null);
    pointerRef.current = pointer;
  }, [own, pointer, publish]);

  /** Where position `i` sits: declared when the axis said, evenly spaced otherwise. */
  const atOf = (i: number): number => {
    if (positions && i < positions.length) return positions[i];
    const x0 = shared?.x0 ?? 0;
    const x1 = shared?.x1 ?? 1;
    return x0 + ((x1 - x0) * i) / Math.max(1, count - 1);
  };

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
    if (event.key === "Escape") {
      event.preventDefault();
      // The walked position first, the pin second: two things held, two presses.
      if (walked !== null) setWalked(null);
      else setPinned(null);
      if (link) publish(null);
      return;
    }
    if (shared?.pin && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      if (index !== null) setPinned((held) => (held === index ? null : index));
    }
  }, [count, walked, link, publish, shared?.pin, index]);

  /** A click pins where the pointer is; bound only when the axis asked. */
  const onClick = useCallback(() => {
    if (index !== null) setPinned((held) => (held === index ? null : index));
  }, [index]);

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
  const followedRef = useRef<number | null>(null);
  followedRef.current = followed;
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onIn = () => setWalked((at) => {
      if (at !== null || countRef.current === 0) return at;
      // A linked figure arrives where its partner stands, so focus moving from
      // one member to the other lands on the same position — before the
      // axis's own preferred end, which is the fallback.
      if (followedRef.current !== null && followedRef.current < countRef.current) return followedRef.current;
      return arriveRef.current === "first" ? 0 : countRef.current - 1;
    });
    const onGain = () => setFocused(true);
    const onLose = () => setFocused(false);
    svg.addEventListener("focusin", onIn);
    svg.addEventListener("focusin", onGain);
    svg.addEventListener("focusout", onLose);
    return () => {
      svg.removeEventListener("focusin", onIn);
      svg.removeEventListener("focusin", onGain);
      svg.removeEventListener("focusout", onLose);
    };
  }, []);

  const current = shared && index !== null && index >= 0 && index < count
    ? shared.read(index)
    : null;
  // The pinned reading, merged row by row into the current one: "now was
  // then", and the difference only where both rows carry the number they
  // were printed from.
  const held = shared && pinned !== null && pinned !== index && pinned >= 0 && pinned < count
    ? shared.read(pinned)
    : null;
  const reading = current && held ? merge(current, held, shared?.diff) : current;

  return {
    svgRef,
    index: reading ? index : null,
    reading,
    /** Where the pin sits, in user units; null when nothing is pinned. */
    pinnedAt: pinned !== null ? atOf(pinned) : null,
    /** Where the reading sits on the x axis, in user units; the shell draws it there. */
    at: reading && index !== null ? atOf(index) : null,
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
    announce: following ? "" : reading
      ? `${reading.title}. ${reading.rows.map((r) => `${r.label} ${r.value}`).join(", ")}.`
      : "",
    handlers: {
      onPointerMove: positions ? onPositionalMove : cross.onPointerMove,
      onPointerLeave: positions ? leavePositional : cross.onPointerLeave,
      onKeyDown,
      ...(shared?.pin ? { onClick } : {}),
    },
  };
}

/** The current reading against the pinned one, row by row. */
function merge(current: SharedXReading, held: SharedXReading, diff?: SharedX["diff"]): SharedXReading {
  return {
    title: `${current.title}, pinned against ${held.title}`,
    rows: current.rows.map((row, i) => {
      const other = held.rows[i];
      if (!other) return row;
      let value = `${row.value} was ${other.value}`;
      if (diff && row.raw != null && other.raw != null) value += `, ${diff(row, other)}`;
      return { ...row, value };
    }),
  };
}
