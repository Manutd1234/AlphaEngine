"use client";

/**
 * Cross-origin event investigation with a bounded, cursor-aware stream.
 *
 * Server dispatch events and browser wire events remain explicitly tagged. A
 * selectable master list keeps the timeline scannable while the detail pane
 * exposes every structured field without flattening it into an unreadable row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { eventsSince } from "@/lib/observability";
import type { EventsResponse, TraceEvent } from "./types";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MAX_LINES = 800;

type Line = TraceEvent & { key: string };

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
  const [lines, setLines] = useState<Line[]>([]);
  const [minLevel, setMinLevel] = useState<Level>("debug");
  const [filter, setFilter] = useState("");
  const [filterContext, setFilterContext] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [gaps, setGaps] = useState(0);
  const [connected, setConnected] = useState(true);
  const [paused, setPaused] = useState(false);
  const serverCursor = useRef(0);
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
        const response = await fetch(
          `/api/system/events?since=${serverCursor.current}&limit=250`,
          { cache: "no-store" },
        );
        if (response.ok) {
          const body = (await response.json()) as EventsResponse;
          instanceId = body.instance ?? "unknown";
          const switched = instance.current !== null && instance.current !== instanceId;
          instance.current = instanceId;
          setConnected(true);

          if (switched) {
            // Sequence spaces are instance-local. Rewind rather than ingesting a
            // page fetched with another instance's cursor and hiding the hole.
            serverCursor.current = 0;
            setGaps((count) => count + 1);
          } else {
            remote = body.events ?? [];
            if (remote.length) serverCursor.current = remote[remote.length - 1].seq;
            else if (body.cursor) serverCursor.current = body.cursor.latest;
            if (body.dropped) setGaps((count) => count + 1);
          }
        } else {
          setConnected(false);
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
  }, [filterRequest]);

  useEffect(() => {
    if (!active || paused) return;
    void pull();
  }, [active, paused, pull]);

  useEffect(() => {
    if (!active || paused || !pollMs) return;
    const timer = setInterval(() => {
      if (!document.hidden) void pull();
    }, pollMs);
    return () => clearInterval(timer);
  }, [active, paused, pollMs, pull]);

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

  useEffect(() => {
    if (!follow) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, follow]);

  const selected = useMemo(() => {
    const explicit = selectedKey ? visible.find((line) => line.key === selectedKey) : null;
    return explicit ?? visible[visible.length - 1] ?? null;
  }, [selectedKey, visible]);

  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setFollow(atBottom);
  };

  const clearFilter = () => {
    setFilter("");
    setFilterContext(null);
    setSelectedKey(null);
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
          {paused ? <span> · stream paused</span> : null}
          {!connected ? <span className="console-warn"> · server unreachable</span> : null}
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
          <span aria-hidden>▲</span> Timeline discontinuity ×{gaps} — either the server ring advanced
          past this client&apos;s cursor or a poll landed on a different instance. Entries exist that
          are not on this screen.
        </p>
      ) : null}

      <div className="console-trace-split">
        <div className="console-trace-master">
          <div className="console-trace-pane-heading">
            <strong>Timeline</strong>
            <span>{follow ? "Following latest" : "Follow disengaged"}</span>
          </div>
          <ol
            className="console-log"
            ref={viewport}
            onScroll={onScroll}
            role="log"
            aria-label="System event timeline"
            aria-live="off"
            tabIndex={0}
          >
            {visible.length === 0 ? (
              <li className="console-log__empty">
                {lines.length ? "No entries match the current filter." : "No entries yet. Trace a symbol or trip a provider to populate the stream."}
              </li>
            ) : null}
            {/* A line that arrived within the last poll window wears the
                fresh tint; the next pull's re-render ages it out. Emphasis
                only — the row is identical without it. */}
            {visible.map((line) => (
              <li
                className={`console-log__entry${Date.now() - line.ts < (pollMs || 5_000) ? " row-fresh" : ""}`}
                key={line.key}
              >
                <button
                  type="button"
                  className={`console-log__line is-${line.level}`}
                  aria-pressed={selected?.key === line.key}
                  aria-controls="trace-event-detail"
                  onClick={() => {
                    setSelectedKey(line.key);
                    if (line.key !== visible[visible.length - 1]?.key) setFollow(false);
                  }}
                >
                  <time className="console-log__ts" dateTime={new Date(line.ts).toISOString()}>{stamp(line.ts)}</time>
                  <span className={`console-log__level is-${line.level}`}>{line.level.toUpperCase()}</span>
                  <span
                    className="console-log__origin"
                    title={line.origin === "server" ? "Produced on the server instance" : "Produced in this browser tab"}
                  >
                    {line.origin === "server" ? "srv" : "web"}
                  </span>
                  <span className="console-log__source">[{line.source}]</span>
                  <span className="console-log__msg">{line.message}</span>
                  {Object.keys(line.fields ?? {}).length ? (
                    <span className="console-log__fields">{fieldSummary(line.fields)}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ol>

          {!follow ? (
            <button
              type="button"
              className="console-log-jump"
              onClick={() => {
                setFollow(true);
                setSelectedKey(null);
                const node = viewport.current;
                if (node) node.scrollTop = node.scrollHeight;
              }}
            >
              Follow latest ↓
            </button>
          ) : null}
        </div>

        <aside className="console-trace-detail" id="trace-event-detail" aria-labelledby="trace-event-detail-title">
          <div className="console-trace-pane-heading">
            <strong id="trace-event-detail-title">Structured detail</strong>
            <span>{selected ? `event ${selected.seq}` : "No selection"}</span>
          </div>
          {selected ? (
            <div className="console-trace-detail__body">
              <div className="console-trace-detail__title">
                <span className={`console-log__level is-${selected.level}`}>{selected.level.toUpperCase()}</span>
                <h3>{selected.message}</h3>
              </div>
              <dl className="console-trace-meta">
                <div><dt>Time (UTC)</dt><dd>{new Date(selected.ts).toISOString()}</dd></div>
                <div><dt>Source</dt><dd><code>{selected.source}</code></dd></div>
                <div><dt>Origin</dt><dd>{selected.origin === "server" ? "Server instance" : "This browser tab"}</dd></div>
                <div><dt>Sequence</dt><dd className="num">{selected.seq}</dd></div>
              </dl>

              <div className="console-trace-fields-heading">
                <strong>Fields</strong>
                <span>{Object.keys(selected.fields ?? {}).length}</span>
              </div>
              {Object.keys(selected.fields ?? {}).length ? (
                <dl className="console-trace-fields">
                  {Object.entries(selected.fields).map(([key, value]) => (
                    <div key={key}>
                      <dt>{key}</dt>
                      <dd>{formatFieldValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="muted console-trace-empty-detail">This event has no structured fields.</p>
              )}
            </div>
          ) : (
            <p className="muted console-trace-empty-detail">Select an entry to inspect its timestamp, source and fields.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function fieldSummary(fields: TraceEvent["fields"]): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
}

function formatFieldValue(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

/** Millisecond precision, because the interesting gaps here are sub-second. */
function stamp(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number, width = 2) => String(value).padStart(width, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
