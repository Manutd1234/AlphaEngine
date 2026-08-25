"use client";

/**
 * Kalshi episodes: how long a published mispricing survives.
 *
 * The other arm, and the one that answers the question the executor depends on.
 * An episode earns a lifetime only by closing, which is why the survival curve
 * is drawn from closed episodes alone and why the median can be withheld while
 * episodes are still open.
 */

import { memo, useState } from "react";

import type { CoherenceEpisodes, CoherenceIndexSeries, CoherenceStatus } from "@/lib/coherence/types";
import PaneHead from "../PaneHead";
import KalshiArm from "./KalshiArm";

type EpisodeView = "survival" | "episodes";

const VIEWS: ReadonlyArray<[EpisodeView, string]> = [
  ["survival", "Survival"],
  ["episodes", "Episodes"],
];

function EpisodesSection({ data, error, status, index }: {
  data: CoherenceEpisodes | null;
  error: string | null;
  /** The recorder behind the tape, so an empty tape can report its watch. */
  status: CoherenceStatus | null;
  /** The index the episode ledger is downstream of, for the Episodes view. */
  index: CoherenceIndexSeries | null;
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
      {/* Wrapped 2026-08-25: a bare `.seg` could be reached by neither
          the sticky rule nor the wrap rule, both `.coh-bar`-scoped. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Episodes view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <KalshiArm data={data} error={error} view={view} status={status} index={index} />
    </section>
  );
}

/**
 * MEMOISED, because the console above it re-renders on every poll.
 *
 * `DiffusionConsole` has to re-render every twenty seconds — the freshness
 * stamp is a clock — but since `use-coherence.ts` keeps a payload's identity
 * when nothing drawable changed, the props reaching this section are usually
 * the same objects they were. Without a memo boundary that fact buys nothing:
 * a parent re-render re-renders its children whatever their props say.
 *
 * The saving is small and measured rather than assumed: about 1.9ms of script
 * per poll, taken back to back with only the identity check toggled. React
 * writes nothing to the DOM when the output matches, so what this boundary
 * saves is reconciliation, not paint.
 */
export default memo(EpisodesSection);
