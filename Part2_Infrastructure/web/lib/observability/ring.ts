import { isDataQualityView, type DataQualityViewWire } from "@/lib/data-quality-ledger";

// --------------------------------------------------------------------------
// Event ring
// --------------------------------------------------------------------------

export type EventLevel = "debug" | "info" | "warn" | "error";

/** Where the record was produced. Never inferred — always stated by the writer. */
export type EventOrigin = "server" | "browser";

export type EventField = string | number | boolean | null;

export interface TraceEvent {
  /** Monotonic within an origin. The cursor a poller sends back as `since`. */
  seq: number;
  ts: number;
  level: EventLevel;
  /** Subsystem, e.g. `Dispatch`, `Breaker`, `Quota`, `Cache`, `Operator`. */
  source: string;
  message: string;
  fields: Record<string, EventField>;
  origin: EventOrigin;
}

export interface EventInput {
  level?: EventLevel;
  source: string;
  message: string;
  fields?: Record<string, EventField | undefined>;
}

const EVENT_CAPACITY = 600;

/**
 * Fixed-capacity ring with a monotonic cursor.
 *
 * `since()` returns everything newer than a sequence number *and* reports the
 * oldest sequence still held, so a client that fell behind the ring can tell it
 * lost lines instead of silently showing a discontinuous log.
 */
export class EventRing {
  private items: TraceEvent[] = [];
  private cursor = 0;

  constructor(private capacity = EVENT_CAPACITY) {}

  push(event: Omit<TraceEvent, "seq">): TraceEvent {
    const record: TraceEvent = { ...event, seq: ++this.cursor };
    this.items.push(record);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
    return record;
  }

  /** Everything with `seq > since`, oldest first, capped at `limit`. */
  since(since: number, limit = 200): TraceEvent[] {
    const fresh = this.items.filter((e) => e.seq > since);
    // Keep the NEWEST `limit`, not the oldest: a client that has been away is
    // better served by the current state of the world than by the first page of
    // a backlog it will never finish paging through.
    return fresh.slice(Math.max(0, fresh.length - limit));
  }

  all(): TraceEvent[] {
    return [...this.items];
  }

  /** Lowest sequence still retained; 0 when the ring is empty. */
  oldestSeq(): number {
    return this.items[0]?.seq ?? 0;
  }

  latestSeq(): number {
    return this.cursor;
  }

  size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
  }
}

export const events = new EventRing();

/**
 * Record one event.
 *
 * `undefined` field values are dropped rather than serialised as `null`: an
 * absent field and a field that is genuinely null mean different things on a
 * diagnostic line, and JSON collapses them if we do not.
 */
export function emit(input: EventInput, origin: EventOrigin = "server"): TraceEvent {
  const fields: Record<string, EventField> = {};
  for (const [key, value] of Object.entries(input.fields ?? {})) {
    if (value !== undefined) fields[key] = value;
  }
  return events.push({
    ts: Date.now(),
    level: input.level ?? "info",
    source: input.source,
    message: input.message,
    fields,
    origin,
  });
}

export function eventsSince(since: number, limit = 200): TraceEvent[] {
  return events.since(since, limit);
}

export function eventCursor(): { latest: number; oldest: number; retained: number; capacity: number } {
  return {
    latest: events.latestSeq(),
    oldest: events.oldestSeq(),
    retained: events.size(),
    capacity: EVENT_CAPACITY,
  };
}
