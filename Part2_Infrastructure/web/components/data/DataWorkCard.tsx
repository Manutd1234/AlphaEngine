"use client";

/**
 * One work item, as a card.
 *
 * Split out of `DataWorkBoard` when that file passed the length ceiling. It
 * renders and reports: the status `<select>` is the accessible mechanism for
 * moving a card between columns — there is no drag, deliberately, because a
 * drag-only board is unusable by keyboard — and every change is handed back to
 * the board, which owns the list.
 *
 * The arrival animation clears itself on `animationend`, matched BY NAME: the
 * live badge's halo also ends here under reduced motion, where the global clamp
 * turns its loop into a single 1ms iteration.
 *
 * Nothing is invented for a missing value. An item with no SLA clock — resolved,
 * or never given a due date — prints no timing verdict rather than a neutral one.
 */

import { useState } from "react";

import { KIND_LABEL, STATUS_LABEL, formatAge, slaState } from "@/components/data/work-board-model";
import { DATA_WORK_STATUSES, type DataWorkItem, type DataWorkStatus } from "@/lib/data-work-queue";

interface DataWorkCardProps {
  item: DataWorkItem;
  /** The clock the age and the SLA verdict are measured against. */
  now: number;
  /** True while this card is the one that just arrived somewhere. */
  justMoved: boolean;
  onArrivalEnd: () => void;
  onStatusChange: (status: DataWorkStatus) => void;
  /** Remove this card for good. Called once the reader has confirmed on the card. */
  onDelete: () => void;
  readOnly: boolean;
}

export default function DataWorkCard({
  item, now, justMoved, onArrivalEnd, onStatusChange, onDelete, readOnly,
}: DataWorkCardProps) {
  const sla = slaState(item, now);
  /** The delete is two presses on the card itself, so a slip on a 30px
      button next to the status select does not remove a ticket. */
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <article
      className={`data-work-card is-${item.priority.toLocaleLowerCase()}`
        + (justMoved ? " is-just-moved" : "")}
      onAnimationEnd={(event) => {
        // Named, because the live badge's halo also ends here
        // under reduced motion, where the global clamp turns
        // its loop into a single 1ms iteration.
        if (event.nativeEvent.animationName !== "rise-in") return;
        onArrivalEnd();
      }}
    >
      <div className="data-work-card__topline">
        <span className={`data-work-kind is-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
        {item.status === "progress" && (
          <span className="data-work-live">
            <i aria-hidden />
            Active
          </span>
        )}
        <span className={`data-work-priority is-${item.priority.toLocaleLowerCase()}`}>
          {item.priority}
        </span>
      </div>
      <span className="data-work-card__id num">
        {item.id}
        {item.createdBy === "seed" && <small className="muted"> ‹sample›</small>}
      </span>
      <h4>{item.title}</h4>
      <p>{item.summary}</p>
      <dl className="data-work-card__meta">
        <div><dt>Owner</dt><dd>{item.owner}</dd></div>
        <div><dt>Area</dt><dd>{item.area}</dd></div>
      </dl>
      <div className="data-work-card__timing">
        <span>{formatAge(item.openedAt, now)}</span>
        {sla && <strong className={`is-${sla.tone}`}>{sla.label}</strong>}
        {!sla && item.status === "resolved" && <strong className="is-good">SLA complete</strong>}
      </div>
      <div className="data-work-card__foot">
        <label className="data-work-card__status">
          <span>Status</span>
          <select
            id={`data-work-status-${item.id}`}
            value={item.status}
            onChange={(event) => onStatusChange(event.target.value as DataWorkStatus)}
            aria-label={`Status for ${item.id}`}
            disabled={readOnly}
          >
            {DATA_WORK_STATUSES.map((itemStatus) => (
              <option key={itemStatus} value={itemStatus}>{STATUS_LABEL[itemStatus]}</option>
            ))}
          </select>
        </label>
        {confirmingDelete ? (
          <span className="data-work-card__confirm" role="group" aria-label={`Confirm deleting ${item.id}`}>
            <button
              type="button"
              className="is-disruptive"
              onClick={() => { setConfirmingDelete(false); onDelete(); }}
              autoFocus
            >
              Delete {item.id}
            </button>
            <button type="button" onClick={() => setConfirmingDelete(false)}>Keep</button>
          </span>
        ) : (
          <button
            type="button"
            className="data-work-card__delete"
            onClick={() => setConfirmingDelete(true)}
            disabled={readOnly}
            aria-label={`Delete ${item.id}`}
            title={readOnly ? "Writes are refused on this deployment." : `Delete ${item.id}`}
          >
            Delete
          </button>
        )}
      </div>
    </article>
  );
}
