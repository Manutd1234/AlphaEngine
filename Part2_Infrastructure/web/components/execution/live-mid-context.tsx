"use client";

/**
 * Consolidated mid of the active symbol, shared down the execution tree.
 *
 * LiveMarket owns the streaming snapshot and provides the mid around whatever
 * it renders as children; the order ticket consumes it directly for the
 * price-band hint. A context rather than a prop chain so the 5 Hz ticks
 * re-render only the small consumers, not ExecutionCockpit's blotter subtree.
 * Default null: without a live book the hint simply stays silent.
 */

import { createContext, useContext } from "react";

export const LiveMidContext = createContext<number | null>(null);

export function useLiveMid(): number | null {
  return useContext(LiveMidContext);
}
