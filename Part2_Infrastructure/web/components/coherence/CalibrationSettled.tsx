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
import BrierCalibrationSurface from "./BrierCalibrationSurface";
import CalibrationBands from "./CalibrationBands";
import CalibrationCorpus from "./CalibrationCorpus";
import CalibrationGauge from "./CalibrationGauge";
import {
  ScoreDecompositionView,
  ScoreMeasuresView,
  ScoreOverview,
  ScoreComponentsView,
  scoreFacts,
} from "./CalibrationScore";
import { StateChip } from "./Figure";
import SectionVerdict from "./SectionVerdict";

export type SettledView = "score" | "decomposition" | "components" | "measures" | "reliability" | "bands" | "corpus";

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
      {/* Silence is the compact healthy state. The count remains in Measures;
          only a thin sample changes how every score below may be read, so only
          that warning earns a row above the active view. */}
      {data.thin ? (
        <SectionVerdict>
          <StateChip mark="▲" word="Thin sample" value="too few to conclude from" tone="warn" />
        </SectionVerdict>
      ) : null}

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
          <ScoreOverview facts={scoreFacts(data)} />
        </>
      ) : view === "decomposition" ? (
        <ScoreDecompositionView data={data} />
      ) : view === "components" ? (
        <ScoreComponentsView data={data} />
      ) : view === "measures" ? (
        <ScoreMeasuresView facts={scoreFacts(data)} />
      ) : view === "reliability" ? (
        <BrierCalibrationSurface data={data} error={null} />
      ) : view === "bands" ? (
        <CalibrationBands data={data} />
      ) : (
        <CalibrationCorpus data={data} />
      )}
    </>
  );
}
