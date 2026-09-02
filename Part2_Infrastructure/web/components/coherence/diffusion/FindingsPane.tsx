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
 * THE OUT-OF-SAMPLE SCORE IS A WIRE FIELD, NOT A SENTENCE HERE. The headline
 * used to rest on the largest of eight in-sample regressions against a
 * half-life that only existed where the move cleared two sigma — 26 of 62
 * release meetings. `modules/coherence/diffusion/skill.py` replaced that with
 * a residence time defined for every meeting, precision weights instead of the
 * gate, both stages pooled, and leave-one-meeting-out scoring against a
 * baseline that already knows the stage and the rate move. It lands on the
 * wire as `study.skill_*`, PER STUDY. The reporting rule first prefers an
 * admissible run that actually carries that out-of-sample score, then applies
 * its fixed conditioning rule without looking at the answer. The committed
 * production ledger therefore reports the completed 57-meeting run instead of
 * borrowing its score for a different study. If a future deployment has no
 * study, or only older unscored rows, every missing value remains explicit.
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

import { findingsRoute } from "@/lib/coherence/routes";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { viewsFor } from "@/lib/section-views";
import { StateChip } from "../Figure";
import DiffusionViewControl from "./DiffusionViewControl";
import EffectField from "./EffectField";
import EvidenceMatrix from "./EvidenceMatrix";
import FindingsFolds from "./FindingsFolds";
import FindingsTable from "./FindingsTable";
import InstrumentFit from "./InstrumentFit";
import { findingsEvidenceValue, summarizeFindings } from "./findings-summary";
import type { Finding, FindingsRead, GateCheck } from "./types";

const GATE_MARK: Record<GateCheck["state"], string> = {
  passed: "✓",
  failed: "✕",
  not_assessable: "◌",
};

const EMPTY_FINDINGS: Finding[] = [];

export type FindingsView = "plot" | "table" | "instrument";
const VIEWS = viewsFor("diffusion", "findings") as ReadonlyArray<readonly [FindingsView, string]>;

export default function FindingsPane({ active, view, onView }: {
  active: boolean;
  view: FindingsView;
  onView: (next: FindingsView) => void;
}) {
  const { data, error } = useCoherenceRead<FindingsRead>(findingsRoute(), active);
  const read = data?.state === "ok" ? data : null;
  const findings = read?.findings ?? EMPTY_FINDINGS;
  const evidence = summarizeFindings(findings);
  const calendar = read?.calendar ?? null;
  const gate = read?.gate ?? null;
  const study = read?.study ?? null;
  // The wire exposes the storage backend and snapshot observation time, but no
  // dataset-vintage or bootstrap flag. Label exactly what it exposes without
  // promoting the read time into a claim that the historical sample is live.
  const sourceStamp = read
    ? `${read.backend ?? "unreported"} API snapshot observed at ${read.observed_at}`
    : null;
  const studyAbsenceReason = read
    ? "the study has not been built"
    : error && !data
      ? "the study could not be read"
      : !data
        ? "the study has not been read yet"
        : (data.reason ?? `the findings source is ${data.state}`);
  const notice = error && !data
    ? <>The findings could not be read: {error}</>
    : !data
      ? <>Measuring the relationships…</>
      : data.state !== "ok"
        ? <>{data.reason ?? "Nothing has been measured yet — not the same as nothing being there."}</>
        : evidence.planned === 0
          ? <>Zero relationships have been measured; the structures below show what will be assessed, not a result. {sourceStamp}.</>
          : evidence.assessable === 0
            ? <>{evidence.planned} planned relationships have been registered, but none is assessable yet; the connected figure below shows the measurement path, not a result. {sourceStamp}.</>
            : null;
  // "0 of 0" is not a clean bill of health. A desk that has fetched no
  // statement has verified nothing, and a tick beside that would be the exact
  // claim this section exists to avoid making.
  const allVerified = Boolean(calendar && calendar.of > 0 && calendar.verified === calendar.of);

  return (
    <div className="diff-results">
      {notice ? (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> {notice}
        </p>
      ) : null}
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
        <StateChip
          mark={evidence.assessable ? "✓" : "◌"}
          word="Assessable relationships"
          value={findingsEvidenceValue(evidence)}
          tone={evidence.assessable ? "good" : "muted"}
        />
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
        <DiffusionViewControl
          className="seg diff-view-control"
          label="Findings view"
          value={view}
          views={VIEWS}
          onValueChange={onView}
        />
      </div>

      {view === "plot" ? (
        <EffectField findings={findings} />
      ) : view === "table" ? (
      <>
      <EvidenceMatrix findings={findings} />
      {/* FOLDED, following `MeetingTable` on this same tab: the matrix above is
          the view and the table is its audit. Until 2026-08-26 the opener was
          a strip of `row.n` — fourteen bars of three distinct values, the same
          column the table prints as Events — and at 7px cells over 14 rows the
          table was 1,227px, the tallest live-data view on the tab.

          The length gate is not decoration: `FindingsTable` renders a
          `.console-empty` line when there is nothing to show, and folding an
          empty state away would break the house rule that an empty result is
          reported rather than hidden. The 32-word caption survives inside. */}
      {findings.length ? (
        <details className="disclosure">
          <summary>Every relationship measured, with its count, its statistics and its verdict</summary>
          <FindingsTable findings={findings} />
        </details>
      ) : (
        <FindingsTable findings={findings} />
      )}
      </>
      ) : (
      <>
      {/* The heading this branch used to open with — "Was the instrument fit
          to answer?" — restated the switcher button beside it and pushed the
          drawing under it. The words survive as the section's accessible name:
          a screen reader still gets them, a sighted reader gets the figure
          first. */}
      <section aria-label="Was the instrument fit to answer?">
        <InstrumentFit study={study} gate={gate} absenceReason={studyAbsenceReason} />
      </section>

      {/* THE METHOD, FOLDED AS TABLES since 2026-08-26. Two prose folds and a
          third beneath them used to sit here; both bodies were numbers wearing
          sentences, and the third's one genuine sentence is the run table's
          caption now. Each summary names its table; a count moved off the
          header on 2026-08-27, into the caption where it is a measurement
          (14 relationships, 24 meetings) and off the tab entirely where it
          is not (12 settings, 3 fixed checks, 6 requirements already drawn
          above the fold that names them). */}
      <FindingsFolds study={study} calendar={calendar} />
      </>
      )}
    </div>
  );
}
