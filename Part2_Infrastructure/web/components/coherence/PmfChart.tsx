"use client";

import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { LatticeMass } from "./surface/LatticeInstruments";

/** Canonical mass view for the currently selected, server-derived surface. */
export default function PmfChart({ surface }: { surface: CoherenceSurface }) {
  return <LatticeMass key={surface.event_ticker} surface={surface} />;
}
