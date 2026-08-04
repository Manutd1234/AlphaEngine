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
  /**
   * Content hash of the bars the run actually saw.
   *
   * `periodStart`/`periodEnd` describe a window, not a dataset: a revised bar,
   * a different venue or the synthetic fallback all produce the same window
   * with different numbers. Two records sharing this hash provably compared the
   * same prices; two that do not are not comparable however alike they look.
   * Optional because runs recorded before it existed cannot be back-filled with
   * anything honest.
   */
  dataHash?: string | null;
  /**
   * Fraction of walk-forward folds whose in-sample winner placed in the worse
   * half of the same grid out-of-sample.
   */
  overfittingProbability?: number | null;
  /** Free-text note a researcher attaches after the fact. */
  note?: string;
  /**
   * Labels a researcher applies — universe, regime, hypothesis family.
   *
   * Deliberately on the record and never on the request: `sameRequest` compares
   * request fields with scalar equality, so an array there would make every
   * re-run look like a new experiment and inflate the attempt count this panel
   * exists to keep honest.
   */
  tags?: string[];
  /** Where the record came from — this browser, or the gateway's audit log. */
  origin?: "browser" | "gateway";
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
    dataHash: data.dataHash ?? null,
    overfittingProbability: data.walkForwardReport?.overfittingProbability ?? null,
    origin: "browser",
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
  // A re-run replaces its predecessor, but the researcher's own annotations
  // are about the hypothesis, not the execution — losing them on every re-run
  // would train people not to write any.
  if (duplicate) {
    record.note = duplicate.note;
    record.tags = duplicate.tags;
  }
  const rest = existing.filter((r) => r.id !== id);
  return saveExperiments([record, ...rest]);
}

/** Attach or replace a researcher's note and tags on one record. */
export function annotateExperiment(
  existing: ExperimentRecord[],
  id: string,
  annotation: { note?: string; tags?: string[] },
): ExperimentRecord[] {
  return saveExperiments(existing.map((record) => (
    record.id === id
      ? {
        ...record,
        note: annotation.note?.trim() ? annotation.note.trim().slice(0, 400) : undefined,
        tags: annotation.tags?.length
          ? [...new Set(annotation.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 8)
          : undefined,
      }
      : record
  )));
}

/**
 * What differs between two runs, and whether they are even comparable.
 *
 * The comparability question comes first. Two runs on different bars can differ
 * in Sharpe for reasons that have nothing to do with the parameters, so the
 * data hash is checked before any metric delta is worth reading.
 */
export interface RunComparison {
  sameData: boolean | null;
  requestDiffs: Array<{ field: string; a: unknown; b: unknown }>;
  metricDeltas: Array<{ metric: string; a: number | null; b: number | null; delta: number | null }>;
}

export function compareRuns(a: ExperimentRecord, b: ExperimentRecord): RunComparison {
  const keys = [...new Set([...Object.keys(a.request), ...Object.keys(b.request)])] as (keyof SweepRequest)[];
  const requestDiffs = keys
    .filter((k) => (a.request[k] ?? null) !== (b.request[k] ?? null))
    .map((k) => ({ field: String(k), a: a.request[k] ?? null, b: b.request[k] ?? null }));

  const metrics: Array<[string, number | null, number | null]> = [
    ["Sharpe", a.sharpe, b.sharpe],
    ["Deflated Sharpe", a.deflatedSharpeRatio, b.deflatedSharpeRatio],
    ["OOS Sharpe", a.walkForwardOosSharpe, b.walkForwardOosSharpe],
    ["Max drawdown", a.maxDrawdown, b.maxDrawdown],
    ["Total return", a.totalReturn, b.totalReturn],
    ["Trades", a.trades, b.trades],
    ["Gates passed", a.promotionPassed, b.promotionPassed],
  ];

  return {
    // Null, not false, when either run predates fingerprinting: "unknown" and
    // "different" would prompt opposite conclusions from the reader.
    sameData: a.dataHash && b.dataHash ? a.dataHash === b.dataHash : null,
    requestDiffs,
    metricDeltas: metrics.map(([metric, av, bv]) => ({
      metric,
      a: av,
      b: bv,
      delta: av === null || bv === null ? null : bv - av,
    })),
  };
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
