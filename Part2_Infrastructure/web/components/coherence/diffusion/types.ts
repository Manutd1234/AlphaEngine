/** The wire shapes the diffusion panes read, mirroring `schemas_diffusion.py`. */

export type ReadState = "ok" | "unconfigured" | "unavailable" | "unreadable";
export type CellState = "ok" | "pending" | "uncaptured" | "insufficient" | "unavailable";
export type SignalState = "ok" | "no_signal" | "insufficient_pre_window" | "unavailable";

export interface HorizonCell {
  horizon: string;
  state: CellState;
  abnormal_return: number | null;
  absorbed: number | null;
  bars: number | null;
  reason: string | null;
}

export interface StageRun {
  run_id: string;
  source_ref: string;
  symbol: string;
  stage: "release" | "call";
  interval: string;
  signal_state: SignalState;
  signal_reason: string | null;
  t0: string;
  terminal_return: number | null;
  half_life_s: number | null;
  half_life_state: string | null;
  half_life_vol: number | null;
  control_percentile: number | null;
  /** The pre-event scale the floor judged against: one bar's return sigma over the sessions before t0. */
  sigma_pre_per_bar: number | null;
  /**
   * The terminal move in those sigmas — the number the floor compared with 2.
   * Computed on the gateway from its own formula; the desk reads it and never
   * re-derives it. Null when there was no scale to judge by.
   */
  terminal_sigmas: number | null;
  controls_used: number;
  measured_horizons: number;
  of_horizons: number;
  market_adjusted: boolean;
  data_hash: string | null;
  params_version: string;
  cells: HorizonCell[];
}

export interface StageSummary {
  stage: "release" | "call";
  measured: number;
  no_signal: number;
  other: number;
  median_half_life_s: number | null;
  median_control_percentile: number | null;
  reason: string | null;
}

export interface AbsorptionRead {
  observed_at: string;
  state: ReadState;
  backend: string | null;
  truncated: boolean;
  horizons: string[];
  release_curve: (number | null)[];
  call_curve: (number | null)[];
  stages: StageSummary[];
  runs: StageRun[];
  reason: string | null;
}

export interface DiffusionEvent {
  source_ref: string;
  kind: "earnings" | "fomc" | "macro";
  symbol: string | null;
  title: string;
  release_at: string;
  release_at_source: string;
  release_timing: string | null;
  call_at: string | null;
  call_at_source: string | null;
  call_offset_min: number | null;
  first_seen_at: string;
  revised_count: number;
  scheduled: boolean;
  verified_at: string | null;
  statement_url: string | null;
}

export interface EventsRead {
  observed_at: string;
  state: ReadState;
  backend: string | null;
  truncated: boolean;
  events: DiffusionEvent[];
  reason: string | null;
}

/**
 * The four members of `ReadState`, as a runtime set.
 *
 * `typeof state === "string"` — which is what these guards and all three proxy
 * routes asserted until 2026-08-26 — accepts any string, so a state RENAMED on
 * the Python side arrives intact and every `state === "ok"` comparison in the
 * panes silently takes its else-branch. That reads as "nothing here" rather
 * than as a mismatch, which is the one sentence this field exists to prevent.
 *
 * Tightened rather than left open because the vocabulary is closed by
 * convention here: `DiffusionEventResponse` needed a fifth member and was
 * given its OWN Literal (`schemas_diffusion.py:72`) instead of growing
 * `ReadState`. A new read state is therefore a new type, not a new member, and
 * failing loudly on an unrecognised one costs nothing a forward-compatible
 * change would have wanted.
 */
const READ_STATES: readonly string[] = ["ok", "unconfigured", "unavailable", "unreadable"];

export function isReadState(value: unknown): value is ReadState {
  return typeof value === "string" && READ_STATES.includes(value);
}

export function isAbsorptionRead(payload: unknown): payload is AbsorptionRead {
  return typeof payload === "object" && payload !== null
    && isReadState((payload as AbsorptionRead).state)
    && Array.isArray((payload as AbsorptionRead).runs);
}

export function isEventsRead(payload: unknown): payload is EventsRead {
  return typeof payload === "object" && payload !== null
    && isReadState((payload as EventsRead).state)
    && Array.isArray((payload as EventsRead).events);
}

/**
 * The third read, which had no guard at all until the routes were wired to
 * these. `findings` carries `Field(default_factory=list)` on the Python side
 * (`schemas_diffusion.py:213`), so it is present on every state including
 * `unconfigured` — checking it is safe for an unconfigured store, not just an
 * `ok` one.
 */
export function isFindingsRead(payload: unknown): payload is FindingsRead {
  return typeof payload === "object" && payload !== null
    && isReadState((payload as FindingsRead).state)
    && Array.isArray((payload as FindingsRead).findings);
}

export interface Finding {
  name: string;
  question: string;
  stage: "release" | "call" | "both";
  n: number;
  t_statistic: number | null;
  correlation: number | null;
  shuffled_p: number | null;
  verdict: "holds" | "absent" | "not_assessable";
  note: string | null;
}

export interface CalendarCheck {
  verified: number;
  of: number;
  how: string;
  dissent_meetings: number;
  dissent_votes: number;
}

export interface GateCheck {
  state: "passed" | "failed" | "not_assessable";
  r_squared: number | null;
  floor: number;
  samples: number;
  fact: string;
  reason: string | null;
}

export interface DiffusionStudy {
  study_id: string;
  conditioning: string;
  segment: string | null;
  latent_dim: number;
  events: number;
  effective_rank: number | null;
  centroid_spread: number | null;
  verdict: string | null;
  verdict_reason: string | null;
  /** Meetings behind the out-of-sample estimate below. */
  skill_meetings: number;
  /**
   * Out-of-sample R² for the absorption clock from the stage and the rate move
   * alone. Read first: a text null measured against an unpredictable target is
   * not a finding about the text.
   */
  skill_baseline_r2: number | null;
  /** What the text adds to that. Negative means reading it made things worse. */
  skill_gain: number | null;
  skill_shuffled_p: number | null;
  /** How much slower the press conference is than the statement, in minutes. */
  skill_stage_minutes: number | null;
}

export interface FindingsRead {
  observed_at: string;
  state: ReadState;
  backend: string | null;
  calendar: CalendarCheck | null;
  gate: GateCheck | null;
  study: DiffusionStudy | null;
  findings: Finding[];
  reason: string | null;
}
