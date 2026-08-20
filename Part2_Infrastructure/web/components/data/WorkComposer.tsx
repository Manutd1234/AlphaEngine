"use client";

/**
 * The intake composer: the smallest useful record of a new piece of work.
 *
 * Split out of `DataWorkBoard` when that file passed the length ceiling. It
 * holds no state of its own — the draft lives on the board, because the board
 * is what clears it after a submit and what restores focus afterwards — so this
 * is markup over a controlled value.
 *
 * The submit button carries the accent fill, and `accent-budget.test.ts`'s roll
 * call names this file for it: it is the card's one commit, which is the test
 * that budget applies.
 */

import {
  AREA_OPTIONS, KIND_LABEL, type NewItemDraft,
} from "@/components/data/work-board-model";
import {
  DATA_WORK_KINDS,
  DATA_WORK_PRIORITIES,
  type DataWorkKind,
  type DataWorkPriority,
} from "@/lib/data-work-queue";
import type { FormEvent } from "react";

interface WorkComposerProps {
  draft: NewItemDraft;
  onDraftChange: (next: (current: NewItemDraft) => NewItemDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Writes refused on this deployment; the one commit is disabled, not hidden. */
  readOnly: boolean;
}

export default function WorkComposer({
  draft, onDraftChange, onSubmit, readOnly,
}: WorkComposerProps) {
  return (
  <form id="data-workboard-composer" className="data-workboard__composer" onSubmit={onSubmit}>
    <div className="data-workboard__composer-heading">
      <div>
        <span className="page-kicker">New work item</span>
        <strong>Capture the smallest useful intake record</strong>
      </div>
      {/* No "New items enter Intake for triage": the submit button reads
          "Add to Intake" and the Intake column reads "Needs triage". */}
    </div>
    <label className="data-workboard__composer-title">
      <span>Title</span>
      <input
        autoFocus
        value={draft.title}
        onChange={(event) => onDraftChange((current) => ({ ...current, title: event.target.value }))}
        placeholder="What needs attention?"
        maxLength={100}
        required
      />
    </label>
    <label>
      <span>Type</span>
      <select
        value={draft.kind}
        onChange={(event) => onDraftChange((current) => ({
          ...current,
          kind: event.target.value as DataWorkKind,
        }))}
      >
        {DATA_WORK_KINDS.map((itemKind) => (
          <option key={itemKind} value={itemKind}>{KIND_LABEL[itemKind]}</option>
        ))}
      </select>
    </label>
    <label>
      <span>Priority</span>
      <select
        value={draft.priority}
        onChange={(event) => onDraftChange((current) => ({
          ...current,
          priority: event.target.value as DataWorkPriority,
        }))}
      >
        {DATA_WORK_PRIORITIES.map((priority) => (
          <option key={priority} value={priority}>{priority}</option>
        ))}
      </select>
    </label>
    <label>
      <span>Area</span>
      <select
        value={draft.area}
        onChange={(event) => onDraftChange((current) => ({ ...current, area: event.target.value }))}
      >
        {AREA_OPTIONS.map((area) => <option key={area} value={area}>{area}</option>)}
      </select>
    </label>
    <label>
      <span>Owner</span>
      <input
        value={draft.owner}
        onChange={(event) => onDraftChange((current) => ({ ...current, owner: event.target.value }))}
        maxLength={32}
      />
    </label>
    {/* The card's one commit, in the budgeted spelling of primary —
        accent-budget.test.ts's roll call names this file for it. */}
    <button type="submit" className="primary-action w-full" disabled={readOnly}>Add to Intake</button>
  </form>
  );
}
