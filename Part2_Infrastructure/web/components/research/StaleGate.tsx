"use client";

import { ReactNode } from "react";

/**
 * Region-level enforcement of the stale-context rule.
 *
 * The banner at the top of the research view announces that the desk context
 * changed; this gate makes the consequence physical — stale evidence is
 * blurred, uninteractive and out of the accessibility tree until the sweep is
 * rerun. `inert` is the load-bearing part: blur alone would leave hundreds of
 * focusable heatmap cells and table rows in the tab order.
 *
 * Deliberately no `role="status"` and no autofocus. All five research panels
 * stay mounted (subtabs hide, not unmount), so one gate per panel exists at
 * once — the banner remains the single announcer, and stealing focus mid-edit
 * would be hostile.
 */
export default function StaleGate({
  active,
  running,
  targetSymbol,
  targetInterval,
  onRerun,
  children,
}: {
  active: boolean;
  running: boolean;
  targetSymbol: string;
  targetInterval: string;
  onRerun: () => void;
  children: ReactNode;
}) {
  return (
    <div className={active ? "stale-gate is-stale" : "stale-gate"}>
      <div className="stale-gate__content" inert={active} aria-hidden={active || undefined}>
        {children}
      </div>
      {active && (
        <div className="stale-gate__veil">
          <div className="stale-gate__cta">
            <span className="page-kicker">Desk context changed</span>
            <button className="primary-action" onClick={onRerun} disabled={running}>
              {running ? "Running sweep…" : `Rerun sweep for ${targetSymbol} · ${targetInterval}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
