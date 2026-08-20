/**
 * The decision plane — in-process, pushed on the ops snapshot.
 *
 * Split out of `lib/overview-state.ts` when that file passed 585 lines. This is
 * the microsecond figure the gateway publishes for its own decision path, kept
 * strictly apart from the millisecond network latency in `./overview-latency`:
 * the two are different measurements of different things, and the whole point
 * of `DecisionLatencySource` below is that a dash under the decision label must
 * never be quietly filled with the network number.
 *
 * Re-exported by `lib/overview-state.ts`; importers still say
 * `@/lib/overview-state`.
 */

import type { DecisionLatency, HealthSourceState, SystemHealth } from "@/components/systems/types";
import { formatDuration, metricRow } from "@/lib/format";

import {
  formatNetworkCaveat,
  LATENCY_MIN_SAMPLES,
  type LatencyToneKind,
  type LatencyToneResult,
} from "./overview-latency";

export type DecisionEngine = "native" | "python";

export const DECISION_ENGINE_LABEL: Record<DecisionEngine, string> = {
  native: "C++ core",
  python: "Python",
};

/**
 * Which engine this build of the desk expects the gateway to be running.
 * The snapshot can say which engine IS running; it cannot say whether the
 * other one was expected — that is a deployment fact, and this constant
 * carries it. Now "native": the Docker image compiles the core and the
 * deploy confirms it, so a gateway reporting "python" fell back (the .so
 * did not ship) and earns its ▲ mark. Not a fault in correctness — the
 * Python reference is exact and marginally faster end-to-end — but a
 * deployment-integrity signal worth surfacing, since the whole point of
 * running native is to show the nanosecond core figure it produces.
 */
export const DECISION_EXPECTED_ENGINE: DecisionEngine = "native";

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
    return { tone: "muted", label: `collecting, n=${samples}` };
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
  | { kind: "no-orders"; detail: string; core: DecisionCoreSelfMeasure | null }
  | { kind: "measured"; stats: DecisionLatency; stale: boolean };

/**
 * The compiled core's own figure when no order has been decided yet. It exists
 * because the gateway times the battery once at startup on a synthetic
 * two-venue book (`RiskGateway.run_core_self_measure`), so the nanosecond
 * plane is evidence from the first second of the process while the
 * microsecond plane honestly waits for the first order. `selfTestSamples` is
 * how many of the core histogram's samples that self-measure contributed —
 * published so the desk can say where the number came from, never implied.
 */
export interface DecisionCoreSelfMeasure {
  engine: DecisionEngine;
  p50Ns: number | null;
  p99Ns: number;
  maxNs: number | null;
  selfTestSamples: number | null;
}

export function isDecisionLatency(value: unknown): value is DecisionLatency {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const finiteOrNull = (x: unknown) => x === null || x === undefined || (typeof x === "number" && Number.isFinite(x) && x >= 0);
  return (
    (v.engine === "native" || v.engine === "python")
    && typeof v.samples === "number" && Number.isInteger(v.samples) && v.samples >= 0
    && finiteOrNull(v.p50_us) && finiteOrNull(v.p99_us) && finiteOrNull(v.p999_us) && finiteOrNull(v.max_us)
    && finiteOrNull(v.core_p50_ns) && finiteOrNull(v.core_p99_ns) && finiteOrNull(v.core_max_ns)
    && (v.core_self_test_samples === null || v.core_self_test_samples === undefined
      || (typeof v.core_self_test_samples === "number" && Number.isInteger(v.core_self_test_samples) && v.core_self_test_samples >= 0))
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
    return { kind: "no-orders", detail: "no orders yet — quantiles of nothing are not zeros", core: null };
  }
  if (!isDecisionLatency(block)) {
    return { kind: "not-published", detail: "decision_latency failed its contract and was withheld" };
  }
  if (block.samples === 0 || block.p99_us == null) {
    // The µs plane is empty, but the core may already have measured itself.
    const core: DecisionCoreSelfMeasure | null = block.core_p99_ns != null
      ? {
        engine: block.engine,
        p50Ns: block.core_p50_ns ?? null,
        p99Ns: block.core_p99_ns,
        maxNs: block.core_max_ns ?? null,
        selfTestSamples: block.core_self_test_samples ?? null,
      }
      : null;
    return { kind: "no-orders", detail: "no orders yet — quantiles of nothing are not zeros", core };
  }
  return { kind: "measured", stats: block, stale: health.sources?.gateway?.state === "stale" };
}

export interface DecisionChipModel {
  tone: LatencyToneKind;
  headline:
    | { kind: "measured"; p99Us: number; coreP99Ns: number | null }
    | { kind: "collecting" }
    /** No order decided yet, but the compiled core has timed itself at startup. */
    | { kind: "core-only"; coreP99Ns: number }
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
    // Two same-kind latency figures in the chip's mono figure — the one
    // place the separator is a column rule rather than a word.
    const headlineText = headline.kind === "measured"
      ? metricRow([formatDuration(headline.p99Us, "us"), headline.coreP99Ns != null ? `core ${formatDuration(headline.coreP99Ns, "ns")}` : null])
      : headline.kind === "core-only" ? metricRow(["—", `core ${formatDuration(headline.coreP99Ns, "ns")}`])
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
    return finish("muted", { kind: "dash" }, "checking", `${source.detail}; ${networkCaveat}`);
  }
  if (source.kind === "no-gateway") {
    const word = source.state === "not_configured" ? "no gateway" : source.state === "invalid" ? "invalid" : "unreachable";
    return finish("muted", { kind: "dash" }, word, `${source.detail}; ${networkCaveat}`);
  }
  if (source.kind === "not-published") {
    return finish("muted", { kind: "dash" }, "not published", `${source.detail}; ${networkCaveat}`);
  }
  if (source.kind === "no-orders") {
    const core = source.core;
    if (core == null) {
      return finish("muted", { kind: "dash" }, "no orders yet", `${source.detail}; ${networkCaveat}`);
    }
    // The core figure alone: it is real (the compiled battery, timed inside
    // the engine) but its provenance is the startup self-measure, and the
    // title says so before it says anything else.
    const ns = (v: number | null) => formatDuration(v, "ns");
    const caveat = [
      `core p99 ${ns(core.p99Ns)} from the startup self-measure — the compiled battery on a synthetic two-venue book`,
      DECISION_ENGINE_LABEL[core.engine],
      `core p50 ${ns(core.p50Ns)}`,
      `core max ${ns(core.maxNs)}`,
      core.selfTestSamples != null ? `n=${core.selfTestSamples.toLocaleString("en-US")} self-measure samples` : null,
      "decision µs awaits the first order",
      networkCaveat,
    ].filter(Boolean).join("; ");
    return finish("muted", { kind: "core-only", coreP99Ns: core.p99Ns }, "no orders yet", caveat);
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
  ].filter(Boolean).join("; ");

  if (stats.samples < DECISION_MIN_SAMPLES) {
    return finish("muted", { kind: "collecting" }, `${stats.samples}/${DECISION_MIN_SAMPLES}`, caveat);
  }
  return finish(tone.tone, { kind: "measured", p99Us: stats.p99_us!, coreP99Ns: core }, tone.label, caveat);
}
