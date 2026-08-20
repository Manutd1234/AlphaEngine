/**
 * The quota ledger: counting a vendor's allowance before it is spent.
 *
 * Alpha Vantage's free plan is 25 calls *per day* and Firecrawl's is 1,000
 * credits *per month*. Nothing about a naive integration warns you before a
 * dashboard that auto-refreshes spends a day's allowance. Calls are counted
 * before they are made, and background polling is fenced out of a reserve so a
 * human lookup still works at 4pm.
 *
 * Per instance, like everything else in `store.ts`: the count is a floor, and
 * `hydrateQuotaLedger` is how the gateway's merged total corrects it.
 */

import { emit, recordQuotaReset, recordQuotaSpend } from "../observability";
import { store, type Store } from "./store";
import type { Adapter, Priority } from "./types";

const WINDOW_MS = { minute: 60_000, day: 86_400_000, month: 2_678_400_000 } as const;

/**
 * Label of the current window, used as the counter key.
 *
 * Deliberately calendar-aligned rather than rolling: vendors reset on calendar
 * boundaries, so a rolling window would let us believe we had budget on the 1st
 * that the vendor had already reset, and vice versa. Month uses UTC, whereas
 * most vendors reset on the account's signup anniversary — that makes our count
 * conservative near a boundary, which is the direction that fails safely.
 */
export function windowKey(window: "minute" | "day" | "month", now = Date.now()): string {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  if (window === "month") return `${y}-${m}`;
  const day = String(d.getUTCDate()).padStart(2, "0");
  if (window === "day") return `${y}-${m}-${day}`;
  return `${y}-${m}-${day}T${String(d.getUTCHours()).padStart(2, "0")}:${String(
    d.getUTCMinutes(),
  ).padStart(2, "0")}`;
}

export interface QuotaState {
  used: number;
  limit: number;
  remaining: number;
  reserve: number;
  window: string;
}

export function quotaState(adapter: Adapter, s: Store = store): QuotaState | null {
  const q = adapter.meta.quota;
  if (!q) return null;
  const key = `quota:${adapter.meta.id}:${windowKey(q.window)}`;
  const used = s.get<number>(key) ?? 0;
  return {
    used,
    limit: q.calls,
    remaining: Math.max(0, q.calls - used),
    reserve: Math.ceil(q.calls * q.reserve),
    window: q.window,
  };
}

/** `null` when spending is allowed; otherwise the reason it is not. */
export function quotaBlock(
  adapter: Adapter,
  priority: Priority,
  s: Store = store,
): "quota_exhausted" | "quota_reserved" | null {
  const st = quotaState(adapter, s);
  if (!st) return null;
  if (st.remaining <= 0) return "quota_exhausted";
  // The reserve is the whole point: background polling stops early so that an
  // interactive lookup later in the window still has budget.
  if (priority === "background" && st.remaining <= st.reserve) return "quota_reserved";
  return null;
}

export function spendQuota(adapter: Adapter, s: Store = store): void {
  const q = adapter.meta.quota;
  if (!q) return;
  const window = windowKey(q.window);
  s.incr(`quota:${adapter.meta.id}:${window}`, WINDOW_MS[q.window]);
  // Queue the delta for the gateway's shared ledger so other instances stop
  // believing they have budget this instance already spent.
  recordQuotaSpend(adapter.meta.id, window);
}

/**
 * Zero this instance's counter for a provider's current window.
 *
 * Worth being blunt about what this does and does not do: it resets **our
 * ledger**, not the vendor's meter. Alpha Vantage still believes it has served
 * 25 calls today. The reason it exists at all is that the ledger is a *floor*
 * derived from one instance's memory, so after a deploy or an instance swap it
 * can be badly pessimistic and block a provider that has budget left. Anyone
 * pressing this needs to know they may be about to spend a real allowance.
 */
export function resetQuota(adapter: Adapter, s: Store = store): number {
  const q = adapter.meta.quota;
  if (!q) return 0;
  const window = windowKey(q.window);
  const key = `quota:${adapter.meta.id}:${window}`;
  const used = s.get<number>(key) ?? 0;
  s.del(key);
  // Without this the next sync would hydrate the shared total straight back.
  recordQuotaReset(adapter.meta.id, window);
  return used;
}

/**
 * Install the gateway-merged spend totals as this instance's counters.
 *
 * The shared total *replaces* the local count rather than taking the max: the
 * total already contains everything this instance pushed, and replacement is
 * what lets an operator's quota reset propagate instead of every instance
 * re-asserting its stale high-water mark. Spends made between push and
 * response are under-counted until the next sync — convergence, not a race
 * worth a lock. The window's expiry is preserved so hydration never slides a
 * calendar window forward.
 */
export function hydrateQuotaLedger(
  entries: Array<{ provider: string; window: string; spent: number }>,
  s: Store = store,
): void {
  for (const { provider, window, spent } of entries.slice(0, 64)) {
    const key = `quota:${provider}:${window}`;
    if (spent <= 0) {
      s.del(key);
      continue;
    }
    const remaining = s.ttl(key);
    s.set(key, spent, remaining ?? fallbackWindowTtl(window));
  }
}

/** Infer a conservative TTL from the calendar label's own shape. */
function fallbackWindowTtl(window: string): number {
  if (window.includes("T")) return WINDOW_MS.minute;
  if (window.length === 7) return WINDOW_MS.month;
  return WINDOW_MS.day;
}

/** Consumption levels worth one line in the log, once each, on the way past. */
const QUOTA_THRESHOLDS = [0.5, 0.8, 0.95] as const;

/**
 * Warn on the call that *crosses* a consumption threshold, not on every call
 * above it.
 *
 * A log that repeats "Alpha Vantage above 80%" twenty times is a log nobody
 * reads. Comparing the count before and after this spend fires each line exactly
 * once per window, which is what makes the warning worth acting on.
 */
export function emitQuotaThreshold(adapter: Adapter, s: Store): void {
  const st = quotaState(adapter, s);
  if (!st || st.limit <= 0) return;
  const before = st.used - 1;
  for (const threshold of QUOTA_THRESHOLDS) {
    const mark = Math.ceil(st.limit * threshold);
    if (before < mark && st.used >= mark) {
      emit({
        level: threshold >= 0.95 ? "error" : "warn",
        source: "Quota",
        message: `${adapter.meta.id} at ${Math.round((st.used / st.limit) * 100)}% of its ${st.window} allowance (${st.used}/${st.limit})`,
        fields: {
          provider: adapter.meta.id,
          used: st.used,
          limit: st.limit,
          window: st.window,
          reserve: st.reserve,
        },
      });
      return;
    }
  }
}
