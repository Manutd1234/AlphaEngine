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
import FormationDiagram, { type FormationStage } from "./FormationDiagram";

/** The wire's engine names, as a reader should meet them. */
const ENGINE_WORD: Record<string, string> = {
  highs: "Linear programme",
  closed_form: "Closed-form checks",
};

function stagesOf(certificate: CoherenceCertificate): FormationStage[] {
  const solved = certificate.engine === "highs";
  const incoherent = certificate.verdict === "incoherent";
  const untestable = certificate.verdict === "untestable";
  const total = certificate.rows_tested + certificate.rows_untestable;

  return [
    {
      title: "Constraints",
      value: `${certificate.rows_tested} of ${total}`,
      // Not "N tested": the row's own label says tested. What a reader cannot
      // get from the count is that the remainder was SKIPPED rather than passed.
      note: certificate.rows_untestable
        ? `${certificate.rows_untestable} skipped, a leg unquoted`
        : "every state quoted on both sides",
      holds: certificate.rows_tested > 0 ? true : null,
    },
    {
      title: "Engine",
      value: ENGINE_WORD[certificate.engine] ?? certificate.engine,
      note: `scope ${certificate.scope}, legging tier ${certificate.tier}`,
      holds: untestable ? null : true,
    },
    {
      title: "Optimum t*",
      value: certificate.margin ?? "—",
      note: solved
        ? "the most any basket guarantees itself"
        : "no programme was solved, so there is none",
      // ◌ rather than ▲ when the closed form answered: an absent optimum here
      // is a stage that could not be asked, not a stage that failed.
      holds: certificate.margin == null ? null : incoherent ? false : true,
    },
    {
      title: "After fees",
      value: certificate.net_edge ?? "—",
      note: certificate.priced_out
        ? "a violation the fees remove"
        : incoherent
          ? "the edge survives all three components"
          : "no portfolio to charge",
      holds: incoherent && !certificate.priced_out ? false : true,
    },
  ];
}

export default function CheckLadder({ certificate }: { certificate: CoherenceCertificate }) {
  const stages = stagesOf(certificate);

  return (
    <FormationDiagram
      stages={stages}
      caption="How this verdict was reached, one box per decision"
      keyLine="Each box is a decision, not a reading; the verdict is what the last one leaves."
      reading={
        certificate.verdict === "incoherent"
          ? "The failure is the box marked ▲; everything right of it is what the fees did to it."
          : "Every box answered, and none found a portfolio worth putting on."
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
