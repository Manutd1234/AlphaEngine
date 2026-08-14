"use client";

import { FormEvent, useDeferredValue, useMemo, useRef, useState } from "react";

import {
  DEVELOPER_WORK_KINDS,
  DEVELOPER_WORK_PRIORITIES,
  DEVELOPER_WORK_STATUSES,
  filterDeveloperWorkItems,
  moveDeveloperWorkItem,
  nextDeveloperWorkId,
  type DeveloperWorkItem,
  type DeveloperWorkKind,
  type DeveloperWorkPriority,
  type DeveloperWorkStatus,
} from "@/lib/developer-work";

interface DeveloperWorkQueueProps {
  items: DeveloperWorkItem[];
  onItemsChange: (items: DeveloperWorkItem[]) => void;
}

interface WorkDraft {
  kind: DeveloperWorkKind;
  priority: DeveloperWorkPriority;
  title: string;
  summary: string;
  owner: string;
  area: string;
}

const KIND_LABEL: Record<DeveloperWorkKind, string> = {
  feature: "Feature",
  bug: "Bug",
  ticket: "Ticket",
};

const STATUS_META: ReadonlyArray<{
  id: DeveloperWorkStatus;
  label: string;
  description: string;
}> = [
  { id: "triage", label: "Triage", description: "Needs scope" },
  { id: "planned", label: "Planned", description: "Ready to pick up" },
  { id: "progress", label: "In progress", description: "Actively owned" },
  { id: "review", label: "In review", description: "Awaiting evidence" },
  { id: "done", label: "Done", description: "Closed in this session" },
];

const STATUS_LABEL = Object.fromEntries(STATUS_META.map((status) => [status.id, status.label])) as Record<
  DeveloperWorkStatus,
  string
>;

const AREA_OPTIONS = [
  "Developer portal",
  "Web shell",
  "Contracts",
  "Delivery",
  "Gateway",
  "Provider layer",
  "Research engine",
  "Risk engine",
] as const;

const DEFAULT_DRAFT: WorkDraft = {
  kind: "feature",
  priority: "P2",
  title: "",
  summary: "",
  owner: "Unassigned",
  area: "Developer portal",
};

function ageLabel(openedAt: number, now: number): string {
  const hours = Math.max(1, Math.floor((now - openedAt) / 3_600_000));
  if (hours < 24) return `${hours}h open`;
  return `${Math.floor(hours / 24)}d open`;
}

export default function DeveloperWorkQueue({ items, onItemsChange }: DeveloperWorkQueueProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState<DeveloperWorkKind | "all">("all");
  const [status, setStatus] = useState<DeveloperWorkStatus | "all">("all");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<WorkDraft>(DEFAULT_DRAFT);
  const [announcement, setAnnouncement] = useState("");
  const [now] = useState(() => Date.now());
  const newWorkButton = useRef<HTMLButtonElement | null>(null);

  const visibleItems = useMemo(
    () => filterDeveloperWorkItems(items, { query: deferredQuery, kind, status }),
    [deferredQuery, items, kind, status],
  );

  const openItems = items.filter((item) => item.status !== "done");
  const activeItems = items.filter((item) => item.status === "progress");
  const bugs = openItems.filter((item) => item.kind === "bug");
  const awaitingReview = items.filter((item) => item.status === "review");

  const move = (item: DeveloperWorkItem, next: DeveloperWorkStatus) => {
    if (item.status === next) return;
    onItemsChange(moveDeveloperWorkItem(items, item.id, next));
    // The move alone. The session-only caveat is stated once by the pill and
    // defined once by the scope block; repeating it on every move announcement
    // was the same sentence read aloud dozens of times per session.
    setAnnouncement(`${item.id} moved to ${STATUS_LABEL[next]}.`);
    window.requestAnimationFrame(() => document.getElementById(`developer-work-status-${item.id}`)?.focus());
  };

  const submitNewItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    const item: DeveloperWorkItem = {
      id: nextDeveloperWorkId(draft.kind, items),
      kind: draft.kind,
      priority: draft.priority,
      status: "triage",
      title,
      summary: draft.summary.trim() || "Added from the Developer engineering queue for triage.",
      owner: draft.owner.trim() || "Unassigned",
      area: draft.area,
      openedAt: Date.now(),
    };
    onItemsChange([item, ...items]);
    setDraft(DEFAULT_DRAFT);
    setComposerOpen(false);
    setAnnouncement(`${item.id} added to Triage.`);
    window.requestAnimationFrame(() => newWorkButton.current?.focus());
  };

  return (
    <div className="card developer-work">
      <div className="developer-work__heading">
        <div>
          <div className="developer-work__eyebrow">
            <span className="page-kicker">Engineering workflow</span>
            <span className="pill">Mocked · session-only</span>
          </div>
          <h2>Features, bugs &amp; current tickets</h2>
          {/* The session-only caveat lives in the pill above and the scope
              block below — twice is labelling, four times was noise. */}
          <p className="sub">
            Capture a change, assign it, and advance it through review with explicit controls.
          </p>
        </div>
        <div className="developer-work__stats" aria-label="Engineering work summary">
          <div><span>Open</span><strong className="num">{openItems.length}</strong></div>
          <div className={bugs.length ? "is-warn" : ""}><span>Bugs</span><strong className="num">{bugs.length}</strong></div>
          <div><span>Active</span><strong className="num">{activeItems.length}</strong></div>
          <div><span>Review</span><strong className="num">{awaitingReview.length}</strong></div>
        </div>
      </div>

      <div className="developer-work__scope">
        <strong>What “fix” means here:</strong> moving a bug records workflow state in this browser
        session. An authenticated issue integration and a reviewed source-control change are still
        required to modify the repository or close a real ticket.
      </div>

      {/* One action with a three-way parameter, not three actions. Add feature,
          Report bug and New ticket all opened this composer and differed only in
          which value they pre-selected in its Type select — the control a reader
          passes on the way to the title field, and the only one of the two that
          could still change the kind once the form was open. The heading below
          reads the same field, so the form still says which kind is being
          captured. */}
      <div className="developer-work__actions" aria-label="Create engineering work">
        {/* Default voice, like its DataWorkBoard twin: this opens a composer,
            it commits nothing — the accent stays on "Add to triage". The
            aria wiring matches the twin too; it was missing here. */}
        <button
          ref={newWorkButton}
          type="button"
          aria-expanded={composerOpen}
          aria-controls="developer-work-composer"
          onClick={() => setComposerOpen(true)}
        >
          New work
        </button>
      </div>

      {composerOpen && (
        <form id="developer-work-composer" className="developer-work__composer" onSubmit={submitNewItem}>
          <div className="developer-work__composer-heading">
            <div>
              <span className="page-kicker">New {KIND_LABEL[draft.kind].toLocaleLowerCase()}</span>
              <strong>Capture a reviewable unit of work</strong>
            </div>
            <button type="button" onClick={() => setComposerOpen(false)} aria-label="Close new work form">×</button>
          </div>
          <label className="developer-work__title-field">
            <span>Title</span>
            <input
              autoFocus
              required
              maxLength={110}
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="What needs to change?"
            />
          </label>
          <label className="developer-work__summary-field">
            <span>Context / acceptance note</span>
            <textarea
              rows={2}
              maxLength={240}
              value={draft.summary}
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
              placeholder="Why it matters and how a reviewer will know it is done"
            />
          </label>
          <label>
            <span>Type</span>
            <select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as DeveloperWorkKind }))}>
              {DEVELOPER_WORK_KINDS.map((workKind) => <option key={workKind} value={workKind}>{KIND_LABEL[workKind]}</option>)}
            </select>
          </label>
          <label>
            <span>Priority</span>
            <select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value as DeveloperWorkPriority }))}>
              {DEVELOPER_WORK_PRIORITIES.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </label>
          <label>
            <span>Area</span>
            <select value={draft.area} onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))}>
              {AREA_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            <span>Owner</span>
            <input value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))} maxLength={40} />
          </label>
          <button type="submit" className="primary-action">Add to triage</button>
        </form>
      )}

      <div className="developer-work__toolbar">
        <label className="developer-work__search">
          <span>Search work</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ID, title, owner or area…"
          />
        </label>
        <div className="seg developer-work__kinds" role="group" aria-label="Filter engineering work by type">
          <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>All</button>
          {DEVELOPER_WORK_KINDS.map((workKind) => (
            <button key={workKind} type="button" aria-pressed={kind === workKind} onClick={() => setKind(workKind)}>
              {KIND_LABEL[workKind]}
            </button>
          ))}
        </div>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as DeveloperWorkStatus | "all")}>
            <option value="all">All statuses</option>
            {STATUS_META.map((itemStatus) => <option key={itemStatus.id} value={itemStatus.id}>{itemStatus.label}</option>)}
          </select>
        </label>
      </div>

      <div className="developer-work__table-wrap">
        <table className="developer-work__table">
          <caption className="sr-only">Session engineering work queue</caption>
          <thead>
            <tr>
              <th>Work</th>
              <th>Area / owner</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item) => (
              <tr key={item.id} className={`is-${item.priority.toLocaleLowerCase()}`}>
                <td>
                  <div className="developer-work__badges">
                    <span className={`developer-work-kind is-${item.kind}`}>{KIND_LABEL[item.kind]}</span>
                    <span className="developer-work-priority">{item.priority}</span>
                    <code>{item.id}</code>
                  </div>
                  <strong>{item.title}</strong>
                  <p>{item.summary}</p>
                </td>
                <td>
                  <strong>{item.area}</strong>
                  <span>{item.owner}</span>
                  <small>{ageLabel(item.openedAt, now)}</small>
                </td>
                {/* The row's only status control, and it always was the only
                    complete one. The next-status button in the column beside
                    this one reached exactly one of the five transitions this
                    select offers; a reader who wanted any other move — or who
                    had just made the wrong one — came back here regardless. */}
                <td>
                  <label>
                    <span className="sr-only">Status for {item.id}</span>
                    <select
                      id={`developer-work-status-${item.id}`}
                      aria-label={`Status for ${item.id}: ${item.title}`}
                      value={item.status}
                      onChange={(event) => move(item, event.target.value as DeveloperWorkStatus)}
                    >
                      {DEVELOPER_WORK_STATUSES.map((workStatus) => (
                        <option key={workStatus} value={workStatus}>{STATUS_LABEL[workStatus]}</option>
                      ))}
                    </select>
                  </label>
                  <small>{STATUS_META.find((candidate) => candidate.id === item.status)?.description}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!visibleItems.length && (
          <div className="developer-work__empty">
            <strong>No matching work</strong>
            <span>Clear a filter or create a new feature, bug, or ticket.</span>
          </div>
        )}
      </div>

      {/* No reset control. This queue is state in one browser tab and says so
          two paragraphs above; reloading rebuilds it from the same fixture the
          reset button called, so the control existed only to undo the demo. */}
      <div className="developer-work__footer">
        <span aria-live="polite">{announcement || `${visibleItems.length} items shown.`}</span>
      </div>
    </div>
  );
}
