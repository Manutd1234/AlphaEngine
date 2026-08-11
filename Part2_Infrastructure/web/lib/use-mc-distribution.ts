/**
 * Runs the terminal-distribution Monte Carlo off the main thread.
 *
 * The worker is constructed from a Blob of the stringified simulation factory
 * (see lib/mc-distribution.ts for why bundled worker entries are not an
 * option under Turbopack). If constructing it throws (a locked-down webview,
 * a CSP that bans blob workers), the same simulation runs on the main thread
 * in small chunks with a yield between them — slower and honest about it via
 * `engine`, never a different answer: chunk boundaries do not change the draw
 * stream, and both paths execute the same factory.
 */

import { useEffect, useRef, useState } from "react";

import {
  createMcSimulation,
  mcWorkerSource,
  type McDistributionRequest,
  type McDistributionResult,
  type McWorkerMessage,
} from "@/lib/mc-distribution";

export interface McDistributionState {
  status: "idle" | "running" | "done" | "error";
  progress: { done: number; total: number } | null;
  result: McDistributionResult | null;
  error: string | null;
  engine: "worker" | "main-thread" | null;
}

const IDLE: McDistributionState = {
  status: "idle",
  progress: null,
  result: null,
  error: null,
  engine: null,
};

/** Chunk size for the fallback path — small enough to keep the frame budget. */
const FALLBACK_CHUNK = 1_000;

export function useMcDistribution(request: McDistributionRequest | null): McDistributionState {
  const [state, setState] = useState<McDistributionState>(IDLE);
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    if (!request || request.returns.length === 0 || !Number.isFinite(request.equity)) {
      setState(IDLE);
      return;
    }
    setState({ status: "running", progress: { done: 0, total: request.paths }, result: null, error: null, engine: "worker" });

    let worker: Worker | null = null;
    let workerUrl: string | null = null;
    let cancelled = false;

    const finish = (result: McDistributionResult, engine: "worker" | "main-thread") => {
      if (current !== generation.current) return;
      setState({ status: "done", progress: null, result, error: null, engine });
    };
    const fail = (error: string, engine: "worker" | "main-thread") => {
      if (current !== generation.current) return;
      setState({ status: "error", progress: null, result: null, error, engine });
    };

    const runFallback = async () => {
      if (current !== generation.current) return;
      setState((prev) => ({ ...prev, engine: "main-thread" }));
      try {
        const sim = createMcSimulation(request);
        while (sim.done < sim.total) {
          if (cancelled || current !== generation.current) return;
          sim.step(FALLBACK_CHUNK);
          setState((prev) =>
            prev.status === "running"
              ? { ...prev, progress: { done: sim.done, total: sim.total } }
              : prev);
          // One macrotask between chunks keeps input handling alive.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        finish(sim.finish(), "main-thread");
      } catch (err) {
        fail(err instanceof Error ? err.message : "The simulation failed.", "main-thread");
      }
    };

    try {
      workerUrl = URL.createObjectURL(new Blob([mcWorkerSource()], { type: "text/javascript" }));
      worker = new Worker(workerUrl);
      worker.onmessage = (event: MessageEvent<McWorkerMessage>) => {
        if (current !== generation.current) return;
        const message = event.data;
        if (message.type === "progress") {
          setState((prev) =>
            prev.status === "running"
              ? { ...prev, progress: { done: message.done, total: message.total } }
              : prev);
        } else if (message.type === "result") {
          finish(message.result, "worker");
        } else {
          fail(message.error, "worker");
        }
      };
      worker.onerror = () => {
        worker?.terminate();
        worker = null;
        void runFallback();
      };
      worker.postMessage(request);
    } catch {
      void runFallback();
    }

    return () => {
      cancelled = true;
      worker?.terminate();
      if (workerUrl) URL.revokeObjectURL(workerUrl);
    };
  }, [request]);

  return state;
}
