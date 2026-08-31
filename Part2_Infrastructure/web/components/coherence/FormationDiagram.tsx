"use client";

/**
 * How a settlement index is made, drawn rather than described.
 *
 * The Formation view answered four questions in a four-row table of prose, and
 * a table is the wrong shape for this one: what it is really describing is a
 * PIPELINE — station readings become a quality-controlled set, the set becomes
 * one published minute, and sixty of those minutes become the number a contract
 * settles against. Each stage can fail, and where it fails decides what the
 * failure means. A reader who cannot see the chain cannot see that the window
 * average at the end is four transformations away from a thermometer.
 *
 * So the diagram IS the argument, and the figures ride on the stages they
 * belong to: how many stations reported, how many minutes this read reproduced
 * from the rule, how many the venue never published, and how long the window
 * is. Where a stage cannot be measured it says so on the stage rather than in a
 * footnote — a chain with an unmeasured link is a different claim from a chain
 * with a broken one.
 *
 * Nothing here carries meaning in colour alone. A stage that holds is marked ●
 * and one that does not is ▲, the same vocabulary the chips use, so the diagram
 * survives forced-colors and a reader who cannot separate the two hues.
 */

import { ArrowRight } from "lucide-react";

import Figure from "./Figure";
import { SettlementAssembly } from "./SettlementInstruments";

export interface FormationStage {
  /** The short heading on the box. HTML wrapping keeps longer live names intact. */
  title: string;
  /** The measurement this stage carries, or null when this read has none. */
  value: string | null;
  /** One clause under the figure. Not a sentence: the caption is the sentence. */
  note: string;
  /** False when this read found the stage broken, null when it could not ask. */
  holds: boolean | null;
}

/** What the boxes mean for this diagram's first caller. See `keyLine`. */
const SETTLEMENT_KEY =
  "Each box is a transformation, not a reading; the contract settles on the last one.";

function mark(holds: boolean | null): string {
  if (holds === null) return "◌";
  return holds ? "●" : "▲";
}

function status(holds: boolean | null): string {
  if (holds === null) return "not evaluated";
  return holds ? "holds" : "flagged";
}

export default function FormationDiagram({
  stages,
  caption,
  reading,
  missing,
  notes,
  keyLine = SETTLEMENT_KEY,
  mode = "pipeline",
}: {
  stages: FormationStage[];
  caption: string;
  reading?: string | null;
  missing?: string | null;
  /** Passed through to `Figure`, which folds it and counts it in the summary. */
  notes?: readonly string[] | null;
  /**
   * The line under the chain, when the chain is not a settlement index.
   *
   * Defaulted rather than required, because this diagram was written for ONE
   * caller and the sentence it hard-coded is that caller's. A second caller
   * arrived on 2026-08-25 — `CheckLadder`, the path a coherence verdict takes
   * — and its boxes are decisions rather than transformations, so the settled
   * sentence would have been false under it. A default keeps the original
   * caller unchanged and makes the new one say what its own chain is.
   */
  keyLine?: string;
  /** Settlement uses the tactile assembly; other proof pipelines retain the compact chain. */
  mode?: "pipeline" | "assembly";
}) {
  if (mode === "assembly") {
    return <SettlementAssembly stages={stages} caption={caption} reading={reading} missing={missing} />;
  }
  const ariaLabel = stages
    .map((stage) => `${stage.title}: ${stage.value ?? "not measured in this read"}, ${stage.note}`)
    .join(". Then ");

  return (
    <Figure
      caption={caption}
      reading={reading}
      missing={missing}
      notes={notes}
      ariaLabel={ariaLabel}
      readout={<span className="num">{`${stages.length} stages; ${stages.filter((stage) => stage.holds === false).length} marked ▲`}</span>}
      reserveInteractionRow={false}
    >
      <div className="coh-decision-flow">
        <ol className="coh-decision-flow__rail">
          {stages.map((stage, index) => {
            const state = stage.holds === null ? "unavailable" : stage.holds ? "holds" : "flagged";
            return (
              <li className="coh-decision-flow__step" key={`${index}-${stage.title}`}>
                <article className="coh-decision-flow__card" data-state={state}>
                  <header>
                    <span className="coh-decision-flow__index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="coh-decision-flow__status">
                      <span aria-hidden="true">{mark(stage.holds)}</span> {status(stage.holds)}
                    </span>
                  </header>
                  <h4>{stage.title}</h4>
                  <strong className="coh-decision-flow__value">{stage.value ?? "Not measured"}</strong>
                  <p>{stage.note}</p>
                </article>
                {index < stages.length - 1 ? (
                  <span className="coh-decision-flow__arrow" aria-hidden="true">
                    <ArrowRight />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <p className="coh-decision-flow__key">{keyLine}</p>
      </div>
    </Figure>
  );
}
