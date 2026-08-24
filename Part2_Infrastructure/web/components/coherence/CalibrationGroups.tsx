"use client";

/**
 * The views inside one Scorecard group, and the caveat that stands over three.
 *
 * Scorecard holds two questions that a fold of 2026-08-24 put on one control:
 * were the prices right ONCE SETTLED — of the contracts priced near a dime, how
 * many paid — and how far the live quotes sit from coherence OVER TIME. Both
 * answer "were these prices right", which is why they are one section; five flat
 * segments asked a reader to work out that Score and Index families were not
 * peers.
 *
 * Two groups say it on the control:
 *
 *   Once settled   Score, Bands, Corpus        one `calibration` read
 *   Over time      Index series, Index families one `index` read
 *
 * THE GROUPS ARE THE READ SEAM, as everywhere on this tab: each is exactly one
 * gateway call, so a reader scoring the settled corpus never pays for the tape
 * and pressing between two views of one group re-arms nothing.
 *
 * THE ENGINE BANNER MOVED HERE, AND THAT IS THE POINT OF THE SLICE. The settled
 * half turns on one field a reader will not think to check: `engine` says WHEN
 * the price was read. `tape` reads a price quoted an hour before close and is a
 * forecast test; `final_trade` reads the LAST TRADED price, moments before
 * settlement with the answer largely in plain sight, and on the live sample it
 * returns a Brier of 0.00010533 and a skill of 0.99935238 — which reads as a
 * spectacular forecaster and is nothing of the sort.
 *
 * That caveat invalidates every settled view and says NOTHING about the index,
 * which is a distance between live quotes scored against nothing. While the seg
 * was flat the banner had to stand above all five, and `CalibrationPane`'s
 * header recorded the discomfort: it sat "below the switcher that also offers
 * two it does not touch". Grouping resolves it — the banner belongs to the
 * settled group and is drawn inside it.
 *
 * REFUSED, still: hoisting it over the group control for both. It would put
 * "these are not forecasts" over a figure that makes no forecast claim. And
 * REFUSED, still: dropping it to a note per cell, which survives a reader who
 * reads only the number they came for but loses the SHAPE of the claim — it
 * invalidates the whole half, not two of six rows.
 *
 * `.coh-views` is the wrapper for the reason `CertificateGroups.tsx` sets out.
 */

import { useState } from "react";

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import CalibrationBands from "./CalibrationBands";
import CalibrationCorpus from "./CalibrationCorpus";
import CalibrationGauge from "./CalibrationGauge";
import CalibrationTrend from "./CalibrationTrend";
import { EngineBanner, ScoreView, horizonText, scoreFacts } from "./CalibrationScore";
import { StateChip } from "./Figure";
import IndexPane from "./IndexPane";

export type CalibrationGroup = "settled" | "time";

type SettledView = "score" | "bands" | "corpus";
type IndexView = "series" | "families" | "trend";
type CalibrationView = SettledView | IndexView;

/** Which views each group holds, in the order the reader meets them. */
export const GROUP_VIEWS: Record<CalibrationGroup, ReadonlyArray<[CalibrationView, string]>> = {
  settled: [["score", "Score"], ["bands", "Bands"], ["corpus", "Corpus"]],
  time: [
    ["trend", "Score trend"],
    ["series", "Index series"],
    ["families", "Index families"],
  ],
};

export default function CalibrationGroups({ group, active, data, error }: {
  group: CalibrationGroup;
  active: boolean;
  /** The settled corpus. Null on the index group, which does not read it. */
  data: CoherenceCalibration | null;
  error: string | null;
}) {
  const views = GROUP_VIEWS[group];
  const [view, setView] = useState<CalibrationView>(views[0][0]);

  return (
    <div className="coh-views">
      <div className="seg" role="group" aria-label="Calibration view">
        {views.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
      </div>

      {group === "time" ? (
        // Two reads under one group, each gated on the views that draw it — the
        // section's own discipline, one level down. The group says "over time";
        // which tape answers that is a property of the view.
        // The branch IS the gate here, and the compiler proves it: inside the
        // else, `view` cannot be "trend", so `active && view !== "trend"` is a
        // conjunction TypeScript reports as always true. An always-true guard
        // reads like a gate and defends nothing, which is worse than none.
        view === "trend" ? (
          <CalibrationTrend active={active} />
        ) : (
          <IndexPane active={active} view={view === "series" ? "series" : "families"} />
        )
      ) : (
        <SettledViews data={data} error={error} view={view as SettledView} />
      )}
    </div>
  );
}

/**
 * The three settled views, with the four different absences told apart.
 *
 * A read still in flight looks like reading, a failed read names the failure, a
 * gateway that answered "nothing has settled" says so in its own words, and only
 * then does a number appear. Collapsing any pair of those into one line is how
 * "we do not know" starts reading as "it is fine".
 */
function SettledViews({ data, error, view }: {
  data: CoherenceCalibration | null;
  error: string | null;
  view: SettledView;
}) {
  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The settled corpus could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Scoring the settled markets…</p>;
  if (data.state !== "available") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {data.detail || "Nothing has settled yet, so there is nothing to score."}
      </p>
    );
  }

  return (
    <>
      {/* The one chip no figure, note or heading below already says. Settled
          markets, bands quoted and the engine each repeated a neighbour. */}
      <div className="coh-status__chips">
        <StateChip
          mark={data.thin ? "▲" : "●"}
          word={data.thin ? "Thin sample" : "Not flagged thin"}
          value={data.thin ? "too few to conclude from" : null}
          tone={data.thin ? "warn" : "muted"}
        />
      </div>

      <EngineBanner data={data} />

      {view === "score" ? (
        <>
          {/* The verdict first, then the six figures it is drawn from. The gauge
              refuses to call a convergence score or a thin corpus a pass, which
              is the argument the banner above makes in prose. */}
          <CalibrationGauge data={data} />
          <ScoreView data={data} facts={scoreFacts(data)} />
        </>
      ) : view === "bands" ? (
        <CalibrationBands
          data={data}
          horizonNote={
            data.engine === "final_trade"
              ? "last traded prices, so the x axis is what the exchange had already converged on"
              : horizonText(data.median_horizon_s)
          }
        />
      ) : (
        <CalibrationCorpus data={data} />
      )}
    </>
  );
}
