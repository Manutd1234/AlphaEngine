"use client";

import type { CoherenceUniverse } from "@/lib/coherence/types";
import type { BasketOverviewRow } from "./BasketOverview";
import { UniverseWatchlistAtlas } from "./UniverseInstruments";

export interface BasketCompositionProps {
  universe: CoherenceUniverse;
  rows: BasketOverviewRow[];
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  onExplore?: (ticker: string) => void;
}

/** Canonical watchlist composition view, derived from the current universe payload. */
export default function BasketComposition({
  universe,
  rows,
  selectedTicker,
  onSelect,
  onExplore,
}: BasketCompositionProps) {
  return (
    <UniverseWatchlistAtlas
      universe={universe}
      rows={rows}
      selectedTicker={selectedTicker}
      onSelect={onSelect}
      onExplore={onExplore}
    />
  );
}
