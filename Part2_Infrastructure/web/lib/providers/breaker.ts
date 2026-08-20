/**
 * The circuit breaker: skipping a dead provider instead of paying its timeout.
 *
 * A provider that times out costs every request its full timeout. After
 * `BREAKER_THRESHOLD` consecutive failures the provider is skipped outright
 * until a probe succeeds, so one broken vendor cannot add 8s to the latency of
 * a route that has three working alternatives.
 *
 * ── The `state` field is a contract, not a log detail ───────────────────────
 * Every writer below emits `fields.state` and `lib/remediation.ts` pairs those
 * events into incidents by matching the literals `"open"` and `"closed"`
 * exactly. `half_open` is deliberately neither: `breakerOpen` emits it on every
 * request once a cooldown has elapsed, and counting it as a closure would end
 * an incident that is still open. Change a literal here and the remediation
 * ring renders empty while the breaker keeps working — a silent break, which is
 * why the strings are pinned by test rather than derived.
 */

import { emit } from "../observability";
import { store, type Store } from "./store";

export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

interface BreakerState {
  failures: number;
  openedAt: number | null;
  /**
   * A cooldown has elapsed and the next call is the probe.
   *
   * This exists so an AUTOMATIC recovery is observable. `breakerOpen` used to
   * delete the record outright when the cooldown expired, which reset the
   * failure count correctly but also erased the only evidence that a circuit
   * had been open — so the success that followed emitted nothing, and the
   * remediation ledger showed every self-healed circuit as still open forever.
   * The count still restarts from zero, which is the documented behaviour; only
   * the memory of having been open survives it.
   */
  probing?: boolean;
}

function breakerKey(id: string) {
  return `breaker:${id}`;
}

export function breakerOpen(id: string, s: Store = store): boolean {
  const st = s.get<BreakerState>(breakerKey(id));
  if (!st?.openedAt) return false;
  if (Date.now() - st.openedAt >= BREAKER_COOLDOWN_MS) {
    // Half-open: let exactly one request through to probe. The failure count is
    // zeroed rather than the record deleted, so a probe failure still re-counts
    // from one — slower to re-open, and it cannot get stuck open — while the
    // `probing` flag keeps the fact that this circuit WAS open available to the
    // success that follows. Deleting it made every automatic recovery silent.
    s.set(breakerKey(id), { failures: 0, openedAt: null, probing: true }, BREAKER_COOLDOWN_MS * 4);
    emit({
      level: "info",
      source: "Breaker",
      message: `${id} cooldown elapsed — half-open, next call probes`,
      fields: { provider: id, state: "half_open" },
    });
    return false;
  }
  return true;
}

/**
 * The breaker as an operator reads it, rather than as dispatch consumes it.
 *
 * `breakerOpen` answers one boolean and, as a side effect, retires an expired
 * breaker. The console needs the shape *behind* that boolean — how many
 * consecutive failures have accrued, how long until the cooldown lets a probe
 * through — and it must be able to ask without mutating anything, because a
 * status panel that silently resets breakers by rendering is not a status panel.
 */
export interface BreakerSnapshot {
  state: "closed" | "open" | "half_open";
  failures: number;
  threshold: number;
  openedAt: number | null;
  /** Milliseconds until a probe is allowed; 0 when one already is. */
  cooldownRemainingMs: number;
}

export function breakerSnapshot(id: string, s: Store = store, now = Date.now()): BreakerSnapshot {
  const st = s.get<BreakerState>(breakerKey(id));
  const failures = st?.failures ?? 0;
  if (!st?.openedAt) {
    return { state: "closed", failures, threshold: BREAKER_THRESHOLD, openedAt: null, cooldownRemainingMs: 0 };
  }
  const remaining = BREAKER_COOLDOWN_MS - (now - st.openedAt);
  return remaining > 0
    ? {
        state: "open",
        failures,
        threshold: BREAKER_THRESHOLD,
        openedAt: st.openedAt,
        cooldownRemainingMs: remaining,
      }
    : {
        state: "half_open",
        failures,
        threshold: BREAKER_THRESHOLD,
        openedAt: st.openedAt,
        cooldownRemainingMs: 0,
      };
}

export function recordSuccess(id: string, s: Store = store): void {
  const had = s.get<BreakerState>(breakerKey(id));
  s.del(breakerKey(id));
  // `probing` as well as `openedAt`: by the time the probe returns, the
  // dispatch gate has already zeroed the record, so `openedAt` is null on
  // exactly the recoveries that matter — the automatic ones.
  if (had?.openedAt || had?.probing) {
    emit({
      level: "info",
      source: "Breaker",
      message: `${id} probe succeeded — circuit closed`,
      fields: { provider: id, state: "closed" },
    });
  }
}

export function recordFailure(id: string, s: Store = store): void {
  const st = s.get<BreakerState>(breakerKey(id)) ?? { failures: 0, openedAt: null };
  const wasOpen = st.openedAt !== null;
  // The probe answered, and it answered badly. Whatever happens next is a fresh
  // count toward a fresh trip, not the tail of the old one.
  st.probing = false;
  st.failures += 1;
  if (st.failures >= BREAKER_THRESHOLD) st.openedAt = Date.now();
  s.set(breakerKey(id), st, BREAKER_COOLDOWN_MS * 4);
  if (st.openedAt && !wasOpen) {
    emit({
      level: "error",
      source: "Breaker",
      message: `${id} tripped after ${st.failures} consecutive failures — skipping for ${BREAKER_COOLDOWN_MS / 1000}s`,
      fields: { provider: id, state: "open", failures: st.failures },
    });
  }
}

/** Operator reset. Returns whether a breaker was actually holding the provider out. */
export function resetBreaker(id: string, s: Store = store): boolean {
  const had = s.get<BreakerState>(breakerKey(id));
  s.del(breakerKey(id));
  const wasHolding = Boolean(had?.openedAt);

  /**
   * Emit the TRANSITION, not just the action.
   *
   * Every other breaker state change writes a line — tripped, cooldown elapsed,
   * probe succeeded — and this one wrote none. So an operator pressing "Close
   * all circuits" produced no `closed` event, and anything pairing open→closed
   * to measure a recovery would count every manual intervention as still open,
   * forever. The remediation ledger cannot tell automatic recovery from manual
   * without this line.
   *
   * Only when a circuit was actually holding: resetting a provider that was
   * already closed is a no-op, and recording it as a recovery would inflate the
   * count with events where nothing was wrong. `by` is what makes the
   * auto-vs-operator split a measurement rather than a guess.
   */
  if (wasHolding) {
    emit({
      level: "info",
      source: "Breaker",
      message: `${id} circuit closed by operator`,
      fields: { provider: id, state: "closed", by: "operator" },
    });
  }

  return wasHolding;
}
