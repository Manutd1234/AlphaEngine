"use client";

/**
 * Every outcome the solver ranked, admitted or passed over.
 *
 * This was a `<details>` under the plan. On a bucket family the table runs to
 * every market in the family, which is a view of the family rather than a
 * footnote to the plan — and the rows the plan passed over are what explain
 * the rows it took, so folding them away hid half the ranking.
 */

import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import { StakeTable } from "./StakeView";

export default function FamilyView({ kelly }: { kelly: CoherenceKelly }) {
  return (
    <>
      <h4>Every outcome considered, admitted or passed over</h4>

      {kelly.stakes.length ? (
        <StakeTable
          stakes={kelly.stakes}
          caption="The whole family, in the order the solver ranked it by measure over price"
        />
      ) : (
        <p className="console-empty">
          <span aria-hidden="true">◌</span> The solver ranked no outcome in this family, so there is nothing to list.
        </p>
      )}

      <p className="coh-kelly__note">{kelly.detail}</p>
    </>
  );
}
