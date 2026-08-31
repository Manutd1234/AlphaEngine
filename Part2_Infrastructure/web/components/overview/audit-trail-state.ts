/**
 * What the audit panel is showing, decided where a test can reach it.
 * ==================================================================
 *
 * `AuditTrail` used to decide this inline, with a `useState` that a failed
 * poll — or a 200 with no rows array — moved straight to `generated`. That
 * replaced a table of orders the gateway really recorded with a generated
 * ledger. The panel no longer has a generated data path: an unreadable ledger
 * is unavailable, while a later failure preserves only a genuine last read.
 *
 * These two functions are the panel's whole decision, pure so
 * `tests/overview-stability.test.ts` can drive a pass/fail/pass script against
 * the machine with no DOM. The component keeps the fetch, the poll gate and
 * the render; it holds no state of its own.
 */

import type { AuditRow } from "@/lib/audit";
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
 * The three states the panel renders. No state carries substitute rows.
 */
export type AuditPanelState =
  | { kind: "loading" }
  | { kind: "ready"; rows: AuditRow[]; fetchedAt: Date }
  | { kind: "unavailable"; detail: string };

/**
 * The machine's state, rendered.
 *
 * `measured` keeps the real rows whatever the tier — `fetchedAt` is the last
 * good read, so cached rows carry their age through the provenance line the
 * panel already prints. An empty settled source names the live failure and
 * remains empty. Before the first probe settles, it remains a loading state.
 */
export function auditView(source: DeskSourceState<AuditRow[]>): AuditPanelState {
  const { showing } = source;
  if (showing.kind === "measured") {
    return { kind: "ready", rows: showing.payload, fetchedAt: showing.lastGoodAt };
  }
  if (showing.kind === "empty" && showing.failure) {
    return {
      kind: "unavailable",
      detail: showing.failure.message ?? "The gateway audit ledger could not be read.",
    };
  }
  // AuditTrail has no sandbox chooser, so a generated source is not reachable
  // from its own controls. Treat an externally restored choice as unavailable
  // instead of smuggling generated rows into a ledger view.
  if (showing.kind === "generated") {
    return { kind: "unavailable", detail: "The live gateway audit ledger is not selected." };
  }
  return { kind: "loading" };
}
