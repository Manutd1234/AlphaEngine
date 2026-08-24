"use client";

/**
 * How fast this market absorbs information — the honest gate on the engine.
 *
 * Every coherence violation is an episode: the prices admitted a Dutch book,
 * then they did not. The distribution of those lifetimes decides whether any of
 * this is a trading system or a screenshot. If the median is under the round
 * trip, the opportunity was never available and the race was lost before it was
 * entered — and that is worth knowing before an executor is built, not after.
 *
 * The survival curve is drawn from closed episodes only. An episode still
 * running is a lower bound on a lifetime, not a measurement, and mixing bounds
 * with measurements pulls the curve down by exactly the long tail it exists to
 * show.
 *
 * This section is also where the information-diffusion work lands. The samples
 * here and the samples from an earnings or rate-decision window are the same
 * shape — `lib/coherence/absorption.ts` is the contract — so one estimator runs
 * over both and the comparison between venues is the interesting part.
 *
 * One flat switcher, four peers — Absorption, Mechanism, Findings, Kalshi
 * episodes — rather than a venue control with a three-way control stacked
 * under it. The venue axis had one branch of arity three and one of arity one,
 * and a level that exists to hold a single leaf has nothing to switch; two
 * `.seg` controls in a column read as one broken control. What that level used
 * to say lives in the sentence above the switcher, where a reader can see it
 * instead of finding it in a comment.
 */

import { useMeasuredWidth } from "@/components/chart-kit";
import { useState } from "react";

import { episodesToSamples } from "@/lib/coherence/absorption";
import type { CoherenceEpisodes } from "@/lib/coherence/types";
import { absorptionRoute, episodesRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "./Figure";
import InformationDiffusionPane from "./diffusion/InformationDiffusionPane";
import type { AbsorptionRead } from "./diffusion/types";

const HEIGHT = 160;
const MARGIN = { top: 12, right: 6, bottom: 22, left: 6 };

function SurvivalChart({ data }: { data: CoherenceEpisodes }) {
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);
  const points = data.survival.map((point) => ({ t: Number(point.t_s), s: Number(point.surviving) }));
  if (points.length < 2) {
    return (
      <Figure
        caption="How long a violation survives"
        ariaLabel="Not enough closed episodes to draw a survival curve"
        missing={data.median_withheld_reason}
      >
        <FigureEmpty reason="A curve needs at least two closed episodes." />
      </Figure>
    );
  }

  const longest = Math.max(...points.map((point) => point.t), 1);
  const plotWidth = plotW - MARGIN.left - MARGIN.right;
  const base = HEIGHT - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (t / longest) * plotWidth;
  const y = (s: number) => base - s * (base - MARGIN.top);

  // A step, not a line: survival is constant between observed lifetimes, and a
  // smooth curve would draw episodes ending at times nothing was measured.
  let path = `M${MARGIN.left},${y(1).toFixed(2)}`;
  let previous = 1;
  for (const point of points) {
    path += `L${x(point.t).toFixed(2)},${y(previous).toFixed(2)}L${x(point.t).toFixed(2)},${y(point.s).toFixed(2)}`;
    previous = point.s;
  }

  const median = data.median_s ? Number(data.median_s) : null;

  return (
    <Figure
      caption="How long a violation survives, from the episodes recorded so far"
      ariaLabel={`Survival curve over ${data.episodes.length} closed episodes, longest ${longest} seconds`}
      reading={data.verdict}
      missing={data.median_withheld_reason}
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT} className="coh-survival">
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
        <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={y(0.5)} y2={y(0.5)} className="coh-survival__half" />
        <path d={path} className="coh-survival__step" fill="none" />
        {median != null ? (
          <line x1={x(median)} x2={x(median)} y1={MARGIN.top} y2={base} className="coh-survival__median" />
        ) : null}
        <text x={MARGIN.left} y={y(0.5) - 2} className="coh-ladder__tick">
          half still open
        </text>
        <text x={plotW - MARGIN.right} y={HEIGHT - 6} textAnchor="end" className="coh-ladder__tick">
          {longest}s
        </text>
        </svg>
      </div>
    </Figure>
  );
}

/** The Kalshi arm: chips, the survival curve, the episode table and its notes. */
function KalshiEpisodes({ data, error }: { data: CoherenceEpisodes | null; error: string | null }) {
  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> Episodes could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Reading the episodes…</p>;

  const samples = episodesToSamples(data.episodes);
  const withHalfLife = samples.filter((sample) => sample.half_life_s != null);

  return (
    <>
      <div className="coh-status__chips">
        <StateChip mark="●" word="Closed episodes" value={String(data.episodes.length)} tone="muted" />
        <StateChip mark="◌" word="Still open" value={String(data.open_episodes)} tone="muted" />
        <StateChip
          mark={data.median_s ? "✓" : "◌"}
          word="Median lifetime"
          value={data.median_s ? `${data.median_s}s` : "withheld"}
          tone={data.median_s ? "good" : "muted"}
        />
        <StateChip mark="→" word="Round trip assumed" value={`${data.round_trip_s}s`} tone="muted" />
      </div>

      <SurvivalChart data={data} />

      {data.episodes.length ? (
        <div className="table-wrap">
          <table className="coh-table">
            <caption className="coh-table__caption">
              Every closed episode, with the time it took the dislocation to halve
            </caption>
            <thead>
              <tr>
                <th scope="col">Family</th>
                <th scope="col">Constraint</th>
                <th scope="col" className="num">Lifetime</th>
                <th scope="col" className="num">Peak distance</th>
                <th scope="col" className="num">Peak net edge</th>
                <th scope="col" className="num">Half-life</th>
              </tr>
            </thead>
            <tbody>
              {data.episodes.map((episode, index) => (
                <tr key={`${episode.component_id}-${episode.opened_ts_ns}`}>
                  <th scope="row">{episode.event_ticker}</th>
                  <td>{episode.family || "—"}</td>
                  <td className="num">{episode.lifetime_s ? `${episode.lifetime_s}s` : "—"}</td>
                  <td className="num">{episode.peak_ci ?? "—"}</td>
                  <td className="num">{episode.peak_net_edge_dollars ?? "—"}</td>
                  <td className="num">
                    {samples[index]?.half_life_s != null ? `${samples[index].half_life_s}s` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> {data.notes[0] ?? "No violation has opened and closed yet."}
        </p>
      )}

      {data.episodes.length && withHalfLife.length < data.episodes.length ? (
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> {data.episodes.length - withHalfLife.length} of{" "}
          {data.episodes.length} episodes have no half-life: they closed by jumping straight to coherent rather than
          decaying. Calling that a half-life of the final interval would invent a decay nobody observed.
        </p>
      ) : null}
    </>
  );
}

export default function DiffusionPane({ active }: { active: boolean }) {
  const [view, setView] = useState<"absorption" | "mechanism" | "findings" | "kalshi">("absorption");
  const episodes = useCoherenceRead<CoherenceEpisodes>(
    episodesRoute(),
    active && view === "kalshi",
  );
  // Mechanism reads nothing: its drawing is made of two constants. Findings
  // owns its own read inside `FindingsPane`. So only these two gates live here.
  const absorption = useCoherenceRead<AbsorptionRead>(
    absorptionRoute(),
    active && view === "absorption",
  );

  return (
    <section className="card console-card coh-diffusion" aria-labelledby="coherence-diffusion-heading">
      <PaneHead
        kicker="Diffusion"
        title="How fast information is absorbed"
        id="coherence-diffusion-heading"
        note="two arms, one estimator"
        lede={
          <>
            Both arms measure one thing: how long until the move is finished. Kalshi measures it over a mispricing the
            exchange itself publishes, the announcement arm over news with a public timestamp. If the median lifetime
            is under the round trip, the opportunity was never available.
          </>
        }
      />

      <div className="seg" role="group" aria-label="Diffusion view">
        <button type="button" aria-pressed={view === "absorption"} onClick={() => setView("absorption")}>
          Absorption
        </button>
        <button type="button" aria-pressed={view === "mechanism"} onClick={() => setView("mechanism")}>
          Mechanism
        </button>
        <button type="button" aria-pressed={view === "findings"} onClick={() => setView("findings")}>
          Findings
        </button>
        <button type="button" aria-pressed={view === "kalshi"} onClick={() => setView("kalshi")}>
          Kalshi episodes
        </button>
      </div>

      {view === "kalshi" ? (
        <KalshiEpisodes data={episodes.data} error={episodes.error} />
      ) : (
        <InformationDiffusionPane
          view={view}
          read={absorption.data}
          error={absorption.error}
          active={active}
        />
      )}
    </section>
  );
}
