"use client";

/**
 * Kalshi episodes: how long a published mispricing survives.
 *
 * The other arm, and the one that answers the question the executor depends on.
 * An episode earns a lifetime only by closing, which is why the survival curve
 * is drawn from closed episodes alone and why the median can be withheld while
 * episodes are still open.
 */

import { useState } from "react";

import type { CoherenceEpisodes, CoherenceStatus } from "@/lib/coherence/types";
import PaneHead from "../PaneHead";
import KalshiArm from "./KalshiArm";

type EpisodeView = "survival" | "episodes";

const VIEWS: ReadonlyArray<[EpisodeView, string]> = [
  ["survival", "Survival"],
  ["episodes", "Episodes"],
];

export default function EpisodesSection({ data, error, status }: {
  data: CoherenceEpisodes | null;
  error: string | null;
  /** The recorder behind the tape, so an empty tape can report its watch. */
  status: CoherenceStatus | null;
}) {
  const [view, setView] = useState<EpisodeView>("survival");
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-episodes-heading">
      <PaneHead
        kicker="Kalshi episodes"
        title="How long a published mispricing survives"
        id="diffusion-episodes-heading"
        note="from closed episodes only, on the recorded tape"
        lede="Measure how long a dislocation lasts before building anything that trades it — it is the one figure that says whether this is a race worth entering."
      />
      <div className="seg" role="group" aria-label="Episodes view">
        {VIEWS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
      </div>
      <KalshiArm data={data} error={error} view={view} status={status} />
    </section>
  );
}
