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
