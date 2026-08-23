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
 * The calendar strip above it is the other half of the claim. Every stated
 * timestamp was checked against the issuer's own release line, not against a
 * secondary calendar, because an event study with the wrong t-zero measures
 * the speed of its own errors.
 */

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
  const { data, error } = useCoherenceRead<FindingsRead>("/api/gateway/diffusion/findings", active);

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

  return (
    <div className="diff-results">
      <div className="coh-status__chips">
        <StateChip
          mark={calendar && calendar.verified === calendar.of ? "✓" : "◌"}
          word="Timestamps verified"
          value={calendar ? `${calendar.verified} of ${calendar.of}` : "not checked"}
          tone={calendar && calendar.verified === calendar.of ? "good" : "muted"}
        />
        <StateChip
          mark="●"
          word="Meetings with a dissent"
          value={calendar ? String(calendar.dissent_meetings) : "—"}
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
          held
            ? "The two rows outside the band are the positive control: a larger rate change moves the price further. The rows inside it are the ones this instrument was built to find, and it did not find them."
            : "Nothing clears the band, including the control — so no row below can be read as an absence rather than a broken measurement."
        }
        missing="A row is drawn only where enough meetings carry both quantities; the count is in the table."
      >
        {data.findings.some((row) => row.t_statistic != null) ? (
          <EffectPlot findings={data.findings} />
        ) : (
          <FigureEmpty reason="No relationship has enough meetings behind it yet." />
        )}
      </Figure>

      <FindingsTable findings={data.findings} />

      {study ? (
        <section className="research-subsection" aria-labelledby="diff-instrument-head">
          <h3 className="research-subhead" id="diff-instrument-head">
            Was the instrument fit to answer?
          </h3>
          <InstrumentTable study={study} gate={gate} />
          <p className="research-footnote">
            <span aria-hidden="true">→</span> Reported from the {study.segment ?? "whole statement"}{" "}
            against the {study.conditioning === "prior" ? "previous statement" : study.conditioning},
            at a latent width of {study.latent_dim}. Of the runs on file, the desk shows the one that
            recovers the known fact best among those that are well conditioned — a rule fixed in
            advance and blind to absorption speed, so re-running cannot walk the headline towards a
            result.{" "}
            {study.verdict_reason
              ? `${study.verdict_reason.charAt(0).toUpperCase()}${study.verdict_reason.slice(1)}.`
              : ""}
          </p>
        </section>
      ) : null}

      <details className="disclosure">
        <summary>Why is the predictor reported as absent rather than dropped?</summary>
        <p>
          A measurement that found nothing is only worthless when nobody can tell it apart from a
          measurement that could not have found anything. The control rows fix that: the same
          pipeline, the same events, the same standardisation, and a relationship it does detect at
          four standard errors. So the empty rows are evidence about the market rather than
          evidence about the code, and deleting them would leave the next reader to spend the same
          weeks rediscovering it.
        </p>
      </details>
    </div>
  );
}
