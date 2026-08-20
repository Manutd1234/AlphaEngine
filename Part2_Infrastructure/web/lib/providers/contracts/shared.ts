import type { Capability, Fundamentals, NewsItem, OhlcvBar, Quote } from "../types";

/**
 * The capabilities whose normalised payload is contract-checked before it is
 * cached or shown. `search` and `scrape` are free text — a document has no
 * shape a check could fail — so they are named as uncovered wherever this
 * list is quoted, not left to look covered by omission.
 */
export const CONTRACTED_CAPABILITIES = ["quote", "bars", "news", "fundamentals"] as const satisfies readonly Capability[];

export type Severity = "fatal" | "warn" | "drift";

export interface Violation {
  /** Stable identifier, so a dashboard can count occurrences over time. */
  check: string;
  severity: Severity;
  message: string;
  /** The offending value, when showing it helps and does not leak a secret. */
  observed?: string | number | null;
}

export interface ContractResult {
  capability: Capability;
  provider: string;
  passed: boolean;
  violations: Violation[];
  /** Checks that could not be evaluated because the input was absent. */
  notEvaluated: string[];
}

/**
 * Aggregate contract evidence for one slice of the in-memory observation
 * window. `evaluated` and `passed` count payloads; severity fields and
 * `notEvaluated` count individual findings/checks. Keeping those units explicit
 * prevents a payload with three warnings from being presented as three payload
 * failures in the console.
 */
export interface ValidationCounts {
  evaluated: number;
  passed: number;
  fatal: number;
  warn: number;
  drift: number;
  notEvaluated: number;
}

export interface ValidationTelemetrySnapshot extends ValidationCounts {
  /** Module-scoped state: each serverless function instance has its own window. */
  scope: "per-instance";
  /** Timestamp of the oldest retained evaluation, not process start time. */
  windowStart: string | null;
  lastValidationAt: string | null;
  retained: number;
  capacity: number;
  byCapability: Partial<Record<Capability, ValidationCounts>>;
  byProvider: Record<string, ValidationCounts>;
}

interface ValidationObservation extends ValidationCounts {
  at: number;
  capability: Capability;
  provider: string;
}

/**
 * A fixed-size evidence window rather than an unbounded event history.
 *
 * The quarantine buffer retains payload excerpts for diagnosis; this buffer
 * retains only tiny counters for trust reporting. Both are deliberately local
 * to one function instance and bounded, so varied symbols or a long-lived dev
 * server cannot turn observability into a memory leak.
 */
export const VALIDATION_TELEMETRY_CAPACITY = 500;

function emptyValidationCounts(): ValidationCounts {
  return { evaluated: 0, passed: 0, fatal: 0, warn: 0, drift: 0, notEvaluated: 0 };
}

function addValidationCounts(target: ValidationCounts, source: ValidationCounts): void {
  target.evaluated += source.evaluated;
  target.passed += source.passed;
  target.fatal += source.fatal;
  target.warn += source.warn;
  target.drift += source.drift;
  target.notEvaluated += source.notEvaluated;
}

class ValidationTelemetry {
  private observations: ValidationObservation[] = [];

  record(result: ContractResult, at = Date.now()): void {
    const observation: ValidationObservation = {
      at,
      capability: result.capability,
      provider: result.provider,
      evaluated: 1,
      passed: result.passed ? 1 : 0,
      fatal: result.violations.filter((violation) => violation.severity === "fatal").length,
      warn: result.violations.filter((violation) => violation.severity === "warn").length,
      drift: result.violations.filter((violation) => violation.severity === "drift").length,
      notEvaluated: result.notEvaluated.length,
    };
    this.observations.push(observation);
    if (this.observations.length > VALIDATION_TELEMETRY_CAPACITY) {
      this.observations.splice(0, this.observations.length - VALIDATION_TELEMETRY_CAPACITY);
    }
  }

  snapshot(): ValidationTelemetrySnapshot {
    const totals = emptyValidationCounts();
    const byCapability: Partial<Record<Capability, ValidationCounts>> = {};
    const byProvider: Record<string, ValidationCounts> = {};

    for (const observation of this.observations) {
      addValidationCounts(totals, observation);
      const capability = byCapability[observation.capability] ?? emptyValidationCounts();
      addValidationCounts(capability, observation);
      byCapability[observation.capability] = capability;
      const provider = byProvider[observation.provider] ?? emptyValidationCounts();
      addValidationCounts(provider, observation);
      byProvider[observation.provider] = provider;
    }

    const first = this.observations[0];
    const last = this.observations[this.observations.length - 1];
    return {
      scope: "per-instance",
      ...totals,
      windowStart: first ? new Date(first.at).toISOString() : null,
      lastValidationAt: last ? new Date(last.at).toISOString() : null,
      retained: this.observations.length,
      capacity: VALIDATION_TELEMETRY_CAPACITY,
      byCapability,
      byProvider,
    };
  }

  clear(): void {
    this.observations = [];
  }
}

export const validationTelemetry = new ValidationTelemetry();

/** Beyond this a "live" quote is being read as something it is not. */
export const FRESHNESS_LIMIT_MS = 24 * 60 * 60 * 1000;

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
