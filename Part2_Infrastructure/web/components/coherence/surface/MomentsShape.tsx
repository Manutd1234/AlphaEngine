"use client";

import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { LatticeMoments } from "./LatticeInstruments";

export interface MomentsShapeProps {
  surface: CoherenceSurface;
  /** Kept for callers that share the formatted moment labels with disclosures. */
  meanLabel: string;
  sdLabel: string;
}

/** Canonical moments view for the currently selected, server-derived surface. */
export default function MomentsShape({ surface }: MomentsShapeProps) {
  return <LatticeMoments key={surface.event_ticker} surface={surface} />;
}
