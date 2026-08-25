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
import { ScoreView, horizonText, scoreFacts } from "./CalibrationScore";
import HorizonAxis from "./HorizonAxis";
import { StateChip } from "./Figure";
import SectionVerdict from "./SectionVerdict";

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
      <SectionVerdict pending={<><span aria-hidden="true">✕</span> The settled corpus could not be read: {error}</>} />
    );
  }
  if (!data) return <SectionVerdict pending="Scoring the settled markets…" />;
  if (data.state !== "available") {
    return (
      <SectionVerdict
        pending={
          <>
            <span aria-hidden="true">◌</span>{" "}
            {data.detail || "Nothing has settled yet, so there is nothing to score."}
          </>
        }
      />
    );
  }

  return (
    <>
      {/* The chips no figure, note or heading below already says. "Settled
          markets" and "bands quoted" each repeated a neighbour and stayed out;
          what a reader cannot get elsewhere in one glance is whether the sample
          is too thin to conclude from, and what the corpus scored. */}
      <SectionVerdict>
        <StateChip
          mark={data.thin ? "▲" : "●"}
          word={data.thin ? "Thin sample" : "Not flagged thin"}
          value={data.thin ? "too few to conclude from" : null}
          tone={data.thin ? "warn" : "muted"}
        />
        <StateChip mark="◇" word="Settled markets scored" value={String(data.count)} tone="muted" />
      </SectionVerdict>

      {view === "score" ? (
        <>
          {/* TWO FIGURES AND A TABLE, where there were five figures and a table.
              The gauge is the verdict — it refuses to call a convergence score
              or a thin corpus a pass — and the decomposition is what the
              headline number is made of. `HorizonAxis` moved to Bands on
              2026-08-26 and the six-row strip left: the first is a caveat about
              WHICH PRICES were scored, which is the question the reliability
              bands are read against, and the second drew the table below it. */}
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
