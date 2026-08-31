"use client";

import type { CoherenceUniverse } from "@/lib/coherence/types";
import { UniverseLiquidityCabinet } from "./UniverseInstruments";

export interface BasketSizeProps {
  universe: CoherenceUniverse;
  selectedTicker?: string | null;
}

/** Canonical liquidity view, derived from the current universe payload. */
export default function BasketSize({ universe, selectedTicker }: BasketSizeProps) {
  return <UniverseLiquidityCabinet universe={universe} selectedTicker={selectedTicker} />;
}
