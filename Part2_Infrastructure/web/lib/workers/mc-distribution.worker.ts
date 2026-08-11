/**
 * Dedicated worker for the Risk tab's terminal-distribution Monte Carlo. All
 * math lives in `lib/mc-distribution.ts`; this file only steps the simulation
 * and posts progress so 10k+ paths never touch the main thread.
 */

import {
  createMcSimulation,
  type McDistributionRequest,
  type McWorkerMessage,
} from "../mc-distribution";

/** Progress cadence in paths — small enough to animate, large enough to be free. */
const CHUNK = 500;

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<McDistributionRequest>) => void) | null;
  postMessage: (message: McWorkerMessage) => void;
};

ctx.onmessage = (event) => {
  try {
    const sim = createMcSimulation(event.data);
    while (sim.done < sim.total) {
      sim.step(CHUNK);
      ctx.postMessage({ type: "progress", done: sim.done, total: sim.total });
    }
    ctx.postMessage({ type: "result", result: sim.finish() });
  } catch (err) {
    ctx.postMessage({
      type: "error",
      error: err instanceof Error ? err.message : "The simulation failed.",
    });
  }
};
