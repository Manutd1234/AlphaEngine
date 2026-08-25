"use client";

/**
 * Every outcome the solver ranked, admitted or passed over.
 *
 * This was a `<details>` under the plan. On a bucket family the table runs to
 * every market in the family, which is a view of the family rather than a
 * footnote to the plan — and the rows the plan passed over are what explain
 * the rows it took, so folding them away hid half the ranking. The bars above
 * the table draw the same ranking (third 2026-08-24 review: a drawing on
 * every view), passed-over rows kept with a ○ and no bar.
 */

import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import StakeBars from "./StakeBars";
import { StakeTable } from "./StakeView";

export default function FamilyView({ kelly }: { kelly: CoherenceKelly }) {
  return (
    <>
      {/* No heading of its own: the table's caption is the sentence, and the
          switcher button that reaches this view is the label. */}
      {kelly.stakes.length ? (
        <>
          <StakeBars stakes={kelly.stakes} caption="The whole family's ranking, drawn" />
          <StakeTable
            stakes={kelly.stakes}
            caption="In the order the solver ranked it, by measure over price"
          />
        </>
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> The solver ranked no outcome in this family.
        </p>
      )}

      {/* Folded 2026-08-25: `detail` is the solver's own account of the run,
          composed by the gateway and bounded by nothing. It is provenance for
          the ranking above, not a reading of it, and it was the last thing on
          the view — so a reader who scrolled to the bottom met a paragraph of
          machine prose where the conclusion should be. */}
      {kelly.detail ? (
        <details className="disclosure">
          <summary>How the solver reached this ranking</summary>
          <p className="coh-kelly__note">{kelly.detail}</p>
        </details>
      ) : null}
    </>
  );
}
