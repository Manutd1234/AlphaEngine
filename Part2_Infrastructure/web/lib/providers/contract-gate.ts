/**
 * What dispatch does with a contract result, in the order it must do it.
 * ======================================================================
 *
 * Three steps, split out of `dispatch.ts` because each one has a rule that is
 * invisible from the call site:
 *
 *   1. **Evaluate.** The façade's expectations, merged with whatever the RAW
 *      checks found inside `httpJson`. `passed` is recomputed rather than
 *      trusted, because a fatal raw violation must fail a contract the
 *      normaliser was perfectly happy with.
 *
 *   2. **Record.** Telemetry and the gateway's durable ledger, both
 *      best-effort. Evidence collection must never weaken the gate.
 *
 *   3. **Report.** Quarantine the sample and log it — with the RAW body, not
 *      the normalised object. That distinction is the whole point of
 *      `raw-sink.ts`, and it is the defect this path had for the life of the
 *      feature: the boundary notice claimed raw payloads reached the
 *      quarantine sample and `data` was what actually arrived.
 *
 * Ordering matters between step 1 and `recordSuccess`, and that ordering lives
 * at the call site in `dispatch.ts` where both are visible.
 */

import { emit, queueContractFinding, redact } from "../observability";
import {
  type ContractResult,
  summariseContract,
  type Violation,
  validationTelemetry,
} from "./contracts";
import { quarantinePayload } from "./quarantine";
import type { Capability } from "./types";

/** What `withRawChecks` carried out of `httpJson` for this dispatch. */
export interface RawOutcome {
  violations: Violation[];
  /** The last raw vendor body seen; meaningful only when `seen`. */
  body: unknown;
  seen: boolean;
}

/**
 * The façade's expectations plus the raw checks, or `undefined` for neither.
 *
 * Never throws. The check itself must not be the reason a request dies — a
 * throwing predicate is a bug in the predicate, and failing the vendor for it
 * would blame the wrong party.
 */
export function evaluateContract<T>(
  check: ((data: T, provider: string) => ContractResult) | undefined,
  data: T,
  provider: string,
  capability: Capability,
  raw: RawOutcome,
): ContractResult | undefined {
  if (!check) return undefined;
  try {
    const evaluated = check(data, provider);
    // Dispatch owns the provider identity. Normalise it here even when a
    // legacy/custom callback returns a stale label such as "registry", so
    // quarantine and telemetry can never blame the façade for an adapter's
    // payload.
    return {
      ...evaluated,
      capability,
      provider,
      // Merged, not carried separately — see raw-sink.ts. `passed` is
      // recomputed because a fatal raw violation must fail a contract the
      // normaliser was happy with, which `evaluated.passed` cannot know.
      violations: [...evaluated.violations, ...raw.violations],
      passed: evaluated.passed && !raw.violations.some((v) => v.severity === "fatal"),
    };
  } catch {
    return undefined;
  }
}

/**
 * Telemetry and the durable ledger, in that order, both best-effort.
 *
 * If evidence collection itself ever fails, the evaluated contract is left
 * untouched so fatal data still fails over and warnings still travel with
 * provenance. Telemetry must never weaken the gate.
 */
export function recordContractFinding(
  contract: ContractResult,
  where: { capability: Capability; provider: string; symbol: string | null; cacheKey: string },
): void {
  try {
    validationTelemetry.record(contract);
    // The same event, queued for the gateway's durable ledger: pushed on
    // the next ops sync, merged across instances, kept past a restart.
    queueContractFinding({
      capability: where.capability,
      provider: where.provider,
      symbol: where.symbol,
      key: where.cacheKey,
      passed: contract.passed,
      violations: contract.violations,
      notEvaluated: contract.notEvaluated.length,
    });
  } catch {
    // Best-effort observability only.
  }
}

/**
 * Quarantine the sample and log the violation.
 *
 * The RAW body, not `data` — this passed the normalised object for the whole
 * life of the feature, so the quarantine held a shape the vendor never sent.
 * `raw.seen` guards a provider with no predicate, whose body was never
 * recorded: for those there is nothing better than the normalised object, and
 * saying so beats quarantining `undefined`.
 */
export function reportContractViolations<T>(
  contract: ContractResult,
  cacheKey: string,
  raw: RawOutcome,
  data: T,
): void {
  quarantinePayload(contract, cacheKey, raw.seen ? raw.body : data, redact);
  emit({
    level: contract.passed ? "warn" : "error",
    source: "Contract",
    message: `${contract.capability} from ${contract.provider}: ${summariseContract(contract)}`,
    fields: {
      capability: contract.capability,
      provider: contract.provider,
      checks: contract.violations.map((v) => v.check).join(","),
      rejected: !contract.passed,
    },
  });
}
