"use client";

/**
 * Cross-origin event investigation with a bounded, cursor-aware stream.
 *
 * Server dispatch events and browser wire events remain explicitly tagged. A
 * selectable master list keeps the timeline scannable while the detail pane
 * exposes every structured field without flattening it into an unreadable row.
 *
 * ONE CURSOR PER SERVER INSTANCE. The event ring is process-local and the
 * deployment is serverless, so consecutive polls routinely answer from
 * different instances with different sequence spaces. This used to rewind to
 * zero and count a "timeline discontinuity" each time — on Vercel, within a
 * minute of opening the tab, for a fact about the hosting rather than a hole
 * in the log. The cursor is a map keyed by instance now: a poll sends the
 * cursor of the instance it expects, and an answer from another is re-asked
 * at once with that instance's own rather than ingested against the wrong
 * one. Lines merge by timestamp under keys that carry the instance id, and
 * the notice is reserved for a ring that advanced past this client's cursor.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { eventsSince } from "@/lib/observability";
import { usePolling } from "@/lib/use-polling";
import { useWorkspaceEntity } from "@/lib/use-workspace-entity";
import TraceTimeline, { type Line } from "./TraceTimeline";
import type { EventsResponse, TraceEvent } from "./types";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LINES = 800;
const TRACE_PAGE_SIZE = 40;
const TIMELINE_LABEL = "Timeline";

export interface TraceFilterRequest {
  id: number;
  query: string;
  label: string;
}

interface TraceConsoleProps {
  pollMs: number;
  /** Hidden tab panels stay mounted; inactive traces retain state without polling. */
  active: boolean;
  /** A service-row drilldown can request the same query repeatedly via its id. */
  filterRequest?: TraceFilterRequest | null;
}

export default function TraceConsole({ pollMs, active, filterRequest }: TraceConsoleProps) {
  const selectedTrace = useWorkspaceEntity("trace");
  const [lines, setLines] = useState<Line[]>([]);
  const [minLevel, setMinLevel] = useState<Level>("debug");
  const [filter, setFilter] = useState("");
  const [filterContext, setFilterContext] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [gaps, setGaps] = useState(0);
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(false);
  /** Null follows the newest page; a number pins an operator-selected page. */
  const [timelinePageIndex, setTimelinePageIndex] = useState<number | null>(null);
  /** Per-instance server cursors: instance id → the last seq read from its ring. */
  const serverCursors = useRef<Map<string, number>>(new Map());
  const browserCursor = useRef(0);
  const instance = useRef<string | null>(null);
  const inFlight = useRef(false);
  const viewport = useRef<HTMLOListElement | null>(null);

  const pull = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // Local events remain available even when the server is unreachable.
      const local = eventsSince(browserCursor.current, 200);
      if (local.length) browserCursor.current = local[local.length - 1].seq;

      let remote: TraceEvent[] = [];
      let instanceId = instance.current ?? "unknown";
      try {
        // Two attempts at most: the first with the cursor of the instance we
        // expect, the second with the cursor of the one that actually answered.
        // A third instance answering the second attempt is left for the next
        // tick — its cursor is still in the map, so nothing is lost by waiting.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const expected = instance.current;
          const since = expected === null ? 0 : (serverCursors.current.get(expected) ?? 0);
          const response = await fetch(`/api/system/events?since=${since}&limit=250`, { cache: "no-store" });
          if (!response.ok) {
            setConnected(false);
            break;
          }
          const body = (await response.json()) as EventsResponse;
          instanceId = body.instance ?? "unknown";
          instance.current = instanceId;
          setConnected(true);
          if (expected !== null && expected !== instanceId) {
            // Sequence spaces are instance-local: this page was cut with
            // another instance's cursor. Ask again with this one's.
            continue;
          }
          remote = body.events ?? [];
          const latest = remote.length ? remote[remote.length - 1].seq : body.cursor?.latest;
          if (latest !== undefined) serverCursors.current.set(instanceId, latest);
          // The ring advanced past this client's cursor: lines this instance
          // held are gone before they were read. That is a real hole.
          if (body.dropped) setGaps((count) => count + 1);
          break;
        }
      } catch {
        setConnected(false);
      }

      const fresh: Line[] = [
        ...local.map((event) => ({ ...event, key: `browser:${event.seq}` })),
        ...remote.map((event) => ({ ...event, key: `server:${instanceId}:${event.seq}` })),
      ];
      if (!fresh.length) return;

      setLines((current) => {
        const seen = new Set(current.map((line) => line.key));
        const added = fresh.filter((line) => !seen.has(line.key));
        if (!added.length) return current;
        const merged = [...current, ...added].sort((a, b) => a.ts - b.ts);
        return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    if (!filterRequest) return;
    setFilter(filterRequest.query);
    setFilterContext(filterRequest.label);
    setMinLevel("debug");
    setSelectedKey(null);
    setTimelinePageIndex(null);
    setFollow(true);
  }, [filterRequest]);

  useEffect(() => {
    if (!selectedTrace) return;
    setFilter(selectedTrace.value);
    setFilterContext(`Correlation ${selectedTrace.value}`);
    setMinLevel("debug");
    setSelectedKey(null);
    setTimelinePageIndex(null);
    setFollow(true);
  }, [selectedTrace]);

  useEffect(() => {
    if (!active || paused) return;
    void pull();
  }, [active, paused, pull]);

  usePolling({
    tick: pull,
    intervalMs: pollMs ?? 0,
    maxBackoffMs: 300_000,
    enabled: active && !paused && Boolean(pollMs),
  });

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter((line) => {
      if (LEVEL_RANK[line.level] < LEVEL_RANK[minLevel]) return false;
      if (!needle) return true;
      return (
        line.message.toLowerCase().includes(needle)
        || line.source.toLowerCase().includes(needle)
        || line.origin.toLowerCase().includes(needle)
        || Object.entries(line.fields ?? {}).some(([key, value]) => (
          key.toLowerCase().includes(needle)
          || String(value).toLowerCase().includes(needle)
        ))
      );
    });
  }, [lines, minLevel, filter]);

  const pageCount = Math.max(1, Math.ceil(visible.length / TRACE_PAGE_SIZE));
  const activePage = timelinePageIndex === null
    ? pageCount - 1
    : Math.min(timelinePageIndex, pageCount - 1);
  const pageStart = activePage * TRACE_PAGE_SIZE;
  const pagedVisible = useMemo(
    () => visible.slice(pageStart, pageStart + TRACE_PAGE_SIZE),
    [visible, pageStart],
  );

  useEffect(() => {
    if (!follow) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [pagedVisible, follow]);

  const selected = useMemo(() => {
    const explicit = selectedKey ? pagedVisible.find((line) => line.key === selectedKey) : null;
    return explicit ?? pagedVisible[pagedVisible.length - 1] ?? null;
  }, [selectedKey, pagedVisible]);

  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setFollow(activePage === pageCount - 1 && atBottom);
  };

  const setTimelinePage = (nextPage: number) => {
    const bounded = Math.max(0, Math.min(nextPage, pageCount - 1));
    const isLatest = bounded === pageCount - 1;
    setTimelinePageIndex(isLatest ? null : bounded);
    setFollow(isLatest);
    setSelectedKey(null);
    const node = viewport.current;
    if (node) node.scrollTop = 0;
  };

  const clearFilter = () => {
    setFilter("");
    setFilterContext(null);
    setSelectedKey(null);
    setTimelinePageIndex(null);
    setFollow(true);
  };

  return (
    <div className="card console-card console-log-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Investigation</span>
          <h2>Logs &amp; traces</h2>
        </div>
        <span className="section-note" aria-live="polite">
          {visible.length}/{lines.length} entries
          {paused ? <span>; stream paused</span> : null}
          {!connected ? <span className="console-warn">; server unreachable</span> : null}
        </span>
      </div>

      <div className="console-log-controls">
        <div className="seg console-seg" role="group" aria-label="Minimum log level">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={level === minLevel}
              onClick={() => setMinLevel(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <label className="console-log-search">
          <span className="sr-only">Filter log entries</span>
          <input
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setFilterContext(null);
              setSelectedKey(null);
              setTimelinePageIndex(null);
              setFollow(true);
            }}
            placeholder="source, message, field or value…"
            aria-label="Filter log entries"
            className="console-log-filter"
          />
        </label>
        {/* Mounted always, disabled when empty — the stylesheet's own rule:
            "dimmed, never hidden". Mount-on-keystroke shoved Pause and Clear
            view sideways the moment the filter had one character in it. */}
        <button type="button" onClick={clearFilter} disabled={!filter}>Clear filter</button>
        <button type="button" onClick={() => setPaused((current) => !current)} aria-pressed={paused}>
          {paused ? "Resume stream" : "Pause stream"}
        </button>
        <button
          type="button"
          onClick={() => {
            setLines([]);
            setGaps(0);
            setSelectedKey(null);
            setTimelinePageIndex(null);
            setFollow(true);
          }}
        >
          Clear view
        </button>
      </div>

      {filterContext ? (
        <p className="console-filter-context" role="status">
          Filtered from Services &amp; Circuits: <strong>{filterContext}</strong>
        </p>
      ) : null}

      {gaps > 0 ? (
        <p className="console-warn console-log-gap" role="status">
          <span aria-hidden>▲</span> Timeline discontinuity ×{gaps} — a server ring advanced past this
          client&apos;s cursor, so entries it held were gone before they were read. They are not on this screen.
        </p>
      ) : null}

      <TraceTimeline
        pagedVisible={pagedVisible}
        retainedCount={lines.length}
        pollMs={pollMs}
        follow={follow}
        selected={selected}
        viewport={viewport}
        activePage={activePage}
        pageCount={pageCount}
        timelineLabel={TIMELINE_LABEL}
        onScroll={onScroll}
        onPage={setTimelinePage}
        onSelect={(line) => {
          setSelectedKey(line.key);
          if (line.key !== pagedVisible[pagedVisible.length - 1]?.key) setFollow(false);
        }}
        onFollowLatest={() => {
          setFollow(true);
          setSelectedKey(null);
          const node = viewport.current;
          if (node) node.scrollTop = node.scrollHeight;
        }}
      />
    </div>
  );
}
