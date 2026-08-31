"use client";

/**
 * Canonical entry point for the Lattice survival view.
 *
 * The instrument owns no fixture and no alternate compile-time drawing. Its
 * complete geometry is derived from the `CoherenceSurface` returned for the
 * selected family, including the local quote-shock scenario.
 */

import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { LatticeSurvival } from "./surface/LatticeInstruments";

export default function SurvivalChart({ surface }: { surface: CoherenceSurface }) {
  return <LatticeSurvival key={surface.event_ticker} surface={surface} />;
}
