"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import {
  DATA_WORK_KINDS,
  DATA_WORK_PRIORITIES,
  DATA_WORK_STATUSES,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
  nextDataWorkId,
  type DataWorkItem,
  type DataWorkKind,
  type DataWorkPriority,
  type DataWorkSort,
  type DataWorkStatus,
} from "@/lib/data-work-queue";

interface DataWorkBoardProps {
  items: DataWorkItem[];
  onItemsChange: (items: DataWorkItem[]) => void;
}

interface NewItemDraft {
  kind: DataWorkKind;
  priority: DataWorkPriority;
  title: string;
  owner: string;
  area: string;
}

const KIND_LABEL: Record<DataWorkKind, string> = {
  request: "Request",
  ticket: "Ticket",
  bug: "Bug",
};

/** Exported so the PageHead's Active WIP metric states the same n/limit this
 *  board enforces, rather than a bare count beside a second bare count here. */
export const PROGRESS_WIP_LIMIT = 3;

const STATUS_META: ReadonlyArray<{
  id: DataWorkStatus;
  label: string;
  description: string;
  wipLimit: number | null;
}> = [
  { id: "intake", label: "Intake", description: "Needs triage", wipLimit: null },
  { id: "ready", label: "Ready", description: "Scoped and prioritised", wipLimit: null },
  { id: "progress", label: "In progress", description: "Actively owned", wipLimit: PROGRESS_WIP_LIMIT },
  { id: "resolved", label: "Resolved", description: "Verified complete", wipLimit: null },
];

const STATUS_LABEL = Object.fromEntries(STATUS_META.map((status) => [status.id, status.label])) as Record<
  DataWorkStatus,
  string
>;

const DEFAULT_DRAFT: NewItemDraft = {
  kind: "request",
  priority: "P2",
  title: "",
  owner: "Unassigned",
  area: "Pipeline",
};

const AREA_OPTIONS = [
  "Pipeline",
  "Market data",
  "Data contracts",
  "Normalisation",
  "Lineage",
  "Capacity",
  "Observability",
] as const;

const SLA_HOURS: Record<DataWorkPriority, number> = {
  P0: 2,
  P1: 8,
  P2: 24,
  P3: 72,
};

function formatAge(openedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - openedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
}

function slaState(
  item: DataWorkItem,
  now: number,
): { label: string; tone: "good" | "warn" | "bad" } | null {
  if (item.status === "resolved" || item.slaDueAt === null) return null;
  const remaining = Math.ceil((item.slaDueAt - now) / 60_000);
  if (remaining < 0) {
    const overdue = Math.abs(remaining);
    return { label: `SLA breached by ${overdue < 60 ? `${overdue}m` : `${Math.floor(overdue / 60)}h`}`, tone: "bad" };
  }
  if (remaining < 60) return { label: `SLA due in ${remaining}m`, tone: "warn" };
  return { label: `SLA due in ${Math.floor(remaining / 60)}h`, tone: remaining <= 120 ? "warn" : "good" };
}

export default function DataWorkBoard({ items, onItemsChange }: DataWorkBoardProps) {
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [kind, setKind] = useState<DataWorkKind | "all">("all");
  const [sort, setSort] = useState<DataWorkSort>("priority");
  const [composerOpen, setComposerOpen] = useState(false);
  const [draft, setDraft] = useState<NewItemDraft>(DEFAULT_DRAFT);
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  /** The card that just arrived somewhere, so it can animate in exactly once. */
  const [justMoved, setJustMoved] = useState<string | null>(null);
  const addItemButton = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const visible = useMemo(
    () => filterAndSortDataWorkItems(items, { query: deferredQuery, kind, sort }),
    [items, deferredQuery, kind, sort],
  );

  /**
   * The arrival flag is normally cleared by the card's own `animationend`. A
   * card the filter removes never fires one, so the flag would outlive the move
   * and the card would animate in a second time whenever the filter brought it
   * back — announcing an arrival that happened several minutes and several
   * keystrokes ago. Search and type are filtered here; status is not, so a move
   * on its own never trips this.
   */
  useEffect(() => {
    if (justMoved !== null && !visible.some((item) => item.id === justMoved)) {
      setJustMoved(null);
    }
  }, [justMoved, visible]);

  const openItems = items.filter((item) => item.status !== "resolved");
  const slaRisk = openItems.filter((item) => {
    if (item.slaDueAt === null) return false;
    return item.slaDueAt - now <= 120 * 60_000;
  });
  const progressCount = items.filter((item) => item.status === "progress").length;
  const progressLimit = STATUS_META.find((status) => status.id === "progress")?.wipLimit ?? 3;

  const move = (item: DataWorkItem, status: DataWorkStatus) => {
    if (item.status === status) return;
    const nextItems = moveDataWorkItem(items, item.id, status);
    onItemsChange(nextItems);
    const nextProgressCount = nextItems.filter((candidate) => candidate.status === "progress").length;
    const wipWarning = status === "progress" && nextProgressCount > progressLimit
      ? ` Warning: In progress is above its work-in-progress limit of ${progressLimit}.`
      : "";
    setAnnouncement(`${item.id} moved to ${STATUS_LABEL[status]}.${wipWarning}`);
    setJustMoved(item.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`data-work-status-${item.id}`)?.focus();
    });
  };

  const submitNewItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    const id = nextDataWorkId(draft.kind, items);
    const createdAt = Date.now();
    const item: DataWorkItem = {
      id,
      kind: draft.kind,
      priority: draft.priority,
      status: "intake",
      title,
      summary: "Added from the Data operations work queue for triage.",
      owner: draft.owner.trim() || "Unassigned",
      area: draft.area,
      openedAt: createdAt,
      slaDueAt: createdAt + SLA_HOURS[draft.priority] * 3_600_000,
    };
    onItemsChange([item, ...items]);
    setNow(createdAt);
    setDraft(DEFAULT_DRAFT);
    setComposerOpen(false);
    setAnnouncement(`${id} added to Intake.`);
    setJustMoved(id);
    window.requestAnimationFrame(() => addItemButton.current?.focus());
  };

  const clearFilters = () => {
    setQuery("");
    setKind("all");
    setSort("priority");
  };

  return (
    <div className="card data-workboard">
      <div className="data-workboard__heading">
        <div>
          <div className="data-workboard__eyebrow">
            <span className="page-kicker">Operations queue</span>
            <span className="pill">Mocked · session-only</span>
          </div>
          <h2>Sample requests, tickets &amp; bugs</h2>
          <p className="sub">
            Triage by impact, protect active work with a visible limit, and move every item with a
            keyboard-accessible status control.
          </p>
        </div>
        {/* One tile, not four: Open, P0/P1 and Active WIP already stand in
            the PageHead directly above this card, computed from the same
            items — the deck was restating its own header. SLA risk stays
            here because it is the one figure that needs this board's live
            clock (the 30s `now` tick) to stay honest. */}
        <div className="data-workboard__stats" aria-label="Work queue summary">
          <div className={slaRisk.length ? "is-warn" : ""}>
            <span>SLA risk</span>
            <strong className="num">{slaRisk.length}</strong>
          </div>
        </div>
      </div>

      <p className="data-workboard__scope">
        Demonstration data only. Edits live in browser memory for the current app session and are
        neither persisted nor connected to a production ticket system. Operational evidence is kept
        in the Overview, Quality, Lineage and Providers sections.
      </p>

      <div className="data-workboard__toolbar">
        <label className="data-workboard__search">
          <span className="sr-only">Search the work queue</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ID, title, owner or area…"
          />
        </label>

        <div className="seg data-workboard__kinds" role="group" aria-label="Filter by work type">
          <button type="button" aria-pressed={kind === "all"} onClick={() => setKind("all")}>
            All <span>{items.length}</span>
          </button>
          {DATA_WORK_KINDS.map((itemKind) => (
            <button
              key={itemKind}
              type="button"
              aria-pressed={kind === itemKind}
              onClick={() => setKind(itemKind)}
            >
              {KIND_LABEL[itemKind]}s <span>{items.filter((item) => item.kind === itemKind).length}</span>
            </button>
          ))}
        </div>

        <label className="data-workboard__sort">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as DataWorkSort)}>
            <option value="priority">Priority, then age</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>

        {/* Default voice: this opens and closes the composer, it commits
            nothing. The accent belongs to "Add to Intake" alone — while the
            form was open, two accent-filled buttons sat on one card and one
            of them meant "Close". */}
        <button
          ref={addItemButton}
          type="button"
          aria-expanded={composerOpen}
          aria-controls="data-workboard-composer"
          onClick={() => setComposerOpen((open) => !open)}
        >
          {composerOpen ? "Close form" : "+ Add item"}
        </button>
      </div>

      {composerOpen && (
        <form id="data-workboard-composer" className="data-workboard__composer" onSubmit={submitNewItem}>
          <div className="data-workboard__composer-heading">
            <div>
              <span className="page-kicker">New work item</span>
              <strong>Capture the smallest useful intake record</strong>
            </div>
            <small>New items enter Intake for triage.</small>
          </div>
          <label className="data-workboard__composer-title">
            <span>Title</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
              placeholder="What needs attention?"
              maxLength={100}
              required
            />
          </label>
          <label>
            <span>Type</span>
            <select
              value={draft.kind}
              onChange={(event) => setDraft((current) => ({
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
              onChange={(event) => setDraft((current) => ({
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
              onChange={(event) => setDraft((current) => ({ ...current, area: event.target.value }))}
            >
              {AREA_OPTIONS.map((area) => <option key={area} value={area}>{area}</option>)}
            </select>
          </label>
          <label>
            <span>Owner</span>
            <input
              value={draft.owner}
              onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}
              maxLength={32}
            />
          </label>
          {/* The card's one commit, in the budgeted spelling of primary —
              accent-budget.test.ts's roll call names this file for it. */}
          <button type="submit" className="primary-action w-full">Add to Intake</button>
        </form>
      )}

      <div className="data-workboard__board" aria-label="Data engineering work board">
        {STATUS_META.map((status) => {
          const columnItems = visible.filter((item) => item.status === status.id);
          const actualCount = items.filter((item) => item.status === status.id).length;
          const overLimit = status.wipLimit !== null && actualCount > status.wipLimit;
          return (
            <section
              key={status.id}
              className={`data-work-column${overLimit ? " is-over-limit" : ""}`}
              aria-labelledby={`data-work-column-${status.id}`}
            >
              <header className="data-work-column__heading">
                <div>
                  <h3 id={`data-work-column-${status.id}`}>{status.label}</h3>
                  <small>{status.description}</small>
                </div>
                <span className="data-work-column__count">
                  {actualCount}{status.wipLimit === null ? "" : ` / ${status.wipLimit}`}
                </span>
              </header>
              {overLimit && (
                <p className="data-work-column__warning" role="status">
                  WIP limit exceeded — finish or unblock active work before pulling more.
                </p>
              )}
              <ol className="data-work-column__list">
                {columnItems.map((item) => {
                  const sla = slaState(item, now);
                  return (
                    <li key={item.id}>
                      <article
                        className={`data-work-card is-${item.priority.toLocaleLowerCase()}`
                          + (justMoved === item.id ? " is-just-moved" : "")}
                        onAnimationEnd={(event) => {
                          // Named, because the live badge's halo also ends here
                          // under reduced motion, where the global clamp turns
                          // its loop into a single 1ms iteration.
                          if (event.nativeEvent.animationName !== "rise-in") return;
                          setJustMoved((current) => (current === item.id ? null : current));
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
                        <span className="data-work-card__id num">{item.id}</span>
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
                        <label className="data-work-card__status">
                          <span>Status</span>
                          <select
                            id={`data-work-status-${item.id}`}
                            value={item.status}
                            onChange={(event) => move(item, event.target.value as DataWorkStatus)}
                            aria-label={`Status for ${item.id}`}
                          >
                            {DATA_WORK_STATUSES.map((itemStatus) => (
                              <option key={itemStatus} value={itemStatus}>{STATUS_LABEL[itemStatus]}</option>
                            ))}
                          </select>
                        </label>
                      </article>
                    </li>
                  );
                })}
              </ol>
              {columnItems.length === 0 && (
                <p className="data-work-column__empty">
                  {visible.length === items.length ? "No work in this stage." : "No matching work."}
                </p>
              )}
            </section>
          );
        })}
      </div>

      <div className="data-workboard__footer">
        <span>{visible.length} of {items.length} items shown</span>
        {/* "Reset sample queue" stood here and restored the seeded items. It
            demonstrated the mock rather than the workflow: the badge and the
            scope paragraph above already say the queue is session-only, the
            section head carries a Persistence metric reading None, and the
            dashboard reseeds the same sample on every reload anyway — so this
            was a control that looked like it acted on a ticket system and did
            what closing the tab does. */}
        <div>
          {(query || kind !== "all" || sort !== "priority") && (
            <button type="button" onClick={clearFilters}>Clear filters</button>
          )}
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    </div>
  );
}
