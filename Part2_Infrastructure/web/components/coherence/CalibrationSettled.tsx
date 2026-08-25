"use client";

/**
 * The three settled views, with the four different absences told apart.
 *
 * A read still in flight looks like reading, a failed read names the failure, a
 * gateway that answered "nothing has settled" says so in its own words, and only
 * then does a number appear. Collapsing any pair of those into one line is how
 * "we do not know" starts reading as "it is fine".
 *
 * Its own file since 2026-08-25, when the Scorecard split in two. It was the
 * `settled` half of `CalibrationGroups`, which existed to hold two groups under
 * one section; there is no second level to hold any more — "once settled" and
 * "over time" are two sections now — so what is left is the three views of one
 * read, and they belong beside the read rather than inside a switcher that has
 * nothing left to switch.
 */

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import CalibrationBands from "./CalibrationBands";
import CalibrationCorpus from "./CalibrationCorpus";
import CalibrationGauge from "./CalibrationGauge";
import { EngineBanner, ScoreView, horizonText, scoreFacts } from "./CalibrationScore";
import { StateChip } from "./Figure";

export type SettledView = "score" | "bands" | "corpus";

/**
 * The three settled views, with the four different absences told apart.
 *
 * A read still in flight looks like reading, a failed read names the failure, a
 * gateway that answered "nothing has settled" says so in its own words, and only
 * then does a number appear. Collapsing any pair of those into one line is how
 * "we do not know" starts reading as "it is fine".
 */
export default function CalibrationSettled({ data, error, view }: {
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
