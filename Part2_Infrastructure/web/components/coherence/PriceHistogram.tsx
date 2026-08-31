"use client";

import type { CoherenceMarketView } from "@/lib/coherence/types";
import { OutcomePriceConstellation } from "./UniverseInstruments";

export interface PriceHistogramProps {
  markets: CoherenceMarketView[];
  caption: string;
}

/** Canonical quote-distribution view for the supplied live market rows. */
export default function PriceHistogram({ markets, caption }: PriceHistogramProps) {
  return <OutcomePriceConstellation markets={markets} caption={caption} />;
}
