"use client";

/**
 * The path a verdict took, drawn as the chain of decisions it actually is.
 *
 * WHAT WAS MISSING. The Verdict view opens on `MarginAxis` — where the
 * programme's optimum sits against the line it is judged on — and on the common
 * coherent answer that was the whole view, because the four money rows describe
 * a portfolio that does not exist and `ValueStrip` correctly declines to draw
 * them. So a reader met one axis and a verdict, with nothing saying how the two
 * were connected: which engine answered, how many constraints it could test,
 * what it optimised, and where the fees came off.
 *
 * Every one of those is on the certificate already. This draws them, and it
 * fetches nothing — the same rule `diffusion-figures.test.ts` pins for the
 * announcement arm, because a figure that quietly needs a new route is a schema
 * change wearing a chart's clothes.
 *
 * IT REUSES `FormationDiagram` RATHER THAN DRAWING A SECOND CHAIN. That
 * component is the Settlement view's pipeline — boxes, arrows, a mark per box,
 * a value and a note — and this is the same shape with different contents. The
 * one thing it hard-coded was the line under the chain, which said the contract
 * settles on the last box; that is now a prop, defaulted to what it always said.
 * A second chain component would have been a second set of box geometry to keep
 * in step with the diagram ladder.
 *
 * THE TWO ENGINES ARE ALTERNATIVES, NOT STAGES, and getting that wrong is the
 * easy error here. `kernel/dutchbook.py` imports SciPy through a seam: with it,
 * the linear programme answers and reports `t*`; without it, the caller falls
 * back to the closed-form checks, which solve no programme and so have no
 * optimum at all. Drawing "closed form → programme" as two boxes in sequence
 * would assert a pipeline that never runs. So the engine is ONE box naming
 * which of the two answered, and the optimum box says ◌ — could not ask — when
 * the closed form is the one that did.
 *
 * WHAT THE MARK MEANS ON THIS CHAIN. `●` the stage answered, `▲` the stage is
 * where the failure was found, `◌` the stage could not be asked. That is the
 * status vocabulary the rest of the tab uses, so it survives forced-colors and
 * a reader who cannot separate the two hues — the word and the value beside it
 * carry the same fact.
 */

import type { CoherenceCertificate } from "@/lib/coherence/types";
import { toMicros } from "@/lib/coherence/payoff-by-state";
import { MEANINGFUL_EDGE } from "@/lib/coherence/thresholds";
import FormationDiagram, { type FormationStage } from "./FormationDiagram";

/** The wire's engine names, as a reader should meet them. */
const ENGINE_WORD: Record<string, string> = {
  highs: "Linear programme",
  closed_form: "Closed-form checks",
};

const DECISION_LINE_MICROS = Math.round(MEANINGFUL_EDGE * 1_000_000);

function marginCrossesDecisionLine(margin: string | null): boolean | null {
  const marginMicros = toMicros(margin);
  return marginMicros == null ? null : marginMicros > DECISION_LINE_MICROS;
}

function stagesOf(certificate: CoherenceCertificate): FormationStage[] {
  const solved = certificate.engine === "highs";
  const programmeIncoherent = certificate.verdict === "incoherent";
  // `priced_out` is intentionally allowed beside a coherent fee-aware LP
  // verdict: the raw quotes still fail the probability test, but fees remove
  // the executable edge. The final box must carry the price conclusion rather
  // than silently inheriting the programme conclusion from the box before it.
  const priceIncoherent = programmeIncoherent || Boolean(certificate.priced_out);
  const untestable = certificate.verdict === "untestable";
  const crossesDecisionLine = marginCrossesDecisionLine(certificate.margin);
  const total = certificate.rows_tested + certificate.rows_untestable;
  const verdictWord = untestable
    ? "Untestable"
    : priceIncoherent
      ? certificate.priced_out ? "Incoherent, priced out" : "Incoherent"
      : "Coherent";

  return [
    {
      title: "Quote set",
      value: `${total} constraints`,
      note: certificate.rows_untestable
        ? `${certificate.rows_tested} tested; ${certificate.rows_untestable} skipped because a leg was unquoted`
        : `all ${certificate.rows_tested} were testable`,
      holds: certificate.rows_tested > 0 ? true : null,
    },
    {
      title: "Feasibility test",
      value: ENGINE_WORD[certificate.engine] ?? certificate.engine,
      note: `scope ${certificate.scope}, legging tier ${certificate.tier}`,
      holds: untestable ? null : true,
    },
    {
      title: "Decision line",
      value: certificate.margin == null ? "No LP optimum" : `${certificate.margin} vs 0.0001`,
      note: solved
        ? "t* must stay at or below the exchange-precision line"
        : "closed-form checks answer without solving for t*",
      // The mark belongs to the number printed in this box, not to the final
      // verdict. A solved LP can cross the line and still finish untestable if
      // no whole-hundredth position can hold the continuous optimum.
      holds: crossesDecisionLine == null ? null : !crossesDecisionLine,
    },
    {
      title: "Verdict",
      value: verdictWord,
      note: certificate.priced_out
        ? `the quote violation remains, but fees reduce its net edge to ${certificate.net_edge ?? "no executable edge"}`
        : programmeIncoherent
          ? `the edge survives fees at ${certificate.net_edge ?? "an unreported amount"}`
          : untestable
            ? crossesDecisionLine
              ? "the continuous optimum crossed the line, but no whole-hundredth position could hold it"
              : "the test did not reach a decision from the available inputs"
            : "the quoted prices admit a probability measure",
      holds: untestable ? null : priceIncoherent ? false : true,
    },
  ];
}

export default function CheckLadder({ certificate }: { certificate: CoherenceCertificate }) {
  const stages = stagesOf(certificate);
  const crossesDecisionLine = marginCrossesDecisionLine(certificate.margin);

  return (
    <FormationDiagram
      stages={stages}
      caption="Quoted prices → feasibility test → decision line → verdict"
      keyLine="Read left to right: each box hands one decision to the next."
      reading={
        certificate.priced_out
          ? "The quote test failed, but fees kept the programme inside its trade line; the final box keeps those two conclusions separate."
          : certificate.verdict === "incoherent"
          ? "The decision line was crossed; the last box separates the mathematical violation from whether fees leave a trade."
          : certificate.verdict === "untestable"
            ? crossesDecisionLine
              ? "The continuous optimum crossed the line, but the chain ends untestable because no whole-hundredth position could hold it."
              : "The chain stops where the available inputs could no longer support a decision."
            : "The chain completed without crossing the line, so these quotes are coherent."
      }
      missing={
        certificate.engine === "highs"
          ? null
          : "No optimum on this chain: the closed-form checks solve no programme, so there is no t* to report."
      }
      notes={[
        // The gateway's own account of the verdict. It used to be a paragraph
        // above the figures, where on the ordinary answer it restated the
        // margin axis in the gateway's words; it belongs to the figure whose
        // subject is how the verdict was reached.
        certificate.because ? `The gateway says: ${certificate.because}` : "",
        `Scope ${certificate.scope}. ${certificate.tier_note}`,
      ].filter(Boolean)}
    />
  );
}
