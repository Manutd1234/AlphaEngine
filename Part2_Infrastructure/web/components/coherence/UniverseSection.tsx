"use client";

/**
 * The Universe section: the watched families, and the index they settle on.
 *
 * Two panes used to stack here with nothing between them — the baskets, then
 * the settlement feed under them — so the second answered a question the first
 * raised without ever saying that it was doing so, and the section ran to
 * three screens before the reader met a heading. They are now three named
 * views of one section behind a `.seg`, which is the only in-section switcher
 * this tab allows: a nested `<WorkspaceSubtabs>` would put a second rail
 * instance in front of the `--rail-h` publisher, as `CoherenceConsole`'s
 * header comment records.
 *
 * The unreadable states stay OUTSIDE the switch. A reader who picks Settlement
 * and is shown a working feed while `COHERENCE_SERIES` is unset has been told
 * the section is fine when the watchlist behind it is empty, so `UniversePane`
 * reports its own failure whichever view is selected and draws the baskets
 * only on the view that asks for them.
 *
 * The universe read itself is NOT gated on the view. It lives in the console
 * and is shared with the certificate and lattice sections, so a view predicate
 * here would starve two other sections of their data.
 */

import { useState } from "react";

import type { CoherenceUniverse } from "@/lib/coherence/types";
import SettlementPane from "./SettlementPane";
import UniversePane from "./UniversePane";

export interface UniverseSectionProps {
  /** The shared universe read, passed straight through from the console. */
  universe: CoherenceUniverse | null;
  error: string | null;
  /** False while another tab or another section is in front. */
  active: boolean;
}

export default function UniverseSection({ universe, error, active }: UniverseSectionProps) {
  const [view, setView] = useState<"baskets" | "settlement" | "formation">("baskets");

  return (
    <div className="coh-universe">
      <div className="seg" role="group" aria-label="Universe view">
        <button type="button" aria-pressed={view === "baskets"} onClick={() => setView("baskets")}>
          Baskets
        </button>
        <button type="button" aria-pressed={view === "settlement"} onClick={() => setView("settlement")}>
          Settlement
        </button>
        <button type="button" aria-pressed={view === "formation"} onClick={() => setView("formation")}>
          Formation
        </button>
      </div>

      <UniversePane universe={universe} error={error} showBaskets={view === "baskets"} />
      {/* The settlement feed owns its own poll, so it is mounted on every view
          and reads on only the two that show it — and it renders nothing at all
          on Baskets, since a "Reading…" line would describe a read that is not
          happening. */}
      <SettlementPane active={active} view={view === "baskets" ? null : view} />
    </div>
  );
}
