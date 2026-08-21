"use client";

import { FormEvent, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import DataWorkCard from "@/components/data/DataWorkCard";
import WorkComposer from "@/components/data/WorkComposer";
import {
  AREA_OPTIONS,
  DEFAULT_DRAFT,
  KIND_LABEL,
  SLA_HOURS,
  STATUS_LABEL,
  STATUS_META,
  type DataWorkMutation,
  type NewItemDraft,
} from "@/components/data/work-board-model";
import {
  DATA_WORK_KINDS,
  DATA_WORK_PRIORITIES,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
  nextDataWorkId,
  type DataWorkItem,
  type DataWorkKind,
  type DataWorkPriority,
  type DataWorkSource,
  type DataWorkSort,
  type DataWorkStatus,
} from "@/lib/data-work-queue";

/**
 * The columns, the SLA clock and the card are their own files now — see
 * `work-board-model.ts` and `DataWorkCard.tsx`. What stays here is the board:
 * the filters, the composer, the WIP accounting, and the one place a move is
 * announced and reported back to the workspace that persists it.
 */
export type { DataWorkMutation };

interface DataWorkBoardProps {
  items: DataWorkItem[];
  onItemsChange: (items: DataWorkItem[]) => void;
  /**
   * Where `items` came from. Absent means the workspace has not wired
   * persistence (a test render); the board then behaves as it always did.
   */
  source?: DataWorkSource;
  /**
   * Called after the optimistic local change, so the workspace can PATCH or
   * POST it to the gateway and reconcile — the board never fetches itself.
   */
  onMutation?: (mutation: DataWorkMutation) => void;
  /** Number of local edits the workspace is holding because the gateway was unreachable. */
  pendingWrites?: number;
  /** True when writes are refused on this deployment (operator guard locked). */
  readOnly?: boolean;
  /** Why they are refused, for the note beside the disabled controls. */
  readOnlyReason?: string;
}

export default function DataWorkBoard({
  items,
  onItemsChange,
  source,
  onMutation,
  pendingWrites = 0,
  readOnly = false,
  readOnlyReason,
}: DataWorkBoardProps) {
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
    onMutation?.({ type: "move", item, status });
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
      version: 1,
      createdBy: "desk",
    };
    onItemsChange([item, ...items]);
    onMutation?.({ type: "create", item });
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
            {/* The pill is the honest one-line source. Persisted on the gateway
                is the steady state; local hold is a disclosed degradation, never
                a silent one; and a render with no source wired says so. */}
            <span className="pill">
              {source?.kind === "gateway"
                ? `Persisted on the gateway, ${source.count} ${source.count === 1 ? "item" : "items"}`
                : source?.kind === "local"
                  ? `Gateway unreachable — edits held locally${pendingWrites ? ` (${pendingWrites} pending)` : ""}`
                  : "Loading the persisted queue"}
            </span>
          </div>
          <h2>Requests, tickets &amp; bugs</h2>
          {/* No sub here: it narrated the sort select, each column's own n/limit
              and the Status select on every card, all of which state themselves. */}
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
        {source?.kind === "gateway" ? (
          <>
            This is a queue, not a ticket system.
            {source.seeded > 0
              ? ` ${source.seeded} of these ${source.seeded === 1 ? "is a seeded sample row" : "are seeded sample rows"}, marked ‹sample›.`
              : ""}
          </>
        ) : source?.kind === "local" ? (
          <>
            The gateway could not be reached ({source.reason}), so this is the last list loaded — or
            the seeded sample if none has — and edits are held in this browser until it answers.
            Nothing here is lost silently, and nothing here is confirmed either.
          </>
        ) : (
          <>The persisted queue arrives with the first gateway read.</>
        )}
        {readOnly && readOnlyReason ? ` ${readOnlyReason}` : ""}
      </p>

      {/* Provenance, not a measurement, so it folds. The pill and the
          Persistence tile above already print the gateway, SQLite and the
          audit log; what moves here is only HOW a write is recorded once it
          gets there. The scope line above keeps every absence and every
          degradation on screen — the local-hold sentence, the seeded-row
          count and the read-only reason are all outside this fold. */}
      {source?.kind === "gateway" && (
        <details className="disclosure">
          <summary>How an edit is recorded</summary>
          <p className="sub">
            Every create and status change is versioned in the gateway&apos;s work-item table;
            a stale edit is refused rather than overwritten.
          </p>
        </details>
      )}

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
        <WorkComposer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submitNewItem}
          readOnly={readOnly}
        />
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
                {columnItems.map((item) => (
                    <li key={item.id}>
                      <DataWorkCard
                        item={item}
                        now={now}
                        justMoved={justMoved === item.id}
                        onArrivalEnd={() =>
                          setJustMoved((current) => (current === item.id ? null : current))}
                        onStatusChange={(status) => move(item, status)}
                        readOnly={readOnly}
                      />
                    </li>
                ))}
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
            demonstrated the mock rather than the workflow; now that the queue
            is the gateway's, a reset would be a destructive write dressed as a
            convenience, and there is still no such control. */}
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
