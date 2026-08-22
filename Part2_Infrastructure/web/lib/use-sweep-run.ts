"use client";

/**
 * The research sweep: the request, the run, the auto-run, and everything
 * derived from the result.
 *
 * Lifted out of `app/dashboard/page.tsx`, where it was roughly 200 lines of a
 * 2,000-line component. Three things live here together because they are one
 * mechanism: `run` (one in-flight request, superseded runs aborted and
 * sequence-guarded), the auto-run that decides whether a settled control
 * deserves a request at all, and the derived reads — `activeResult`,
 * `researchStale`, `sweepIncoming` — that let the UI say which of "current",
 * "stale" and "recomputing" it is showing. Splitting them would put the
 * honesty rule (a stale result is never presented as current) in one file and
 * the thing that makes it stale in another.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceView } from "@/components/WorkspaceHeader";
import {
  addExperiment, loadExperiments, removeExperiment, sameRequest,
  type ExperimentRecord,
} from "@/lib/experiments";
import { fmt } from "@/lib/format";
import { mcSeedFor } from "@/lib/montecarlo";
import { emitPrefChange } from "@/lib/pref-sync-bus";
import { mcDriverDegeneracy } from "@/components/risk/mc-degeneracy";
import seedRunJson from "@/lib/seed-run.json";
import { strategyProgress } from "@/lib/strategy-progress";
import {
  DEFAULT_REQUEST, ParamResult, STRATEGY_LABELS, SweepRequest, SweepResponse,
} from "@/lib/types";

const SEED_RUN = seedRunJson as unknown as SweepResponse;

/**
 * The one way to start a sweep, as the panels that offer a rerun see it.
 *
 * `preserveInspect` keeps a drill-down on screen while the pinned re-run
 * lands; `record` decides whether the run enters the experiment trail, and is
 * false for every auto-run — see the parameter's own note below.
 */
export type RunSweep = (
  override?: Partial<SweepRequest>,
  preserveInspect?: boolean,
  record?: boolean,
) => Promise<void>;

/** Remembers the Auto choice across visits. Off is a deliberate act; it should stick. */
const AUTO_RUN_KEY = "alphaengine.research.autorun";

/**
 * Safety net for the one commit signal the DOM does not give us: a field the
 * user typed into and then abandoned without blurring, pressing Enter, or
 * touching anything else. Long enough that it never races a real `change`,
 * short enough that the result does not feel abandoned. Runs it triggers are
 * deduplicated by `sameRequest`, so firing after a `change` already ran is a
 * no-op rather than a second request.
 */
const IDLE_COMMIT_MS = 700;

/**
 * A sweep slower than this makes auto-run feel worse than the button it
 * replaced, so Auto turns itself off and says why rather than making every
 * subsequent edit wait on a run the user did not ask for.
 */
const AUTO_RUN_BUDGET_MS = 1500;

export function useSweepRun({ view }: { view: WorkspaceView }) {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  // Seeded, clearly-labelled demo run: real bars (committed parity fixture),
  // the real engine, computed ahead of time — so the first paint shows a real
  // verdict and a real OOS Sharpe instead of skeletons. Its warning banner
  // says exactly what it is, and the mount auto-sweep replaces it.
  const [data, setData] = useState<SweepResponse | null>(SEED_RUN);
  const [inspectionData, setInspectionData] = useState<SweepResponse | null>(null);
  const [inspect, setInspect] = useState<ParamResult | null>(null);
  const [running, setRunning] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * An interval the failed request could succeed at, offered as one click.
   *
   * Set only from the 422 short-window response, which is the one failure a
   * user causes by changing a dropdown: free equity tiers hold years of daily
   * history and days of intraday, so MSFT · 4h dies at 6 bars while MSFT · 1d
   * returns 400. The banner offering "Switch to 1d" is the difference between
   * a data limit the reader can step around and what reads as a broken app.
   */
  const [errorFix, setErrorFix] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  // Auto-run state. `autoRun` is the user's switch; `autoSuspended` is the
  // reason we turned it off for them, shown once and cleared when they turn it
  // back on. Hydrated from localStorage in an effect, never during render.
  const [autoRun, setAutoRun] = useState(true);
  const [autoSuspended, setAutoSuspended] = useState<string | null>(null);
  const [resultAnnouncement, setResultAnnouncement] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const runSeq = useRef(0);
  // The request the newest run was started with. `sameRequest` against this is
  // what makes the idle fallback, the `change` commit and ⌘Enter idempotent
  // instead of three requests for one edit.
  const lastRunRequest = useRef<SweepRequest | null>(null);

  const run = useCallback(
    async (
      override?: Partial<SweepRequest>,
      preserveInspect = false,
      /**
       * Whether this run belongs in the experiment trail.
       *
       * Auto-runs pass `false`. `addExperiment` deduplicates by `sameRequest`,
       * so a *re-run* replaces its predecessor — but every auto-run carries
       * DIFFERENT parameters and would therefore be a new record. Dragging one
       * slider across ten values would write ten rows into the panel whose
       * entire purpose is an honest count of how many hypotheses were tried.
       * The trail is populated by an explicit Pin, or by promotion.
       */
      record = true,
    ) => {
      activeRun.current?.abort();
      const controller = new AbortController();
      activeRun.current = controller;
      const sequence = ++runSeq.current;
      const body = { ...req, ...override };
      lastRunRequest.current = body;

      setRunning(true);
      setError(null);
      setErrorFix(null);
      if (!preserveInspect) {
        setInspect(null);
        setInspectionData(null);
      }

      const startedAt = Date.now();
      try {
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) {
          // A 422 short-window response names the interval that would work;
          // remember it so the error banner can offer the fix as an action.
          if (sequence === runSeq.current) {
            setErrorFix(typeof json.suggestedInterval === "string" ? json.suggestedInterval : null);
          }
          throw new Error(json.error ?? `HTTP ${response.status}`);
        }
        if (sequence !== runSeq.current) return;
        const completed = json as SweepResponse;
        if (preserveInspect) {
          setInspectionData(completed);
        } else {
          setData(completed);
          // The dataset hash prevents render noise from masquerading as a new
          // result; the accepted-run sequence distinguishes two real sweeps
          // over the same bars. Replacing the keyed span also guarantees a DOM
          // mutation when two sweeps happen to produce the same sentence.
          setResultAnnouncement({
            key: `${completed.dataHash}:${sequence}`,
            text: `Sweep complete: ${completed.verdict.level.toUpperCase()} — DSR ${fmt(completed.deflatedSharpeRatio, 2)}, ${completed.combosTested} combinations`,
          });
        }
        setResearchDirty(false);
        // Measured end to end, not from the engine's own duration: what makes
        // auto-run unpleasant is the wait the user experiences, which includes
        // the request. A grid this slow stops driving itself.
        if (Date.now() - startedAt > AUTO_RUN_BUDGET_MS && !record) {
          setAutoRun(false);
          setAutoSuspended(
            "That sweep took over 1.5s, so Auto is off. Narrow the grid or run it by hand.",
          );
        }
        // Drill-downs are not hypotheses either. `inspectCombo` re-runs the
        // sweep pinned to one cell to isolate it; recording that would inflate
        // the same count.
        if (record && !preserveInspect) {
          setExperiments((current) => addExperiment(current, json as SweepResponse, Date.now()));
        }
      } catch (runError) {
        if ((runError as Error).name !== "AbortError" && sequence === runSeq.current) {
          setError((runError as Error).message);
          // A failed run leaves the result belonging to the old context with no
          // sweep on its way, which is the hard-stale case — the veil must go
          // back to asking rather than claiming to be recomputing.
          lastRunRequest.current = null;
        }
      } finally {
        if (sequence === runSeq.current) setRunning(false);
      }
    },
    [req],
  );
  const runNow = useCallback(() => void run(), [run]);

  /**
   * The auto-run entry point: a value settled, so run unless something says not to.
   *
   * Skipping a request identical to the one already in flight is what keeps the
   * three commit paths (native `change`, the idle fallback, ⌘Enter) from
   * becoming three requests for one edit.
   */
  const commitRequest = useCallback(() => {
    if (!autoRun) return;
    // A drill-down is a deliberate isolation of one parameter pair, run with
    // `preserveInspect`. An auto-run would replace it with the full sweep and
    // silently undo the thing the user just asked for.
    if (inspect) return;
    if (lastRunRequest.current && sameRequest(lastRunRequest.current, req)) return;
    void run(undefined, false, false);
  }, [autoRun, inspect, req, run]);

  useEffect(() => {
    void run();
    return () => activeRun.current?.abort();
    // The baseline. Every later run comes from a settled control, the idle
    // fallback or an explicit action — never from this effect, which would
    // re-fire on each `run` identity change and fan out network work mid-drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrated in an effect rather than in the initial state. The desk is a
  // client component but is still server-rendered, so reading localStorage
  // during render throws on the server and desynchronises the first paint.
  useEffect(() => {
    setExperiments(loadExperiments());
    try {
      if (window.localStorage.getItem(AUTO_RUN_KEY) === "0") setAutoRun(false);
    } catch {
      // Private browsing or a blocked origin. The default stands.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_RUN_KEY, autoRun ? "1" : "0");
    } catch {
      // Preference is a convenience; failing to persist it must not break the run.
    }
    emitPrefChange(AUTO_RUN_KEY);
  }, [autoRun]);

  /**
   * The idle fallback described at `IDLE_COMMIT_MS`.
   *
   * This is NOT the primary mechanism — the native `change` listener in
   * `Controls` is. It only catches a field left mid-edit with no commit event
   * coming. `commitRequest` short-circuits on `sameRequest`, so on every path
   * where `change` already fired this timer resolves to nothing.
   */
  useEffect(() => {
    if (!autoRun || inspect) return;
    const timer = window.setTimeout(commitRequest, IDLE_COMMIT_MS);
    return () => window.clearTimeout(timer);
  }, [req, autoRun, inspect, commitRequest]);

  /** ⌘/Ctrl+Enter runs the sweep from anywhere, and always records it. */
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "Enter") return;
      if (view !== "research") return;
      event.preventDefault();
      void run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [run, view]);

  const cloneExperiment = useCallback((request: SweepRequest) => {
    setReq(request);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const dropExperiment = useCallback((id: string) => {
    setExperiments((current) => removeExperiment(current, id));
  }, []);

  const updateRequest = useCallback((next: SweepRequest) => {
    setReq(next);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  /**
   * Switching strategy from the doc card's "compare against" links.
   *
   * Shares `updateRequest`'s bookkeeping rather than calling `setReq` directly:
   * a changed strategy invalidates the displayed result exactly as a changed
   * symbol does, and a path that forgot `setResearchDirty` would leave the old
   * sweep on screen under the new strategy's name.
   */
  const updateStrategy = useCallback((strategy: SweepRequest["strategy"]) => {
    setReq((current) => ({ ...current, strategy }));
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const updateSymbol = useCallback((symbol: string) => {
    setReq((current) => ({ ...current, symbol }));
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const inspectCombo = useCallback(
    (result: ParamResult) => {
      setInspect(result);
      void run(
        {
          fastMin: result.fast,
          fastMax: result.fast + 1,
          fastStep: 1,
          slowMin: result.slow,
          slowMax: result.slow + 1,
          slowStep: 1,
          walkForward: false,
        },
        true,
      );
    },
    [run],
  );

  /** Records the displayed result as a hypothesis worth keeping. */
  const pinRun = useCallback(() => {
    if (!data) return;
    setExperiments((current) => addExperiment(current, data, Date.now()));
  }, [data]);

  const activeResult = researchDirty ? null : data;
  const displayedResult = inspectionData ?? data;
  // Drives the region-level gates: stale evidence stays visible under a veil,
  // never silently presented as current.
  const researchStale = researchDirty && Boolean(data);
  /**
   * Whether a sweep for the current context is genuinely on its way. Only then
   * may the veil describe itself as recomputing — with Auto off, or after a
   * failed run, nothing is coming and it has to say so and offer the rerun.
   */
  const sweepIncoming = autoRun && !inspect && !error;
  /**
   * The Risk tab's terminal distribution resamples exactly what the band did.
   *
   * The guard tests the CONTENT of the returns, not merely that there are some.
   * `length` alone shipped a non-null driver whose every element was exactly
   * 0.0 — a combination that never takes a position — and the Risk card then
   * rendered a fully populated, entirely zero distribution as a measured claim
   * of safety. `mc-degeneracy.ts` carries the full trace and owns the
   * predicate; it is imported rather than restated so the source and the card
   * can never disagree about what counts as degenerate.
   */
  const mcDriver = useMemo(() => {
    if (!displayedResult?.bestRunReturns?.length || !displayedResult.dataHash) return null;
    if (mcDriverDegeneracy(displayedResult.bestRunReturns)) return null;
    return {
      returns: displayedResult.bestRunReturns,
      seed: mcSeedFor(displayedResult.dataHash, displayedResult.best.fast, displayedResult.best.slow),
      label: `${STRATEGY_LABELS[displayedResult.request.strategy]} ${displayedResult.best.fast}/${displayedResult.best.slow}`,
      interval: displayedResult.request.interval,
    };
  }, [displayedResult]);
  const currentPinned = useMemo(
    () => data !== null && experiments.some((record) => sameRequest(record.request, data.request)),
    [data, experiments],
  );
  /** For the picker's "— run" marks: same projection the codex renders. */
  const triedStrategies = useMemo(
    () => new Set(strategyProgress(experiments).keys()),
    [experiments],
  );

  // Packed rather than one key per line: this file sits under the same size
  // ceiling page.tsx was split to respect.
  return {
    req, data, inspect, displayedResult, activeResult, running, researchDirty,
    researchStale, sweepIncoming, error, errorFix, experiments, setExperiments,
    autoRun, setAutoRun, autoSuspended, setAutoSuspended, resultAnnouncement,
    run, runNow, commitRequest, updateRequest, updateStrategy, updateSymbol,
    cloneExperiment, dropExperiment, inspectCombo, pinRun, currentPinned,
    triedStrategies, mcDriver,
  };
}
