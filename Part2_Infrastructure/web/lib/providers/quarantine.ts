/**
 * Quarantine — suspect payloads, kept where someone can look at them.
 * ===================================================================
 *
 * A contract violation that only increments a counter tells a data engineer
 * that *something* was wrong and nothing about *what*. By the time anyone
 * investigates, the payload is gone and the vendor has moved on. So a bounded
 * sample of every rejected or suspect answer is held here, with the violations
 * that flagged it.
 *
 * Two properties matter:
 *
 * **Bounded and in-memory.** This is a diagnostic buffer, not a data lake. It
 * holds a fixed number of recent records and forgets the rest, because the
 * alternative — an unbounded list in a long-lived process — is a memory leak
 * wearing an audit trail's clothes.
 *
 * **A quarantined answer is never cached.** That is the whole point. A payload
 * that failed its contract must not be served to the next caller from cache;
 * the failover chain should get a chance at a cleaner source instead.
 */

import type { ContractResult, Violation } from "./contracts";

export interface QuarantineRecord {
  seq: number;
  at: string;
  provider: string;
  capability: string;
  key: string;
  /** Whether the payload was rejected outright or served with a warning. */
  rejected: boolean;
  violations: Violation[];
  /** A short, redacted excerpt — enough to recognise the shape, not to replay it. */
  sample: string;
}

const CAPACITY = 50;
const SAMPLE_CHARS = 400;

class QuarantineRing {
  private items: QuarantineRecord[] = [];
  private cursor = 0;

  push(entry: Omit<QuarantineRecord, "seq" | "at">): QuarantineRecord {
    const record: QuarantineRecord = {
      ...entry,
      seq: ++this.cursor,
      at: new Date().toISOString(),
    };
    this.items.push(record);
    if (this.items.length > CAPACITY) this.items.splice(0, this.items.length - CAPACITY);
    return record;
  }

  list(limit = CAPACITY): QuarantineRecord[] {
    return this.items.slice(-limit).reverse();
  }

  /** Violation counts by provider, for the systems console's summary row. */
  byProvider(): Array<{ provider: string; records: number; rejected: number }> {
    const counts = new Map<string, { records: number; rejected: number }>();
    for (const record of this.items) {
      const entry = counts.get(record.provider) ?? { records: 0, rejected: 0 };
      entry.records += 1;
      if (record.rejected) entry.rejected += 1;
      counts.set(record.provider, entry);
    }
    return [...counts.entries()]
      .map(([provider, entry]) => ({ provider, ...entry }))
      .sort((a, b) => b.records - a.records);
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

export const quarantine = new QuarantineRing();

/**
 * Record a contract failure, with a redacted sample of what arrived.
 *
 * The sample is truncated rather than stored whole: a full vendor payload can
 * be megabytes, and the question this buffer answers ("what shape was it?")
 * needs the first few hundred characters, not all of them.
 */
export function quarantinePayload(
  result: ContractResult,
  key: string,
  data: unknown,
  redactor: (text: string) => string = (text) => text,
): QuarantineRecord {
  let sample: string;
  try {
    sample = JSON.stringify(data);
  } catch {
    sample = String(data);
  }
  return quarantine.push({
    provider: result.provider,
    capability: result.capability,
    key,
    rejected: !result.passed,
    violations: result.violations,
    sample: redactor(sample.slice(0, SAMPLE_CHARS)),
  });
}
