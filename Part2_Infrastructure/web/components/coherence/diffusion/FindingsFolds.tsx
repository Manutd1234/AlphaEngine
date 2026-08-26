"use client";

/**
 * The two method folds under the Instrument view, as tables.
 *
 * WHAT THIS REPLACED. Two `<details>` on `FindingsPane` of 88 and 134 words of
 * prose, with a third of 85 beneath them — three identical hairlines with no
 * heading between, and summaries in three grammars (a counted noun, an
 * uncounted noun, a question). Both bodies were numbers wearing sentences: the
 * run's id, segment, conditioning, latent width, event count, rank, spread,
 * criterion and verdict were one paragraph; "62 of 62", 18 meetings and 32
 * votes were another. A reader looking for the latent width had to read the
 * paragraph to find it.
 *
 * A TABLE PER FOLD, each summary counting its rows, following `MeetingTable`
 * on this tab and the four folded tables on Proofs. The run table's caption
 * carries the one sentence the third fold existed for — why the predictor is
 * reported as absent rather than dropped — and its claim about the ladder
 * branches on `study.skill_meetings`, because on this deployment the ladder
 * has NOT scored the clock and a fixed sentence saying it had was false.
 *
 * The criterion and the largest measured |t| are parsed from `verdict_reason`,
 * the only place the wire states them. When the sentence does not parse, the
 * two rows read as unstated and the sentence is printed whole beneath the
 * table; nothing is invented from a regex that missed.
 */

import { fmt } from "@/lib/format";
import type { CalendarCheck, DiffusionStudy } from "./types";

/** "the pre-registered criterion was |t| >= 2 on a primary moment; the largest measured is 1.15" */
const REASON = /criterion was (.+?) on a primary moment; the largest measured is ([0-9]+(?:\.[0-9]+)?)/i;

interface Row {
  readonly what: string;
  readonly value: string;
  readonly how: string;
}

function runRows(study: DiffusionStudy): Row[] {
  const parsed = study.verdict_reason?.match(REASON) ?? null;
  return [
    { what: "Run", value: study.study_id, how: "the study id this section reports" },
    {
      what: "Chosen by",
      value: "best recovery of the known fact among the well conditioned",
      how: "a rule fixed in advance, blind to absorption speed, so re-running cannot walk the headline",
    },
    { what: "Segment", value: study.segment ?? "whole statement", how: "the part of each text that was encoded" },
    {
      what: "Conditioning",
      value: study.conditioning === "prior" ? "previous statement" : study.conditioning,
      how: "what each statement is explained against",
    },
    { what: "Latent width", value: String(study.latent_dim), how: "dimensions the encoding may use" },
    { what: "Events scored", value: `${study.events} meetings`, how: "none refused below the information floor" },
    {
      what: "Effective rank",
      value: study.effective_rank != null ? `${fmt(study.effective_rank, 2)} of 10` : "—",
      how: "directions actually carrying; the ladder needs 9",
    },
    {
      what: "Centroid spread",
      value: study.centroid_spread != null ? fmt(study.centroid_spread, 3) : "—",
      how: "how far apart the readings sit; the ladder needs 0.9",
    },
    {
      what: "Criterion",
      value: parsed ? `${parsed[1].replace(">=", "≥")} on a primary moment` : "—",
      how: parsed ? "pre-registered, before any regression was run" : "not stated in a form this table can read",
    },
    {
      what: "Largest measured",
      value: parsed ? `|t| ${parsed[2]}` : "—",
      how: parsed ? "the closest any primary moment came to the criterion" : "not stated in a form this table can read",
    },
    {
      what: "Verdict",
      value: study.verdict ? study.verdict.replace(/_/g, " ") : "—",
      how: "the criterion applied to the largest measured",
    },
    {
      what: "Scored out of sample",
      value: study.skill_meetings > 0 ? `${study.skill_meetings} meetings` : "not scored for this run",
      how: "meetings the fit never saw; both stages of a meeting leave together",
    },
  ];
}

function calendarRows(calendar: CalendarCheck): Row[] {
  return [
    {
      what: "Timestamps verified",
      value: `${calendar.verified} of ${calendar.of}`,
      how: "the issuer's own release line, not a secondary calendar",
    },
    {
      what: "Meetings with a dissent",
      value: String(calendar.dissent_meetings),
      how: "each statement's vote line, not a summary",
    },
    {
      what: "Dissenting votes",
      value: String(calendar.dissent_votes),
      how: "each statement's vote line, not a summary",
    },
  ];
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export default function FindingsFolds({ study, calendar }: {
  study: DiffusionStudy | null;
  calendar: CalendarCheck | null;
}) {
  const run = study ? runRows(study) : [];
  const stamps = calendar?.of ? calendarRows(calendar) : [];
  if (!run.length && !stamps.length) return null;

  return (
    <>
      {study ? (
        <details className="disclosure">
          <summary>{`The run, and what it was held to, ${run.length} rows`}</summary>
          <div className="table-wrap" tabIndex={0}>
            <table className="coh-table table-fixed">
              <caption className="coh-table__caption">
                Reported as absent rather than dropped: the control rows are the same pipeline on a
                relationship it does detect at four standard errors, and{" "}
                {study.skill_meetings > 0
                  ? `the ladder above reports whether the clock is predictable without the text, on `
                    + `${study.skill_meetings} meetings the fit never saw`
                  : "the ladder above would report whether the clock is predictable without the text — "
                    + "on this run it has not been scored, so the null rests on the control alone"}
                {" "}— the target has to have structure before the text can fail to explain it.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-3/12">Setting</th>
                  <th scope="col" className="w-4/12">Value</th>
                  <th scope="col" className="w-5/12">What it means</th>
                </tr>
              </thead>
              <tbody>
                {run.map((row) => (
                  <tr key={row.what}>
                    <th scope="row">{row.what}</th>
                    <td className="coh-table__prose">{row.value}</td>
                    <td className="coh-table__prose muted">{row.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {study.verdict_reason && !REASON.test(study.verdict_reason) ? (
            <p className="muted">{sentence(study.verdict_reason)}.</p>
          ) : null}
        </details>
      ) : null}

      {stamps.length && calendar ? (
        <details className="disclosure">
          <summary>{`Timestamps, checked against the issuer, ${stamps.length} rows`}</summary>
          <div className="table-wrap" tabIndex={0}>
            <table className="coh-table table-fixed">
              <caption className="coh-table__caption">
                {sentence(calendar.how)}. An event study anchored on a wrong t-zero measures the speed
                of its own errors.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="w-3/12">Check</th>
                  <th scope="col" className="w-2/12 num">Result</th>
                  <th scope="col" className="w-7/12">Read from</th>
                </tr>
              </thead>
              <tbody>
                {stamps.map((row) => (
                  <tr key={row.what}>
                    <th scope="row">{row.what}</th>
                    <td className="num">{row.value}</td>
                    <td className="coh-table__prose muted">{row.how}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}
