"use client";

/**
 * What the study found, including — especially — what it did not.
 *
 * The instrument this section builds measures the resolution at which one text
 * explains another. The honest report on it is that it does not predict how
 * fast a rate decision reaches the price, and that is the headline of this
 * pane rather than a footnote at the bottom of it.
 *
 * A null is only worth reading beside a positive control, because "we found
 * nothing" and "this pipeline cannot find anything" produce identical tables.
 * So the control sits in the same table, measured the same way, and it is the
 * two rows that clear the band: a larger rate change does produce a larger
 * price response, over sixty-one meetings, at t of about four. The pipeline
 * works. The predictor does not.
 *
 * THE HEADLINE IS NOW SCORED OUT OF SAMPLE, and the null survived the move.
 * It used to rest on the largest of eight in-sample regressions against a
 * half-life that only existed where the move cleared two sigma — 26 of 62
 * release meetings. `modules/coherence/diffusion/skill.py` replaced that with
 * a residence time defined for every meeting, precision weights instead of the
 * gate, both stages pooled, and leave-one-meeting-out scoring against a
 * baseline that already knows the stage and the rate move. On 57 meetings the
 * clock is predictable — out-of-sample R² +0.14, and the press conference runs
 * about seven minutes slower than the statement — and the text subtracts from
 * that. So the finding is no longer "nothing here predicts anything": it is
 * that this clock has structure and the statement's spectrum is not part of
 * it, which is a sharper claim and a falsifiable one.
 *
 * The calendar strip above it is the other half of the claim. Every stated
 * timestamp was checked against the issuer's own release line, not against a
 * secondary calendar, because an event study with the wrong t-zero measures
 * the speed of its own errors.
 */

import { findingsRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "../Figure";
import EffectPlot from "./EffectPlot";
import FindingsTable from "./FindingsTable";
import InstrumentTable from "./InstrumentTable";
import type { FindingsRead, GateCheck } from "./types";

const GATE_MARK: Record<GateCheck["state"], string> = {
  passed: "✓",
  failed: "✕",
  not_assessable: "◌",
};

export default function FindingsPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<FindingsRead>(findingsRoute(), active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The findings could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Measuring the relationships…</p>;
  if (data.state !== "ok") {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span>{" "}
        {data.reason ?? "Nothing has been measured yet. That is not the same as nothing being there."}
      </p>
    );
  }

  const held = data.findings.filter((row) => row.verdict === "holds").length;
  const calendar = data.calendar;
  const gate = data.gate;
  const study = data.study;
  // "0 of 0" is not a clean bill of health. A desk that has fetched no
  // statement has verified nothing, and a tick beside that would be the exact
  // claim this section exists to avoid making.
  const allVerified = Boolean(calendar && calendar.of > 0 && calendar.verified === calendar.of);
  const measured = data.findings.some((row) => row.t_statistic != null);

  return (
    <div className="diff-results">
      <div className="coh-status__chips">
        <StateChip
          mark={allVerified ? "✓" : "◌"}
          word="Timestamps verified"
          value={calendar?.of ? `${calendar.verified} of ${calendar.of}` : "nothing fetched yet"}
          tone={allVerified ? "good" : "muted"}
        />
        <StateChip
          mark="●"
          word="Meetings with a dissent"
          value={calendar?.of ? String(calendar.dissent_meetings) : "—"}
          tone="muted"
        />
        <StateChip mark={held ? "✓" : "◌"} word="Relationships that hold"
                   value={`${held} of ${data.findings.length}`} tone={held ? "good" : "muted"} />
        <StateChip
          mark={gate ? GATE_MARK[gate.state] : "◌"}
          word="Representation gate"
          value={
            gate?.r_squared != null
              ? `${gate.state}, R² ${gate.r_squared >= 0 ? "+" : ""}${gate.r_squared.toFixed(2)}`
              : "not run"
          }
          tone={gate?.state === "passed" ? "good" : gate?.state === "failed" ? "warn" : "muted"}
        />
      </div>

      <Figure
        caption="Every relationship measured, against the band a shuffled pairing would reach"
        ariaLabel={`Dot plot of t statistics for ${data.findings.length} measured relationships, ${held} outside the plus or minus two band`}
        reading={
          !measured
            ? null
            : held
              ? "The rows outside the band are the positive control; the fold below says why the rows inside it can be read as absent at all."
              : "Nothing clears the band, including the control — so no row below can be read as an absence rather than a broken measurement."
        }
        missing="A row is drawn only where enough meetings carry both quantities; the count is in the table."
      >
        {measured ? (
          <EffectPlot findings={data.findings} />
        ) : (
          <FigureEmpty reason="No relationship has enough meetings behind it yet." />
        )}
      </Figure>

      <FindingsTable findings={data.findings} />

      {study ? (
        <section aria-labelledby="diff-instrument-head">
          <h4 id="diff-instrument-head">Was the instrument fit to answer?</h4>
          <InstrumentTable study={study} gate={gate} />
          <p className="coh-event__note">
            <span aria-hidden="true">→</span> Reported from the {study.segment ?? "whole statement"}{" "}
            against the {study.conditioning === "prior" ? "previous statement" : study.conditioning},
            at latent width {study.latent_dim}. The desk shows whichever run on file best recovers the
            known fact among the well conditioned — a rule fixed in advance, blind to absorption
            speed, so re-running cannot walk the headline towards a result.{" "}
            {study.verdict_reason
              ? `${study.verdict_reason.charAt(0).toUpperCase()}${study.verdict_reason.slice(1)}.`
              : ""}
          </p>
        </section>
      ) : null}

      {calendar?.of ? (
        <p className="coh-event__note">
          <span aria-hidden="true">{allVerified ? "✓" : "◌"}</span>{" "}
          {calendar.how.charAt(0).toUpperCase()}{calendar.how.slice(1)} — {calendar.verified}{" "}
          of {calendar.of}. The hour is checked against the issuer rather than against a second
          calendar, because an event study anchored on a wrong t-zero measures the speed of its own
          errors. Its {calendar.dissent_votes} dissenting votes across {calendar.dissent_meetings}{" "}
          meetings come from the vote line of each statement, not from a summary of it.
        </p>
      ) : null}

      <details className="disclosure">
        <summary>Why is the predictor reported as absent rather than dropped?</summary>
        <p>
          A measurement that found nothing is only worthless when nobody can tell it apart from a
          measurement that could not have found anything. Two things fix that here. The control
          rows are the same pipeline, the same events and the same standardisation, on a
          relationship it does detect at four standard errors. And the instrument table reports
          how well the absorption clock is predicted <em>without</em> the text at all — from the
          stage and the size of the rate move — so a reader can see the target has structure before
          reading that the text does not explain it. Deleting the empty rows would leave the next
          reader to spend the same weeks rediscovering them.
        </p>
      </details>
    </div>
  );
}
