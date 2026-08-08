"use client";

import { ReactNode } from "react";

/**
 * Region-level enforcement of the stale-context rule.
 *
 * The rule itself has not moved: evidence that does not belong to the current
 * desk context is never presented as if it does. What changed is how long that
 * lasts. With auto-run on, a parameter edit is followed by a sweep within
 * milliseconds, so the gate is a *recomputing* state — the same veil, the same
 * `inert`, but no call to action, because nothing is being asked of the reader.
 *
 * The `stale` mode is the original: the sweep is NOT coming on its own, either
 * because Auto is off or because the last run failed, so the veil has to say so
 * and offer the rerun. Getting this distinction wrong in either direction is a
 * correctness bug — a "recomputing" label over evidence that will never
 * refresh is exactly the silent lie this component exists to prevent.
 *
 * `inert` is the load-bearing part in both modes: blur alone would leave
 * hundreds of focusable heatmap cells and table rows in the tab order.
 *
 * Deliberately no `role="status"` and no autofocus. All five research panels
 * stay mounted (subtabs hide, not unmount), so one gate per panel exists at
 * once — the banner remains the single announcer, and stealing focus mid-edit
 * would be hostile.
 */
export default function StaleGate({
  active,
  mode = "stale",
  running,
  targetSymbol,
  targetInterval,
  onRerun,
  children,
}: {
  active: boolean;
  /** `recomputing` — a run is already on its way. `stale` — it is not. */
  mode?: "stale" | "recomputing";
  running: boolean;
  targetSymbol: string;
  targetInterval: string;
  onRerun: () => void;
  children: ReactNode;
}) {
  const recomputing = mode === "recomputing";
  const className = [
    "stale-gate",
    active && "is-stale",
    active && recomputing && "is-recomputing",
  ].filter(Boolean).join(" ");

  return (
    <div className={className}>
      <div className="stale-gate__content" inert={active} aria-hidden={active || undefined}>
        {children}
      </div>
      {active && (
        <div className="stale-gate__veil">
          <div className="stale-gate__cta">
            {recomputing ? (
              <>
                <span className="page-kicker">Recomputing</span>
                <small>
                  {targetSymbol} · {targetInterval} — this result is replaced as soon as the sweep lands.
                </small>
              </>
            ) : (
              <>
                <span className="page-kicker">Desk context changed</span>
                <button className="primary-action" onClick={onRerun} disabled={running}>
                  {running ? "Running sweep…" : `Rerun sweep for ${targetSymbol} · ${targetInterval}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
