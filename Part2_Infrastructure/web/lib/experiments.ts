"use client";

/**
 * Experiment history — the log a researcher runs against.
 * =======================================================
 *
 * Quant research is a search, and a search you cannot review is a search you
 * repeat. Without a record, three things happen every week: the same
 * hypothesis gets re-tested because nobody remembers it failed; the best of
 * forty runs gets reported as if it were the first; and a promising result is
 * lost because the tab was closed.
 *
 * The second of those is the dangerous one, and it is why this file records the
 * *count* as prominently as the results. A Deflated Sharpe prices the search
 * *within* one sweep — the combinations that sweep tried. It cannot price the
 * search *across* sweeps: forty runs over forty hypotheses is itself a
 * multiple-testing problem, and the DSR of the winner does not know the other
 * thirty-nine happened. The history panel says so, because a tool that silently
 * accumulates attempts while displaying per-attempt significance is actively
 * misleading.
 *
 * ── Storage ─────────────────────────────────────────────────────────────────
 * `localStorage`, matching the only other persistence in this app (the theme
 * key). A **projection** is stored, never the response: `series` runs to ~700
 * points and `results` to 400 rows, so a handful of full responses would exhaust
 * the ~5MB quota and start throwing. Every access is wrapped, because storage
 * throws rather than returning null in private-browsing modes, and losing the
 * history must never take the page down with it.
 */

import type {
  CellKind,
  Direction,
  Strategy,
  SweepRequest,
  SweepResponse,
} from "./types";

export const STORAGE_KEY = "alphaengine-experiments";

/** Bounded so a long research session cannot walk into the storage quota. */
export const MAX_RECORDS = 60;

export interface ExperimentRecord {
  id: string;
  savedAt: number;
  symbol: string;
  interval: string;
  strategy: Strategy;
  direction: Direction;
  bars: number;
  periodStart: string;
  periodEnd: string;
  combosTested: number;
  fast: number;
  slow: number;
  sharpe: number;
  totalReturn: number;
  maxDrawdown: number;
  trades: number;
  deflatedSharpeRatio: number;
  walkForwardOosSharpe: number | null;
  medianEfficiency: number | null;
  stabilityKind: CellKind | null;
  alphaTStat: number | null;
  verdict: "pass" | "marginal" | "fail";
  promotionPassed: number;
  promotionTotal: number;
  /** True when any friction beyond flat fee/slippage was modelled. */
  modelledFrictions: boolean;
  /** Enough to reproduce the run exactly. */
  request: SweepRequest;
}

/** Reduce a full response to the projection worth keeping. */
export function toRecord(data: SweepResponse, id: string, savedAt: number): ExperimentRecord {
  return {
    id,
    savedAt,
    symbol: data.request.symbol,
    interval: data.request.interval,
    strategy: data.request.strategy,
    direction: data.request.direction,
    bars: data.bars,
    periodStart: data.periodStart,
    periodEnd: data.periodEnd,
    combosTested: data.combosTested,
    fast: data.best.fast,
    slow: data.best.slow,
    sharpe: data.best.sharpe,
    totalReturn: data.best.totalReturn,
    maxDrawdown: data.best.maxDrawdown,
    trades: data.best.trades,
    deflatedSharpeRatio: data.deflatedSharpeRatio,
    walkForwardOosSharpe: data.walkForwardOosSharpe,
    medianEfficiency: data.walkForwardReport?.medianEfficiency ?? null,
    stabilityKind: data.stability?.best?.kind ?? null,
    alphaTStat: data.factors?.regression.alphaTStat ?? null,
    verdict: data.verdict.level,
    promotionPassed: data.promotion?.passed ?? 0,
    promotionTotal: data.promotion?.total ?? 0,
    modelledFrictions: !(data.costs?.flatOnly ?? true),
    request: data.request,
  };
}

function isRecord(value: unknown): value is ExperimentRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ExperimentRecord>;
  return typeof r.id === "string" && typeof r.savedAt === "number" && typeof r.symbol === "string";
}

/**
 * Read the history.
 *
 * Every failure mode collapses to "no history": storage disabled, quota errors
 * on read, a half-written value from a previous tab, a schema from an older
 * deploy. A research log is a convenience, and a convenience that can break the
 * page it lives on is not one.
 */
export function loadExperiments(): ExperimentRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRecord).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

/** Persist, newest first, bounded. Returns what was actually stored. */
export function saveExperiments(records: ExperimentRecord[]): ExperimentRecord[] {
  const bounded = records.slice(0, MAX_RECORDS);
  if (typeof window === "undefined") return bounded;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Quota or a disabled store. The in-memory list still works for this
    // session; silently degrading beats an error dialog over a research log.
  }
  return bounded;
}

/**
 * Sequential id, continuing from whatever is already stored.
 *
 * Deliberately not a timestamp or a random string: a researcher refers to these
 * out loud and in writing ("the 92 run"), and `EXP-092` survives that where
 * `run_1785829993528` does not.
 */
export function nextId(existing: ExperimentRecord[]): string {
  const highest = existing.reduce((max, r) => {
    const n = Number(/^EXP-(\d+)$/.exec(r.id)?.[1] ?? 0);
    return n > max ? n : max;
  }, 0);
  return `EXP-${String(highest + 1).padStart(3, "0")}`;
}

/**
 * Two runs are "the same experiment" when the request is identical.
 *
 * Used to replace rather than append on a re-run, so pressing the button twice
 * does not inflate the attempt count — which would corrupt the one number this
 * panel exists to keep honest.
 */
export function sameRequest(a: SweepRequest, b: SweepRequest): boolean {
  const keys = Object.keys({ ...a, ...b }) as (keyof SweepRequest)[];
  return keys.every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

export function addExperiment(
  existing: ExperimentRecord[],
  data: SweepResponse,
  now: number,
): ExperimentRecord[] {
  const duplicate = existing.find((r) => sameRequest(r.request, data.request));
  const id = duplicate ? duplicate.id : nextId(existing);
  const record = toRecord(data, id, now);
  const rest = existing.filter((r) => r.id !== id);
  return saveExperiments([record, ...rest]);
}

export function removeExperiment(
  existing: ExperimentRecord[],
  id: string,
): ExperimentRecord[] {
  return saveExperiments(existing.filter((r) => r.id !== id));
}

export function clearExperiments(): ExperimentRecord[] {
  return saveExperiments([]);
}
