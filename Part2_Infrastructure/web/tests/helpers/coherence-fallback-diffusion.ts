import { SNAPSHOT_NOTE } from "./coherence-fallback-market-base";

export function diffusionEvents() {
  return {
    observed_at: "2026-08-28T12:00:00Z",
    state: "ok",
    backend: "sandbox",
    truncated: false,
    events: [
      {
        source_ref: "sandbox-fomc-2026-07",
        kind: "fomc",
        symbol: "BTCUSDT",
        title: "FOMC statement and press conference",
        release_at: "2026-07-29T18:00:00Z",
        release_at_source: "Federal Reserve calendar",
        release_timing: "scheduled",
        call_at: "2026-07-29T18:30:00Z",
        call_at_source: "Federal Reserve calendar",
        call_offset_min: 30,
        first_seen_at: "2026-07-01T00:00:00Z",
        revised_count: 0,
        scheduled: true,
        verified_at: "2026-07-28T12:00:00Z",
        statement_url: null,
      },
    ],
    reason: SNAPSHOT_NOTE,
  };
}

const HORIZONS = ["1s", "30s", "1m", "2m", "5m", "10m", "15m", "30m"];
const BARS: Array<number | null> = [null, null, 1, 2, 5, 10, 15, 30];
const NO_SUB_MINUTE_SOURCE = "no free bar source resolves a move inside one minute";

function diffusionRun(index: number, stage: "release" | "call") {
  const sign = index % 3 === 0 ? -1 : 1;
  const sigmaPre = 0.00062;
  const refused = index % 4 === 0;
  const terminalSigmas = refused ? 0.85 + (index % 3) * 0.31 : 2.35 + (index % 7) * 0.54;
  const terminal = sign * terminalSigmas * sigmaPre;
  const signalState = refused ? "no_signal" as const : "ok" as const;
  const halfLife = refused ? null : stage === "release" ? 305 + index * 11 : 515 + index * 17;
  // A deterministic permutation, not wall-clock order in different units.
  // Both stage panels therefore expose the clock disagreement they explain.
  const volatilityOrder = stage === "release" ? (index * 7) % 12 : (index * 5 + 3) % 12;
  return {
    run_id: `sandbox-${stage}-${index + 1}`,
    source_ref: `sandbox-fomc-${Math.floor(index / 2) + 1}`,
    symbol: index % 2 ? "ETHUSDT" : "BTCUSDT",
    stage,
    interval: "1m",
    signal_state: signalState,
    signal_reason: refused
      ? `the terminal move is ${terminalSigmas.toFixed(2)} pre-event sigmas, below the floor of 2`
      : null,
    t0: `2026-0${(index % 7) + 1}-28T18:${stage === "release" ? "00" : "30"}:00Z`,
    terminal_return: terminal,
    half_life_s: halfLife,
    half_life_state: refused ? "no_signal" : "ok",
    half_life_vol: refused ? null : 0.2 + volatilityOrder * 0.055,
    control_percentile: refused ? null : 0.12 + ((index * 7 + (stage === "call" ? 2 : 0)) % 10) * 0.08,
    sigma_pre_per_bar: sigmaPre,
    terminal_sigmas: terminalSigmas,
    controls_used: 24,
    measured_horizons: HORIZONS.length - 2,
    of_horizons: HORIZONS.length,
    market_adjusted: true,
    data_hash: `sandbox-${index.toString(16).padStart(4, "0")}`,
    params_version: "sandbox-v1",
    cells: HORIZONS.map((horizon, horizonIndex) => {
      if (horizonIndex < 2) {
        return {
          horizon,
          state: "unavailable" as const,
          abnormal_return: null,
          absorbed: null,
          bars: null,
          reason: NO_SUB_MINUTE_SOURCE,
        };
      }
      const measuredIndex = horizonIndex - 2;
      return {
        horizon,
        state: "ok" as const,
        abnormal_return: terminal * Math.min(1.2, 0.18 + measuredIndex * 0.2),
        absorbed: Math.min(1.08, 0.16 + measuredIndex * (stage === "release" ? 0.2 : 0.16)),
        bars: BARS[horizonIndex],
        reason: null,
      };
    }),
  };
}

export function absorption() {
  const runs = Array.from({ length: 12 }, (_, index) => [
    diffusionRun(index, "release"),
    diffusionRun(index, "call"),
  ]).flat();
  return {
    observed_at: "2026-08-28T12:00:00Z",
    state: "ok",
    backend: "sandbox",
    truncated: false,
    horizons: HORIZONS,
    release_curve: [null, null, 0.16, 0.36, 0.57, 0.78, 0.96, 1.02],
    call_curve: [null, null, 0.12, 0.27, 0.44, 0.62, 0.78, 0.94],
    stages: [
      { stage: "release", measured: 9, no_signal: 3, other: 0, median_half_life_s: 371, median_control_percentile: 0.52, reason: null },
      { stage: "call", measured: 9, no_signal: 3, other: 0, median_half_life_s: 617, median_control_percentile: 0.52, reason: null },
    ],
    runs,
    reason: SNAPSHOT_NOTE,
  };
}

export function findings() {
  return {
    observed_at: "2026-08-28T12:00:00Z",
    state: "ok",
    backend: "sandbox",
    calendar: { verified: 12, of: 12, how: "published calendar", dissent_meetings: 3, dissent_votes: 7 },
    gate: { state: "passed", r_squared: 0.64, floor: 0.50, samples: 24, fact: "stage and rate move explain the control clock", reason: null },
    study: {
      study_id: "sandbox-diffusion-v1",
      conditioning: "statement and press-conference embeddings",
      segment: "macro announcements",
      latent_dim: 8,
      events: 12,
      effective_rank: 5.4,
      centroid_spread: 0.38,
      verdict: "stage explains more than text in the sandbox study",
      verdict_reason: null,
      skill_meetings: 12,
      skill_baseline_r2: 0.41,
      skill_gain: 0.07,
      skill_shuffled_p: 0.04,
      skill_stage_minutes: 4.1,
    },
    findings: [
      { name: "release_clock", question: "Does the statement finish before the conference?", stage: "both", n: 24, t_statistic: 2.71, correlation: -0.46, shuffled_p: 0.031, verdict: "holds", note: null },
      { name: "control_rank", question: "Is absorption faster than matched no-news windows?", stage: "both", n: 24, t_statistic: 3.18, correlation: 0.52, shuffled_p: 0.018, verdict: "holds", note: null },
      { name: "text_increment", question: "Does text add timing skill beyond stage and rate move?", stage: "both", n: 12, t_statistic: 1.84, correlation: 0.29, shuffled_p: 0.071, verdict: "not_assessable", note: "The sandbox sample is deliberately small." },
    ],
    reason: SNAPSHOT_NOTE,
  };
}
