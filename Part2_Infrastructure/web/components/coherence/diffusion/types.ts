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

export function isAbsorptionRead(payload: unknown): payload is AbsorptionRead {
  return typeof payload === "object" && payload !== null
    && typeof (payload as AbsorptionRead).state === "string"
    && Array.isArray((payload as AbsorptionRead).runs);
}

export function isEventsRead(payload: unknown): payload is EventsRead {
  return typeof payload === "object" && payload !== null
    && typeof (payload as EventsRead).state === "string"
    && Array.isArray((payload as EventsRead).events);
}
