/**
 * Derivations behind the command-center overview and the header telemetry.
 * ========================================================================
 *
 * Pure functions, no React, no DOM — the components that render these are thin
 * shells, and everything that decides *what* they say is pinned by the node
 * test runner here.
 *
 * The one rule running through this file: every state and every number maps to
 * something the system actually measured. A pipeline stage never invents
 * progress, a latency tone never fires on four samples, and an interval nobody
 * measured never becomes a data point.
 */

import type { DecisionLatency, HealthSourceState, SystemHealth } from "@/components/systems/types";
import { formatDuration } from "@/lib/format";

export type StageId = "data" | "research" | "risk" | "execution";
export type StageState = "ok" | "active" | "attention" | "halted" | "idle";

export interface DecisionStage {
  id: StageId;
  label: string;
  state: StageState;
  /** One line, ellipsised by the renderer. Built only from the inputs. */
  detail: string;
}

/** Scalars only — each field maps 1:1 to existing page state. */
export interface DecisionLoopInputs {
  // data plane (systems)
  healthPresent: boolean;
  healthError: boolean;
  degradedCount: number;
  capabilitiesDown: number;
  quarantineSize: number;
  providersReady: number;
  providersTotal: number;
  // research (page state)
  running: boolean;
  researchStale: boolean;
  verdictLevel: "pass" | "marginal" | "fail" | null;
  // risk (book)
  bookPresent: boolean;
  bookSandbox: boolean;
  bookStale: boolean;
  /**
   * `useBook`'s typed connection state and error code. Before these were
   * threaded through, a gateway 503ing on every poll rendered as "connecting
   * to gateway" forever — failure was indistinguishable from loading.
   */
  bookConnection: "live" | "stale" | "unconfigured" | "error" | null;
  bookErrorCode: string | null;
  /** risk_budget.binding_constraint[1] — utilisation of the tightest limit. */
  riskUtilisation: number | null;
  bindingConstraint: string | null;
  varZone: "green" | "yellow" | "red" | null;
  // execution
  tradingHalted: boolean;
  haltedSymbolCount: number;
  /** Real gateway blotter only — sandbox blotter numbers are generated. */
  fillRate: number | null;
}

/** Same bands RiskWorkspace's budget rows already colour by. */
export const RISK_ATTENTION_UTILISATION = 0.7;
export const RISK_CRITICAL_UTILISATION = 0.9;

/** What the risk/execution stages say when the gateway probe FAILED (vs is loading). */
function gatewayFailureDetail(code: string | null): string {
  switch (code) {
    case "gateway_misconfigured":
      return "gateway misconfigured — see Reliability";
    case "gateway_auth_failed":
      return "gateway auth failed";
    case "gateway_not_configured":
      return "gateway not configured";
    default:
      return "gateway unreachable";
  }
}

export function deriveDecisionLoop(i: DecisionLoopInputs): DecisionStage[] {
  const data: DecisionStage = (() => {
    const base = { id: "data" as const, label: "Data" };
    if (i.healthError && i.healthPresent) {
      return { ...base, state: "attention" as const, detail: "health poll failed — showing last snapshot" };
    }
    if (i.healthError && !i.healthPresent) {
      // A poll that has NEVER succeeded is a failure, not a loading state —
      // the old condition required a prior snapshot before it would say so,
      // which meant a dead data plane read as "checking" forever.
      return { ...base, state: "attention" as const, detail: "data plane unreachable — retrying" };
    }
    if (!i.healthPresent) return { ...base, state: "idle" as const, detail: "checking data plane" };
    if (i.quarantineSize > 0) {
      return { ...base, state: "attention" as const, detail: `${i.quarantineSize} record${i.quarantineSize === 1 ? "" : "s"} quarantined` };
    }
    if (i.capabilitiesDown > 0) {
      return { ...base, state: "attention" as const, detail: `${i.capabilitiesDown} capabilit${i.capabilitiesDown === 1 ? "y" : "ies"} unavailable` };
    }
    if (i.degradedCount > 0) {
      return { ...base, state: "attention" as const, detail: `${i.degradedCount} provider${i.degradedCount === 1 ? "" : "s"} degraded` };
    }
    return { ...base, state: "ok" as const, detail: `${i.providersReady}/${i.providersTotal} providers ready` };
  })();

  const research: DecisionStage = (() => {
    const base = { id: "research" as const, label: "Research" };
    if (i.running) return { ...base, state: "active" as const, detail: "sweep in progress" };
    if (i.researchStale) return { ...base, state: "attention" as const, detail: "context changed — rerun required" };
    if (i.verdictLevel === "pass") return { ...base, state: "ok" as const, detail: "candidate passed the gates" };
    if (i.verdictLevel === "marginal") return { ...base, state: "attention" as const, detail: "verdict marginal" };
    if (i.verdictLevel === "fail") return { ...base, state: "attention" as const, detail: "verdict failed" };
    return { ...base, state: "idle" as const, detail: "no completed run" };
  })();

  const risk: DecisionStage = (() => {
    const base = { id: "risk" as const, label: "Risk" };
    const sandboxSuffix = i.bookSandbox ? " · sandbox book" : "";
    if (!i.bookPresent) {
      if (i.bookConnection === "error") {
        return { ...base, state: "attention" as const, detail: gatewayFailureDetail(i.bookErrorCode) };
      }
      return { ...base, state: "idle" as const, detail: "connecting to gateway" };
    }
    // The halt belongs to execution, but risk owns the decision that fired it.
    if (i.tradingHalted) return { ...base, state: "attention" as const, detail: "kill switch active" };
    if (i.bookStale) return { ...base, state: "attention" as const, detail: "book refresh failing — writes disabled" };
    const util = i.riskUtilisation ?? 0;
    if (i.varZone === "red" || util >= RISK_CRITICAL_UTILISATION) {
      return {
        ...base,
        state: "attention" as const,
        detail: i.varZone === "red" ? "VaR model in the red zone" : `${i.bindingConstraint ?? "limit"} at ${Math.round(util * 100)}%`,
      };
    }
    if (i.varZone === "yellow" || util >= RISK_ATTENTION_UTILISATION) {
      return {
        ...base,
        state: "attention" as const,
        detail: i.varZone === "yellow" ? "VaR model in the yellow zone" : `${i.bindingConstraint ?? "limit"} at ${Math.round(util * 100)}%`,
      };
    }
    return { ...base, state: "ok" as const, detail: `headroom available${sandboxSuffix}` };
  })();

  const execution: DecisionStage = (() => {
    const base = { id: "execution" as const, label: "Execution" };
    if (i.tradingHalted) return { ...base, state: "halted" as const, detail: "trading halted" };
    if (i.haltedSymbolCount > 0) {
      return { ...base, state: "attention" as const, detail: `${i.haltedSymbolCount} symbol${i.haltedSymbolCount === 1 ? "" : "s"} halted` };
    }
    if (!i.bookPresent) {
      if (i.bookConnection === "error") {
        return { ...base, state: "attention" as const, detail: gatewayFailureDetail(i.bookErrorCode) };
      }
      return { ...base, state: "idle" as const, detail: "connecting to gateway" };
    }
    const fill = i.fillRate != null ? ` · ${Math.round(i.fillRate * 100)}% fill` : "";
    return { ...base, state: "ok" as const, detail: `paper gates active${fill}${i.bookSandbox ? " · sandbox" : ""}` };
  })();

  return [data, research, risk, execution];
}

// ---------------------------------------------------------------------------
// Latency tone and chip copy
// ---------------------------------------------------------------------------

/**
 * Nearest-rank p99 at n = 20 is exactly the max — the weakest p99 that is
 * still a distinct observation. Below that the number is theatre ("a p99 over
 * four calls is not a p99" — HealthMatrix).
 */
export const LATENCY_MIN_SAMPLES = 20;
/** Serverless-to-vendor REST hops sit in low hundreds of ms when healthy. */
export const LATENCY_WARN_MS = 400;
/** HealthMatrix's own canonical slow example: "answers but at p99 1.2s". */
export const LATENCY_BAD_MS = 1200;

export type LatencyToneKind = "good" | "warn" | "bad" | "muted";

export interface LatencyToneResult {
  tone: LatencyToneKind;
  label: string;
}

export function latencyTone(p99: number | null, n: number, errorRate = 0): LatencyToneResult {
  if (p99 == null || n < LATENCY_MIN_SAMPLES) {
    return { tone: "muted", label: `warming up · n=${n}` };
  }
  if (errorRate >= 0.25 || p99 >= LATENCY_BAD_MS) return { tone: "bad", label: "slow" };
  if (errorRate > 0.05 || p99 >= LATENCY_WARN_MS) return { tone: "warn", label: "elevated" };
  return { tone: "good", label: "healthy" };
}

/**
 * The network plane, in words, for a title or a tile note.
 *
 * "upstream" rather than "vendors": `globalLatency()` still pools the
 * web→gateway hop (`plane:gateway`) with vendor REST; the wording narrows to
 * "vendors" only once that pool is split. Always says "network, polled" so it
 * can sit beside the in-process decision figure without being mistaken for it.
 */
export function formatNetworkCaveat(
  network: { p99: number | null; n: number; errorRate: number } | null,
  hop?: { p99: number | null; n: number } | null,
): string {
  const parts: string[] = [];
  if (hop && hop.p99 != null && hop.n >= LATENCY_MIN_SAMPLES) {
    parts.push(`desk hop p99 ${formatDuration(hop.p99, "ms")}`);
  }
  if (!network || network.p99 == null || network.n < LATENCY_MIN_SAMPLES) {
    parts.push(`upstream p99 collecting n=${network?.n ?? 0}/${LATENCY_MIN_SAMPLES}`);
  } else {
    parts.push(`upstream p99 ${formatDuration(network.p99, "ms")}`);
    parts.push(`error rate ${Math.round(network.errorRate * 100)}%`);
  }
  parts.push("15-min pool");
  return `network, polled — ${parts.join(" · ")}`;
}

/** The pre-decision chip's copy; retired when the chip headlines the decision plane. */
export function formatLatencyChip(
  latency: { p99: number | null; n: number; errorRate: number } | null,
): { value: string; caveat: string } {
  if (!latency || latency.p99 == null || latency.n < LATENCY_MIN_SAMPLES) {
    return {
      value: "p99 —",
      caveat:
        `warming up — needs ${LATENCY_MIN_SAMPLES}+ measured samples in the shared 15-minute pool `
        + `(n=${latency?.n ?? 0}); every instance's health polls feed the gateway-merged ledger, so this fills`,
    };
  }
  return {
    value: `p99 ${Math.round(latency.p99)}ms`,
    caveat:
      `upstream p99 ${Math.round(latency.p99)}ms · error rate ${Math.round(latency.errorRate * 100)}% · `
      + `rolling 15-minute window, n=${latency.n}`,
  };
}

// ---------------------------------------------------------------------------
// The decision plane — in-process, pushed on the ops snapshot
// ---------------------------------------------------------------------------

export type DecisionEngine = "native" | "python";

export const DECISION_ENGINE_LABEL: Record<DecisionEngine, string> = {
  native: "C++ core",
  python: "Python",
};

/**
 * Which engine this build of the desk expects the gateway to be running.
 * The snapshot can say which engine IS running; it cannot say whether the
 * other one was expected — that is a deployment fact, and this constant
 * carries it. Flipped to "native" in the slice that ships the compiled core,
 * so a gateway that quietly fell back to Python earns its ▲ mark then.
 */
export const DECISION_EXPECTED_ENGINE: DecisionEngine = "python";

/** Same nearest-rank floor as the network p99, one "n/20" vocabulary for both planes. */
export const DECISION_MIN_SAMPLES = LATENCY_MIN_SAMPLES;
/**
 * ceil(0.999 · 1000) = 999: below a thousand samples the p99.9 is the maximum
 * wearing a decimal point (LATENCY_BUDGET §1), so it is withheld until then.
 */
export const DECISION_P999_MIN_SAMPLES = 1000;
/**
 * LATENCY_BUDGET §2: measured p99 ~35 µs on the dev machine, live p99.9 in the
 * low hundreds; §2.2 the tail is hypervisor scheduling, not the code. 200 µs is
 * well clear of the live p99.9 so jitter that lands there does not trip the
 * word — a p99 at 200 is structural (a slow gate, lock contention, an engine
 * that fell back). 100 was rejected as flappy on the shared 2-OCPU shape.
 */
export const DECISION_WARN_US = 200;
/** The top of the doc's own "5–500 µs achievable for the decision" band. */
export const DECISION_BAD_US = 500;

export function decisionTone(p99Us: number | null, samples: number): LatencyToneResult {
  if (p99Us == null || samples < DECISION_MIN_SAMPLES) {
    return { tone: "muted", label: `collecting · n=${samples}` };
  }
  if (p99Us >= DECISION_BAD_US) return { tone: "bad", label: "slow" };
  if (p99Us >= DECISION_WARN_US) return { tone: "warn", label: "elevated" };
  return { tone: "good", label: "healthy" };
}

/**
 * Where the decision figure stands, before anything is formatted.
 *
 * Every branch names its reason so the chip and the tile can render a dash
 * WITH a cause, never a dash the reader has to guess at, and never the
 * network number quietly substituted under the decision label.
 */
export type DecisionLatencySource =
  | { kind: "checking"; detail: string }
  | { kind: "no-gateway"; state: HealthSourceState; detail: string }
  | { kind: "not-published"; detail: string }
  | { kind: "no-orders"; detail: string }
  | { kind: "measured"; stats: DecisionLatency; stale: boolean };

export function isDecisionLatency(value: unknown): value is DecisionLatency {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const finiteOrNull = (x: unknown) => x === null || x === undefined || (typeof x === "number" && Number.isFinite(x) && x >= 0);
  return (
    (v.engine === "native" || v.engine === "python")
    && typeof v.samples === "number" && Number.isInteger(v.samples) && v.samples >= 0
    && finiteOrNull(v.p50_us) && finiteOrNull(v.p99_us) && finiteOrNull(v.p999_us) && finiteOrNull(v.max_us)
    && finiteOrNull(v.core_p50_ns) && finiteOrNull(v.core_p99_ns) && finiteOrNull(v.core_max_ns)
  );
}

export function deriveDecisionLatency(
  health: Pick<SystemHealth, "platform" | "sources"> | null,
): DecisionLatencySource {
  if (!health) return { kind: "checking", detail: "waiting for the first health snapshot" };
  const platform = health.platform;
  if (!platform) {
    const gateway = health.sources?.gateway;
    return {
      kind: "no-gateway",
      state: gateway?.state ?? "unreachable",
      detail: gateway?.detail ?? "no gateway ops snapshot",
    };
  }
  if (!("decision_latency" in platform) || platform.decision_latency === undefined) {
    return { kind: "not-published", detail: "this gateway build does not publish decision_latency" };
  }
  const block = platform.decision_latency;
  if (block === null) {
    return { kind: "no-orders", detail: "no orders yet — quantiles of nothing are not zeros" };
  }
  if (!isDecisionLatency(block)) {
    return { kind: "not-published", detail: "decision_latency failed its contract and was withheld" };
  }
  if (block.samples === 0 || block.p99_us == null) {
    return { kind: "no-orders", detail: "no orders yet — quantiles of nothing are not zeros" };
  }
  return { kind: "measured", stats: block, stale: health.sources?.gateway?.state === "stale" };
}

export interface DecisionChipModel {
  tone: LatencyToneKind;
  headline:
    | { kind: "measured"; p99Us: number; coreP99Ns: number | null }
    | { kind: "collecting" }
    | { kind: "dash" };
  /** The state word beside the dot. */
  state: string;
  /** The title text — MUST name both planes. */
  caveat: string;
  ariaLabel: string;
}

export function formatDecisionChip(
  source: DecisionLatencySource,
  network: { p99: number | null; n: number; errorRate: number } | null,
  hop?: { p99: number | null; n: number } | null,
): DecisionChipModel {
  const networkCaveat = formatNetworkCaveat(network, hop);
  const finish = (
    tone: LatencyToneKind,
    headline: DecisionChipModel["headline"],
    state: string,
    caveat: string,
  ): DecisionChipModel => {
    const headlineText = headline.kind === "measured"
      ? `${formatDuration(headline.p99Us, "us")}${headline.coreP99Ns != null ? ` · core ${formatDuration(headline.coreP99Ns, "ns")}` : ""}`
      : headline.kind === "collecting" ? "collecting" : "—";
    return {
      tone,
      headline,
      state,
      caveat,
      ariaLabel: `Open reliability latency evidence. Decision p99 ${headlineText}; ${state}. ${caveat}`,
    };
  };

  if (source.kind === "checking") {
    return finish("muted", { kind: "dash" }, "checking", `${source.detail} · ${networkCaveat}`);
  }
  if (source.kind === "no-gateway") {
    const word = source.state === "not_configured" ? "no gateway" : source.state === "invalid" ? "invalid" : "unreachable";
    return finish("muted", { kind: "dash" }, word, `${source.detail} · ${networkCaveat}`);
  }
  if (source.kind === "not-published") {
    return finish("muted", { kind: "dash" }, "not published", `${source.detail} · ${networkCaveat}`);
  }
  if (source.kind === "no-orders") {
    return finish("muted", { kind: "dash" }, "no orders yet", `${source.detail} · ${networkCaveat}`);
  }

  const { stats, stale } = source;
  const tone = decisionTone(stats.p99_us, stats.samples);
  const fallback = stats.engine === "python" && DECISION_EXPECTED_ENGINE === "native";
  const d = (v: number | null | undefined) => formatDuration(v, "us");
  const core = stats.core_p99_ns ?? null;
  const caveat = [
    fallback ? "▲ Python fallback — native core not loaded" : null,
    "in-process pre-trade decision",
    DECISION_ENGINE_LABEL[stats.engine],
    `p50 ${d(stats.p50_us)}`,
    `p99 ${d(stats.p99_us)}`,
    `p99.9 ${stats.samples >= DECISION_P999_MIN_SAMPLES ? d(stats.p999_us) : `— (n<${DECISION_P999_MIN_SAMPLES.toLocaleString("en-US")})`}`,
    `max ${d(stats.max_us)}`,
    core != null ? `core p99 ${formatDuration(core, "ns")}` : null,
    `n=${stats.samples.toLocaleString("en-US")} since process start`,
    "excludes kernel and wire",
    stale ? "gateway snapshot stale" : null,
    networkCaveat,
  ].filter(Boolean).join(" · ");

  if (stats.samples < DECISION_MIN_SAMPLES) {
    return finish("muted", { kind: "collecting" }, `${stats.samples}/${DECISION_MIN_SAMPLES}`, caveat);
  }
  return finish(tone.tone, { kind: "measured", p99Us: stats.p99_us!, coreP99Ns: core }, tone.label, caveat);
}

// ---------------------------------------------------------------------------
// Kill-switch gating
// ---------------------------------------------------------------------------

export type KillAction = "halt" | "resume";
export type KillConfirmWord = "HALT" | "RESUME";

export interface KillSwitchGateInput {
  typed: string;
  halted: boolean;
  guard: "token" | "open-dev" | "open-demo" | "locked";
  token: string;
  /** null before the panel's probe of GET /api/gateway/risk has answered. */
  gatewayConnected: boolean | null;
  busy: boolean;
}

export interface KillSwitchGateResult {
  action: KillAction;
  confirmWord: KillConfirmWord;
  armed: boolean;
  canFire: boolean;
  blockedReason: string | null;
}

/**
 * Mirrors the ExecutionHandoff doctrine: the confirmation is the literal typed
 * word, not a second click — a confirm flag the UI sets for itself is not a
 * confirmation. Blocked reasons are ordered from most to least fundamental.
 */
export function killSwitchGate(i: KillSwitchGateInput): KillSwitchGateResult {
  const action: KillAction = i.halted ? "resume" : "halt";
  const confirmWord: KillConfirmWord = i.halted ? "RESUME" : "HALT";
  const armed = i.typed.trim().toUpperCase() === confirmWord;

  let blockedReason: string | null = null;
  if (i.gatewayConnected === false) {
    blockedReason = "The execution gateway is not reachable — there is nothing to halt from here.";
  } else if (i.guard === "locked") {
    blockedReason = "Operator actions are disabled on this deployment.";
  } else if (i.guard === "token" && !i.token.trim()) {
    blockedReason = "Enter the operator token to arm this control.";
  } else if (!armed) {
    blockedReason = `Type ${confirmWord} to arm.`;
  }

  return {
    action,
    confirmWord,
    armed,
    canFire: blockedReason === null && !i.busy,
    blockedReason,
  };
}

// ---------------------------------------------------------------------------
// Latency history (client-side ring fed by the health poll)
// ---------------------------------------------------------------------------

export interface LatencyHistoryPoint {
  /** When this tab observed the sample (poll time). */
  t: number;
  p99: number | null;
  errorRate: number;
  n: number;
  /** Server-side timestamp of the newest underlying sample. */
  lastAt: number | null;
}

export const LATENCY_HISTORY_CAP = 64;

/**
 * Append rules keep the sparkline honest:
 *  - n === 0 is "no traffic in the window", not zero latency — skip.
 *  - an unchanged `lastAt` means no new upstream samples since the last poll;
 *    appending would draw measured-looking stability nobody measured — skip.
 * Failed polls append nothing (the hook retains its last snapshot behind a
 * visible error); fabricating a null observation would be an invented number.
 */
export function appendLatencyHistory(
  history: LatencyHistoryPoint[],
  point: LatencyHistoryPoint,
  cap = LATENCY_HISTORY_CAP,
): LatencyHistoryPoint[] {
  if (point.n === 0) return history;
  const prev = history[history.length - 1];
  if (prev && prev.lastAt != null && prev.lastAt === point.lastAt) return history;
  const next = [...history, point];
  return next.length > cap ? next.slice(next.length - cap) : next;
}

// ---------------------------------------------------------------------------
// Sparkline prep
// ---------------------------------------------------------------------------

/**
 * Stride-sample preserving first and last elements. Picks real points rather
 * than aggregating, so every drawn value is one that actually occurred.
 */
export function downsample(values: number[], maxPoints: number): number[] {
  if (maxPoints < 2 || values.length <= maxPoints) return [...values];
  const out: number[] = [];
  const stride = (values.length - 1) / (maxPoints - 1);
  for (let k = 0; k < maxPoints - 1; k++) out.push(values[Math.round(k * stride)]);
  out.push(values[values.length - 1]);
  return out;
}
