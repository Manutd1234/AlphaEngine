"use client";

/**
 * Every fact a `<title>` whispers, said out loud — on hover AND on focus.
 *
 * The engine's figures carry about forty facts in SVG `<title>` elements: the
 * band a parlay sits in, what a bin's mass is, why a stage has no percentile.
 * A `<title>` is a native tooltip, which means it is reachable with a mouse and
 * by nothing else. On a touch screen it never appears. From a keyboard it never
 * appears. It is the one affordance on this desk that silently excludes the two
 * groups least able to work around it, and it was carrying the detail the
 * figures were condensed on the promise of.
 *
 * ONE TAB STOP, NOT FORTY. `Heatmap` established the rule the desk follows —
 * "one keyboard instrument, not hundreds of tab stops" — and a figure of six
 * parlays that cost six tab presses to skip would be worse than the tooltip it
 * replaced. The plot takes a single stop; arrow keys walk the marks inside it;
 * Escape lets go. Which is also how the roving grid behaves, so a reader who
 * has met one has met both.
 *
 * WHY IT READS THE DOM RATHER THAN TAKING PROPS. Twenty-five components draw
 * through `<Plot>`, and every one of them already emits its facts as `<title>`
 * children in the right places. Threading a mark list through all of them would
 * be twenty-five edits to say something the markup already says, and the two
 * would drift the first time a figure gained a mark. So the marks ARE the
 * elements carrying a `<title>`, collected in document order, and a figure gets
 * the behaviour by having done nothing.
 *
 * WHAT IT DOES NOT TOUCH: the `<svg>` keeps `role="presentation"` and the
 * wrapper keeps `role="img"` with the figure's one-sentence description. A
 * `role="img"` subtree is presentational to assistive technology, so the marks
 * are NOT announced by being focused — the live region is what speaks, and it
 * is a sibling of the image rather than inside it. That is why this reports
 * `announce` separately instead of putting `aria-label` on the marks.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface MarkReadout {
  /** The focused or hovered mark's own words, from its `<title>`. */
  text: string;
  /** Where to put the readout, in the plot's user units. */
  x: number;
  y: number;
}

/** An element is a MARK when it carries its own `<title>` child. */
function titleOf(element: Element): string | null {
  for (const child of element.children) {
    if (child.tagName.toLowerCase() === "title") return child.textContent?.trim() || null;
  }
  return null;
}

export function useMarkReadout(height: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [readout, setReadout] = useState<MarkReadout | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  // Kept in a ref rather than state: it is recomputed from the DOM on every
  // interaction, and storing it would re-render the figure to describe itself.
  const marks = useRef<Element[]>([]);
  const [interactive, setInteractive] = useState(false);
  // The listener effect binds once, so it reaches the latest closures through
  // refs rather than by rebinding on every render — a figure of 131 marks would
  // otherwise add and remove two listeners on each readout change.
  const focusIndexRef = useRef<number | null>(null);
  const stepRef = useRef<(delta: number | "first" | "last") => void>(() => {});
  const clearRef = useRef<() => void>(() => {});

  /**
   * The marks, in document order.
   *
   * ASKED FOR THE TITLES, NOT FOR EVERY NODE. This walked
   * `querySelectorAll("*")` and ran `titleOf` — itself a loop over an element's
   * children — on every node it found, so a 194-node figure cost 194 element
   * visits plus a child scan each, to locate 89 marks. Selecting the titles and
   * taking their parents is the same list in the same order for one query and
   * no per-node scan.
   *
   * The svg's OWN title would be a figure caption rather than a mark, so a
   * title whose parent is the svg is skipped; nothing on this engine draws one,
   * and it costs a comparison to keep true.
   */
  const collect = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return [];
    const found: Element[] = [];
    for (const title of svg.querySelectorAll("title")) {
      const owner = title.parentElement;
      if (owner && owner !== (svg as Element) && titleOf(owner) !== null) found.push(owner);
    }
    marks.current = found;
    return found;
  }, []);

  // The plot only becomes a tab stop once it HAS a mark to walk to. A figure
  // that draws nothing must not put an empty control in the tab order.
  //
  // NO DEPENDENCY ARRAY, and that is deliberate rather than an oversight. The
  // marks live in the DOM the render prop just produced, so the only honest
  // dependency is "the children changed", which this hook cannot see. It was
  // measured before being left alone: a pointermove over the tab's heaviest
  // figure — 194 nodes, 89 marks — costs 0.0ms at the median and 0.6ms at the
  // worst under a 4x CPU throttle. Forcing a dep array here would trade a
  // correct mark list for nothing.
  useEffect(() => {
    setInteractive(collect().length > 0);
  });

  // NATIVE `focusin`/`focusout`, not React's `onFocus`/`onBlur`, and this is a
  // measured difference rather than a preference: on an `<svg>` element React's
  // synthetic focus handler did not fire at all — the element took focus,
  // `document.activeElement` was the svg, arrow keys worked, and the handler
  // that should have shown the first mark on arrival never ran. Observed in
  // Chrome 151 on 2026-08-25. A keyboard reader would have tabbed to the plot
  // and been told nothing until they guessed that arrows did something.
  //
  // `focusin` bubbles where `focus` does not, so one listener on the svg covers
  // it, and both are plain DOM events that fire whatever React does with them.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onIn = () => { if (focusIndexRef.current === null) stepRef.current("first"); };
    const onOut = () => clearRef.current();
    svg.addEventListener("focusin", onIn);
    svg.addEventListener("focusout", onOut);
    return () => {
      svg.removeEventListener("focusin", onIn);
      svg.removeEventListener("focusout", onOut);
    };
  }, []);

  const show = useCallback((element: Element) => {
    const text = titleOf(element);
    if (!text) return;
    const svg = svgRef.current;
    if (!svg) return;
    // The mark's own box, in user units — the same space the plot draws in, so
    // the readout lands beside the thing it describes at any rendered size.
    const box = (element as SVGGraphicsElement).getBBox?.();
    setReadout(box
      ? { text, x: box.x + box.width / 2, y: box.y }
      : { text, x: svg.viewBox.baseVal.width / 2, y: height / 2 });
  }, [height]);

  const onPointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    let node = event.target as Element | null;
    while (node && node !== event.currentTarget) {
      if (titleOf(node)) { show(node); return; }
      node = node.parentElement;
    }
    setReadout(null);
  }, [show]);

  const clear = useCallback(() => { setReadout(null); setFocusIndex(null); }, []);
  focusIndexRef.current = focusIndex;
  clearRef.current = clear;

  const step = useCallback((delta: number | "first" | "last") => {
    const found = marks.current.length ? marks.current : collect();
    if (!found.length) return;
    const at = focusIndex ?? -1;
    const next = delta === "first" ? 0
      : delta === "last" ? found.length - 1
      : Math.min(found.length - 1, Math.max(0, at + delta));
    setFocusIndex(next);
    show(found[next]);
  }, [collect, focusIndex, show]);
  stepRef.current = step;

  const onKeyDown = useCallback((event: React.KeyboardEvent<SVGSVGElement>) => {
    const moves: Record<string, number | "first" | "last"> = {
      ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: "first", End: "last",
    };
    if (event.key in moves) { event.preventDefault(); step(moves[event.key]); return; }
    if (event.key === "Escape") { event.preventDefault(); clear(); }
  }, [step, clear]);

  return {
    svgRef,
    readout,
    interactive,
    /** Spoken by a live region OUTSIDE the `role="img"` wrapper. */
    announce: readout?.text ?? "",
    handlers: {
      onPointerMove,
      onPointerLeave: clear,
      onKeyDown,
      // No `onFocus`/`onBlur` here — see the native listener effect above.
    },
  };
}
