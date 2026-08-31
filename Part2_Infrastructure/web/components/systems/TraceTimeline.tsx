import type { RefObject } from "react";

import type { TraceEvent } from "./types";
import { entityDomToken } from "@/lib/workspace-entities";

export type Line = TraceEvent & { key: string };

function correlationId(line: Line): string | null {
  const fields = line.fields ?? {};
  const value = fields.requestId ?? fields.request_id ?? fields.correlationId ?? fields.correlation_id;
  return typeof value === "string" && value ? value : null;
}

interface TraceTimelineProps {
  pagedVisible: Line[];
  retainedCount: number;
  pollMs: number;
  follow: boolean;
  selected: Line | null;
  viewport: RefObject<HTMLOListElement | null>;
  activePage: number;
  pageCount: number;
  timelineLabel: string;
  onScroll: () => void;
  onPage: (page: number) => void;
  onSelect: (line: Line) => void;
  onFollowLatest: () => void;
}

export default function TraceTimeline({
  pagedVisible,
  retainedCount,
  pollMs,
  follow,
  selected,
  viewport,
  activePage,
  pageCount,
  timelineLabel,
  onScroll,
  onPage,
  onSelect,
  onFollowLatest,
}: TraceTimelineProps) {
  const firstFocusKeyByCorrelation = new Map<string, string>();
  for (const line of pagedVisible) {
    const correlation = correlationId(line);
    if (correlation && !firstFocusKeyByCorrelation.has(correlation)) {
      firstFocusKeyByCorrelation.set(correlation, line.key);
    }
  }

  return (
    <div className="console-trace-split">
      <div className="console-trace-master">
        <div className="console-trace-pane-heading">
          <strong id="trace-timeline-heading">{timelineLabel}</strong>
          {pageCount > 1 ? (
            <div className="console-trace-pagination" role="group" aria-labelledby="trace-timeline-heading">
              <button
                type="button"
                onClick={() => onPage(activePage - 1)}
                disabled={activePage === 0}
                aria-label={[timelineLabel, activePage].join(" ")}
              >
                ‹
              </button>
              <select
                value={activePage}
                onChange={(event) => onPage(Number(event.target.value))}
                aria-labelledby="trace-timeline-heading"
              >
                {Array.from({ length: pageCount }, (_, index) => (
                  <option key={index} value={index}>{index + 1}</option>
                ))}
              </select>
              <span className="console-trace-page-count">/{pageCount}</span>
              <button
                type="button"
                onClick={() => onPage(activePage + 1)}
                disabled={activePage === pageCount - 1}
                aria-label={[timelineLabel, activePage + 2].join(" ")}
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
        <ol
          className="console-log"
          ref={viewport}
          onScroll={onScroll}
          aria-label="System event timeline"
          aria-live="off"
          tabIndex={0}
        >
          {pagedVisible.length === 0 ? (
            <li className="console-log__empty">
              {retainedCount ? "No entries match the current filter." : "No entries yet. Trace a symbol or trip a provider to populate the stream."}
            </li>
          ) : null}
          {pagedVisible.map((line) => {
            const correlation = correlationId(line);
            const focusId = correlation && firstFocusKeyByCorrelation.get(correlation) === line.key
              ? "trace-event-" + entityDomToken(correlation)
              : undefined;
            return (
              <li
                className={`console-log__entry${Date.now() - line.ts < (pollMs || 5_000) ? " row-fresh" : ""}`}
                key={line.key}
              >
                <button
                  type="button"
                  id={focusId}
                  className={`console-log__line is-${line.level}`}
                  aria-pressed={selected?.key === line.key}
                  aria-controls="trace-event-detail"
                  onClick={() => onSelect(line)}
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
            );
          })}
        </ol>

        {!follow ? (
          <button type="button" className="console-log-jump" onClick={onFollowLatest}>
            Follow latest ↓
          </button>
        ) : null}
      </div>

      <aside
        className="console-trace-detail"
        id="trace-event-detail"
        aria-labelledby="trace-event-detail-title"
        tabIndex={0}
      >
        <div className="console-trace-pane-heading">
          <strong id="trace-event-detail-title">Structured detail</strong>
          <span>{selected ? `Event ${selected.seq}` : "No selection"}</span>
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
