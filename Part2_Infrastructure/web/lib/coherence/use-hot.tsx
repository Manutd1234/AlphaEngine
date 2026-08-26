"use client";

/**
 * Which index is under the reader's hand right now, shared between a figure
 * and the table that explains it.
 *
 * Hot is not chosen. Chosen is a decision (Enter, a click) and is announced;
 * hot is where the pointer or the keyboard walk IS, and it is never spoken —
 * the figure's own region already says what the mark under the pointer is.
 * It is never persisted either: it is gone the moment the pointer leaves.
 *
 * Both directions through one context. A figure's mark hook publishes the
 * index it is showing (`use-mark-readout`'s `hotIndex`), and the table beside
 * it lights the row with that index; a table row's pointer or focus publishes
 * its index, and the figure lights the mark with it. Both read the same
 * `hot`, so the two can never disagree about which entity is meant — as long
 * as the figure's marks and the table's rows are ONE array in document order,
 * which is the rule every site keeps.
 *
 * SCOPED TO THE PAIR, NOT THE SECTION. The provider is placed around the two
 * elements that share the index and nothing else, so a row hover re-renders
 * the figure and its table — not three figures and a 188-row table beside
 * them. That is the mitigation the render buffer would otherwise be reached
 * for; a scope is cheaper than a delay.
 *
 * NO ELEMENT. The provider renders its children, so it can wrap a view's
 * figure without becoming the first thing in the view.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface HotValue {
  hot: number | null;
  setHot: (index: number | null) => void;
}

const HotContext = createContext<HotValue | null>(null);

export function HotSource({ children }: { children: ReactNode }) {
  const [hot, setHot] = useState<number | null>(null);
  const value = useMemo(() => ({ hot, setHot }), [hot]);
  return <HotContext.Provider value={value}>{children}</HotContext.Provider>;
}

/**
 * The hot index and its setter. Outside a provider both are inert: `hot` is
 * null and `setHot` does nothing, so a figure rendered alone behaves exactly
 * as it did before this existed.
 */
export function useHot(): HotValue {
  const context = useContext(HotContext);
  const noop = useCallback(() => {}, []);
  return context ?? { hot: null, setHot: noop };
}
