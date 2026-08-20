"use client";

/**
 * Everything the Research tab has to say before it shows a result.
 *
 * Four conditions, four sentences, and each one carries its own exit rather
 * than asking the reader to go and find it. They are grouped here because they
 * share one rule: an empty or unavailable result is REPORTED, never hidden —
 * a failed sweep, a coerced dataset, an Auto switch we turned off, and a
 * result that no longer belongs to the desk's context are all things the
 * reader has to be told before they read a number.
 */

import type { RunSweep } from "@/lib/use-sweep-run";
import type { SweepRequest, SweepResponse } from "@/lib/types";

export interface ResearchBannersProps {
  req: SweepRequest;
  data: SweepResponse | null;
  /** The failed run's message, and the interval a 422 said would have worked. */
  error: string | null;
  errorFix: string | null;
  /** Why Auto turned itself off, shown once and cleared when it is turned back on. */
  autoSuspended: string | null;
  researchDirty: boolean;
  /** Whether a sweep for the current context is genuinely on its way. */
  sweepIncoming: boolean;
  updateRequest: (next: SweepRequest) => void;
  run: RunSweep;
  onResumeAuto: () => void;
  onInspectDataHealth: () => void;
}

export default function ResearchBanners({
  req,
  data,
  error,
  errorFix,
  autoSuspended,
  researchDirty,
  sweepIncoming,
  updateRequest,
  run,
  onResumeAuto,
  onInspectDataHealth,
}: ResearchBannersProps) {
  return (
    <>
      {error && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div>
            <strong>Sweep failed.</strong> {error}
            {errorFix && (
              // Same idiom as "Inspect data health →" one banner down:
              // the fix is a click, not a sentence asking for one. The
              // run is explicit — `updateRequest` alone would leave the
              // rerun to the Auto toggle, and this button says "rerun".
              <button
                className="text-action"
                onClick={() => {
                  updateRequest({ ...req, interval: errorFix });
                  void run({ interval: errorFix });
                }}
              >
                Switch to {errorFix} and rerun →
              </button>
            )}
          </div>
        </div>
      )}
      {data && data.warnings.length > 0 && (
        /* One banner however many warnings the run returned. They are
           all about the same bars — which provider answered, what was
           coerced, whether the series was generated — and they all have
           the same answer: Data ▸ Trust Summary. Stacking N banners
           repeated the identical button N times at the same moment. */
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            {data.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
            <button className="text-action" onClick={onInspectDataHealth}>Inspect data health →</button>
          </div>
        </div>
      )}
      {autoSuspended && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>{autoSuspended}</div>
          <button onClick={onResumeAuto}>Turn Auto back on</button>
        </div>
      )}
      {/* Only when nothing is coming on its own. With Auto on, a run is
          already in flight within a few hundred milliseconds and this
          would be a call to action for something already happening. */}
      {researchDirty && data && !sweepIncoming && (
        /* Announcement only. Under exactly this condition the stale
           veil's "Rerun sweep" already stands on every gated section
           and the rail's "Run now" survives any scroll — a third
           trigger for the same run() at the same moment was the shape
           the Controls pass already removed once. "Run now" is named
           so the ungated sections (runs, codex) still point somewhere. */
        <div className="banner context-change" role="status">
          <span aria-hidden>↻</span>
          <div>
            <strong>Desk context changed.</strong> The result below belongs to {data.request.symbol} at {data.request.interval}.
            Use Run now to refresh it for {req.symbol} at {req.interval}.
          </div>
        </div>
      )}
    </>
  );
}
