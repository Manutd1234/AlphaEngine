"use client";

/**
 * The streaming trace — one timeline for a system that runs in two places.
 *
 * Server-side dispatch decisions and browser-side WebSocket frames are both part
 * of the data path, and neither can see the other. Reading them in two windows
 * is how you miss that the socket went quiet ninety milliseconds before the REST
 * fallback fired. So both are merged here, ordered by time, and every line is
 * tagged with where it was produced — merged, but never conflated.
 *
 * Server lines are pulled with a sequence cursor rather than a timestamp,
 * because several of these routinely land inside the same millisecond and a time
 * cursor either duplicates or drops them. When the cursor falls behind the
 * server's ring the response says so and a gap marker is rendered: a log with a
 * silent hole in it is worse than one that admits the hole.
 *
 * Auto-scroll is opt-out and disengages the moment you scroll up, because the
 * one time you need to read a line is the one time the console will helpfully
 * yank it off screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { eventsSince } from "@/lib/observability";
import type { EventsResponse, TraceEvent } from "./types";

const LEVELS = ["debug", "info", "warn", "error"] as const;
type Level = (typeof LEVELS)[number];

/** Rank so a chosen minimum level includes everything above it. */
const LEVEL_RANK: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Bounded so a console left open overnight cannot grow without limit. */
const MAX_LINES = 800;

/**
 * A line plus a key that is unique across origins *and across instances*.
 *
 * Sequence numbers are monotonic within one process and restart at 1 in the
 * next, so `origin:seq` alone collides the moment a poll lands on a different
 * serverless instance — two unrelated events sharing a React key, which is
 * silent duplication rather than an error.
 */
type Line = TraceEvent & { key: string };

interface TraceConsoleProps {
  pollMs: number;
  paused: boolean;
  onTogglePause: () => void;
}

export default function TraceConsole({ pollMs, paused, onTogglePause }: TraceConsoleProps) {
  const [lines, setLines] = useState<Line[]>([]);
  const [minLevel, setMinLevel] = useState<Level>("debug");
  const [filter, setFilter] = useState("");
  const [follow, setFollow] = useState(true);
  const [gaps, setGaps] = useState(0);
  const [connected, setConnected] = useState(true);
  const serverCursor = useRef(0);
  const browserCursor = useRef(0);
  const instance = useRef<string | null>(null);
  // Two polls in flight would both read the cursor before either advanced it and
  // ingest the same page twice. StrictMode's double-invoked effect makes that
  // the *normal* case in development, not a rare race.
  const inFlight = useRef(false);
  const viewport = useRef<HTMLDivElement | null>(null);

  const pull = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      // Browser-side lines first and unconditionally: they exist even when the
      // server is unreachable, which is exactly when a log is worth having.
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
          if (instance.current !== null && instance.current !== instanceId) {
            // A different instance means a different ring with its own sequence
            // space and its own history. Restart the cursor and say so, rather
            // than splicing two unrelated timelines together.
            serverCursor.current = 0;
            setGaps((n) => n + 1);
          }
          instance.current = instanceId;
          remote = body.events ?? [];
          // Advance from the last line actually received, not from the ring's
          // head: if a limit truncated the page, the head is ahead of what was
          // delivered and the difference would never be fetched.
          if (remote.length) serverCursor.current = remote[remote.length - 1].seq;
          else if (body.cursor) serverCursor.current = body.cursor.latest;
          if (body.dropped) setGaps((n) => n + 1);
          setConnected(true);
        } else {
          setConnected(false);
        }
      } catch {
        setConnected(false);
      }

      const fresh: Line[] = [
        ...local.map((e) => ({ ...e, key: `browser:${e.seq}` })),
        ...remote.map((e) => ({ ...e, key: `server:${instanceId}:${e.seq}` })),
      ];
      if (!fresh.length) return;
      setLines((current) => {
        // Deduplicate on the way in. The cursor guard above should make this
        // unnecessary; keeping it means a future change to the cursor logic
        // degrades into a missing line rather than a duplicated one.
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
    void pull();
  }, [pull]);

  useEffect(() => {
    if (paused || !pollMs) return;
    const timer = setInterval(() => {
      if (!document.hidden) void pull();
    }, pollMs);
    return () => clearInterval(timer);
  }, [paused, pollMs, pull]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return lines.filter((line) => {
      if (LEVEL_RANK[line.level] < LEVEL_RANK[minLevel]) return false;
      if (!needle) return true;
      return (
        line.message.toLowerCase().includes(needle)
        || line.source.toLowerCase().includes(needle)
        || Object.values(line.fields ?? {}).some((v) => String(v).toLowerCase().includes(needle))
      );
    });
  }, [lines, minLevel, filter]);

  useEffect(() => {
    if (!follow) return;
    const node = viewport.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible, follow]);

  // Disengage follow as soon as the reader scrolls away from the bottom, and
  // re-engage when they come back. A "follow" checkbox that fights the scroll
  // wheel is the reason people paste logs into a text editor instead.
  const onScroll = () => {
    const node = viewport.current;
    if (!node) return;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setFollow(atBottom);
  };

  return (
    <div className="card console-card console-log-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Trace</span>
          <h2>Event stream</h2>
        </div>
        <span className="section-note">
          {visible.length}/{lines.length} lines
          {!connected && <span className="console-warn"> · server unreachable</span>}
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
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="filter…"
          aria-label="Filter log lines"
          className="console-log-filter"
        />
        <button type="button" onClick={onTogglePause} aria-pressed={paused}>
          {paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() => {
            setLines([]);
            setGaps(0);
          }}
        >
          Clear view
        </button>
      </div>

      {gaps > 0 && (
        <p className="console-warn console-log-gap" role="status">
          <span aria-hidden>▲</span> Timeline discontinuity ×{gaps} — either the server ring advanced
          past this client&apos;s cursor (lines produced faster than they were polled), or a poll
          landed on a different instance, whose ring is a different history. Either way, lines exist
          that are not on this screen.
        </p>
      )}

      <div
        className="console-log"
        ref={viewport}
        onScroll={onScroll}
        role="log"
        aria-label="System event stream"
        tabIndex={0}
      >
        {visible.length === 0 && (
          <p className="console-log__empty">
            No lines yet. Trace a symbol or trip a provider and this fills up.
          </p>
        )}
        {visible.map((line) => (
          <div className={`console-log__line is-${line.level}`} key={line.key}>
            <span className="console-log__ts">{stamp(line.ts)}</span>
            <span className={`console-log__level is-${line.level}`}>{line.level.toUpperCase()}</span>
            <span className="console-log__origin" title={line.origin === "server" ? "produced on the server instance" : "produced in this browser tab"}>
              {line.origin === "server" ? "srv" : "web"}
            </span>
            <span className="console-log__source">[{line.source}]</span>
            <span className="console-log__msg">{line.message}</span>
            {Object.entries(line.fields ?? {}).length > 0 && (
              <span className="console-log__fields">
                {Object.entries(line.fields)
                  .filter(([, value]) => value !== null && value !== "")
                  .map(([key, value]) => `${key}=${value}`)
                  .join(" ")}
              </span>
            )}
          </div>
        ))}
      </div>

      {!follow && (
        <button
          type="button"
          className="console-log-jump"
          onClick={() => {
            setFollow(true);
            const node = viewport.current;
            if (node) node.scrollTop = node.scrollHeight;
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}

/** Millisecond precision, because the interesting gaps here are sub-second. */
function stamp(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
