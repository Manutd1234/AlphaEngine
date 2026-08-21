/**
 * What the audit panel is showing, decided where a test can reach it.
 * ==================================================================
 *
 * `AuditTrail` used to decide this inline, with a `useState` that a failed
 * poll — or a 200 with no rows array — moved straight to `generated`. That
 * replaced a table of orders the gateway really recorded with the sandbox
 * ledger, and the next good poll swapped the real rows back: the exact
 * alternation `DeskSourceMachine` exists to make unrepresentable, at the
 * panel's own 30s cadence.
 *
 * These two functions are the panel's whole decision, pure so
 * `tests/overview-stability.test.ts` can drive a pass/fail/pass script against
 * the machine with no DOM. The component keeps the fetch, the poll gate and
 * the render; it holds no state of its own.
 */

import type { AuditRow } from "@/lib/fallbacks/audit";
import type { DeskSourceState, ProbeFailure, ProbeOutcome } from "@/lib/desk-source";

/** The settled probe as `probeGateway` reports it, before the machine sees it. */
export type AuditProbe =
  | { ok: true; payload: { rows?: unknown } }
  | { ok: false; failure: ProbeFailure };

/**
 * What a settled probe means to the machine.
 *
 * A gateway that answers 200 without a rows array has no audit feed, and that
 * is a FAILURE, not a fresh (empty) reading: recording it as success would let
 * it overwrite a real ledger with nothing, and the machine would call the desk
 * live on the strength of an answer that carried no data. The message is
 * passed in by the component so the rendered wording stays beside the render.
 */
export function auditProbeOutcome(
  probe: AuditProbe,
  missingFeedMessage: string,
): ProbeOutcome<AuditRow[]> {
  if (!probe.ok) return { ok: false, failure: probe.failure };
  const { rows } = probe.payload;
  if (!Array.isArray(rows)) return { ok: false, failure: { message: missingFeedMessage } };
  return { ok: true, payload: rows as AuditRow[] };
}

/**
 * The three states the panel renders. Same names the component always used;
 * what changed is who may enter `generated` — only a desk that has never had
 * a measured ledger, per the machine's rule 1.
 */
export type AuditPanelState =
  | { kind: "loading" }
  | { kind: "ready"; rows: AuditRow[]; fetchedAt: Date }
  | { kind: "generated"; rows: AuditRow[]; detail: string };

/**
 * The machine's state, rendered.
 *
 * `measured` keeps the real rows whatever the tier — `fetchedAt` is the last
 * good read, so cached rows carry their age through the provenance line the
 * panel already prints. `generated` takes the caller's sandbox rows (derived
 * from the shared desk seed, so the Execution blotter shows the same orders)
 * and the current failure's own wording. `empty` can only be the unsettled
 * first probe here — this panel has no Live/Sandbox control to press — which
 * is the skeleton, not a table.
 */
export function auditView(
  source: DeskSourceState<AuditRow[]>,
  generatedRows: AuditRow[],
): AuditPanelState {
  const { showing } = source;
  if (showing.kind === "measured") {
    return { kind: "ready", rows: showing.payload, fetchedAt: showing.lastGoodAt };
  }
  if (showing.kind === "generated") {
    return { kind: "generated", rows: generatedRows, detail: source.failure?.message ?? "" };
  }
  return { kind: "loading" };
}
