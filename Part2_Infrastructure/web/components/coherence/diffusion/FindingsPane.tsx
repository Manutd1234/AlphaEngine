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
 *
 * THREE VIEWS SINCE THE SECOND PASS OF 2026-08-24. The dot plot, the findings
 * table and the instrument audit stacked to three screens, and they answer
 * three questions — "what is the shape of the study", "what exactly was
 * measured", "was the pipeline fit to find anything" — so they are a `.seg`
 * now, dot plot first because the section's lede is its reading. The chip row
 * stays above the switcher: all four chips describe the whole study. The
 * calendar note and the absent-rows disclosure moved into the Instrument view,
 * which is where the method lives. One read feeds all three, gated on
 * `active` alone. The seg lives here because this pane is one VIEW of the
 * Diffusion section since the merge of 2026-08-24 — `DiffusionPane` draws the
 * section's one head, which is what `coherence-pane-head.test.ts` holds, and
 * the wrapper that used to give this pane a head of its own is deleted.
 */

import { useState } from "react";

import { findingsRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import Figure, { FigureEmpty, StateChip } from "../Figure";
import ValueStrip from "../ValueStrip";
import EffectPlot from "./EffectPlot";
import FindingsTable from "./FindingsTable";
import InstrumentFit from "./InstrumentFit";
import type { FindingsRead, GateCheck } from "./types";

const GATE_MARK: Record<GateCheck["state"], string> = {
  passed: "✓",
  failed: "✕",
  not_assessable: "◌",
};

export default function FindingsPane({ active }: { active: boolean }) {
  const { data, error } = useCoherenceRead<FindingsRead>(findingsRoute(), active);
  const [view, setView] = useState<"plot" | "table" | "instrument">("plot");

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
        {data.reason ?? "Nothing has been measured yet — not the same as nothing being there."}
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

      {/* Wrapped 2026-08-25: a bare `.seg` could be reached by neither
          the sticky rule nor the wrap rule, both `.coh-bar`-scoped. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Findings view">
          <button type="button" aria-pressed={view === "plot"} onClick={() => setView("plot")}>
            Effect plot
          </button>
          <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>
            Findings table
          </button>
          <button type="button" aria-pressed={view === "instrument"} onClick={() => setView("instrument")}>
            Instrument
          </button>
        </div>
      </div>

      {view === "plot" ? (
      <Figure
        caption="Every relationship measured, against the band a shuffled pairing would reach"
        ariaLabel={`Dot plot of t statistics for ${data.findings.length} measured relationships, ${held} outside the plus or minus two band`}
        reading={
          !measured
            ? null
            : held
              ? "The rows outside the band are the control; Instrument says why the rows inside can be read as absent at all."
              : "Nothing clears the band, the control included — so no row can be read as absence rather than broken measurement."
        }
        missing="A row is drawn only where enough meetings carry both quantities; the counts are in the table."
      >
        {measured ? (
          <EffectPlot findings={data.findings} />
        ) : (
          <FigureEmpty reason="No relationship has enough meetings behind it yet." />
        )}
      </Figure>
      ) : view === "table" ? (
      <>
      <ValueStrip
        caption="How many meetings sit behind each verdict"
        ariaLabel={`Meetings with both quantities for each of ${data.findings.length} relationships`}
        rows={data.findings.map((row) => ({
          label: `${row.name} (${row.stage})`,
          value: row.n,
          text: String(row.n),
          title: `${row.name} (${row.stage}): ${row.n} meetings — ${row.question}`,
        }))}
      />
      <FindingsTable findings={data.findings} />
      </>
      ) : (
      <>
      {/* The heading this branch used to open with — "Was the instrument fit
          to answer?" — restated the switcher button beside it and pushed the
          drawing under it. The words survive as the section's accessible name:
          a screen reader still gets them, a sighted reader gets the figure
          first. */}
      {study ? (
        <section aria-label="Was the instrument fit to answer?">
          <InstrumentFit study={study} gate={gate} />
        </section>
      ) : null}

      {/* THE TWO NOTES THAT USED TO SIT UNDER THE TABLE, FOLDED. Both are
          method rather than result: how this run was picked out of the ones
          that were fitted, and how each stated hour was checked. The second
          was also the fourth telling of "62 of 62" — the chip at the top of
          the section carries it, and a reader who wants the method opens this
          rather than reading past it on every visit. */}
      {study || calendar?.of ? (
        <details className="disclosure">
          <summary>How this run was chosen, and how its timestamps were checked</summary>
          {study ? (
            <p>
              Reported from the {study.segment ?? "whole statement"}{" "}
              against the {study.conditioning === "prior" ? "previous statement" : study.conditioning},
              at latent width {study.latent_dim}; the desk shows whichever run best recovers the known
              fact among the well conditioned — a rule fixed in advance, blind to absorption speed, so
              re-running cannot walk the headline.{" "}
              {study.verdict_reason
                ? `${study.verdict_reason.charAt(0).toUpperCase()}${study.verdict_reason.slice(1)}.`
                : ""}
            </p>
          ) : null}
          {calendar?.of ? (
            <p>
              {calendar.how.charAt(0).toUpperCase()}{calendar.how.slice(1)} — {calendar.verified}{" "}
              of {calendar.of}. The hour is checked against the issuer, because an event study anchored
              on a wrong t-zero measures the speed of its own errors. Its {calendar.dissent_votes}{" "}
              dissenting votes across {calendar.dissent_meetings} meetings come from each statement's
              vote line, not a summary.
            </p>
          ) : null}
        </details>
      ) : null}

      <details className="disclosure">
        <summary>Why report the predictor as absent rather than drop it?</summary>
        <p>
          A null is only worthless when nobody can tell it from a measurement that could not have
          found anything. Two things fix that here: the control rows are the same pipeline on a
          relationship it does detect at four standard errors, and the ladder above reports whether
          the clock is predictable <em>without</em> the text — the target has to have structure
          before the text can fail to explain it. Deleting the empty rows would leave the next
          reader to rediscover them over the same weeks.
        </p>
      </details>
      </>
      )}
    </div>
  );
}
