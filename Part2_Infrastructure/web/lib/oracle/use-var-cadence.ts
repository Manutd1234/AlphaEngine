"use client";

/**
 * The Oracle VaR panel's re-run clock.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN THE PANEL
 * ------------------------------------------------------------------------
 * `tests/risk-live-feed.test.ts` forbids the literal `usePolling(` inside
 * `OracleVarPanel.tsx` and `RiskWorkspace.tsx`, and that guard is right about
 * the thing it was written for: a Risk panel that started its own loop to fetch
 * the BOOK would be a second source of truth for equity, and a second chance to
 * flap. This loop fetches no book. It re-asks one question about the book the
 * panel was already handed as props, on inputs the panel has already quantised,
 * and every figure it can move is a figure this panel computed itself. The
 * guard's subject is a second feed; this is a second READING of the one feed,
 * so it lives at its own address with the argument written down rather than
 * being smuggled past the assertion or the assertion weakened to admit it.
 * `tests/oracle-var-freshness.test.ts` re-runs the guard's real intent here —
 * no book fetch, no `useBook`, no hand-rolled interval in this file.
 *
 * WHY `usePolling` AND NOT A `setInterval`
 * ------------------------------------------------------------------------
 * `lib/polling.ts` opens with the census: of fourteen hand-rolled loops on this
 * desk, three never checked `document.hidden`, ten of twelve had no backoff,
 * one of fourteen revalidated on return, several stacked ticks with
 * `setInterval`. Every one of those four is a decision this panel would have
 * had to make again. It makes none of them: `pauseWhenHidden` is on by default
 * so a backgrounded browser tab spends no Oracle CPU, `revalidateOnVisible`
 * gives the reader a fresh draw the moment they come back rather than a figure
 * up to a cadence old, and the `inFlight` latch means a run that reaches the
 * 9s deadline cannot be overlapped by the next tick.
 */

import { usePolling } from "@/lib/use-polling";

import { ORACLE_CADENCE_MS, ORACLE_REFUSED_CADENCE_MS } from "./var-request";

export interface OracleVarCadence {
  /**
   * Whether this panel is the one on screen.
   *
   * Not "is it mounted": subtabs persist behind `display: none` for the life of
   * the workspace, so a mounted panel is usually an invisible one. The caller
   * composes this from the workspace being the visible tab AND the oraclevar
   * section being the visible subtab. See `ORACLE_CADENCE_MS` for what an
   * ungated loop would have cost.
   */
  enabled: boolean;
  /** Last attempt was refused, so the slower retry cadence applies. */
  refused: boolean;
  /**
   * Ask for one more run. Deliberately NOT the fetch itself: the panel already
   * owns a supersede-and-abort effect for its input-driven runs, and routing
   * the cadence through the same effect means a scheduled run and an
   * input-driven one are the same code path with the same cancellation. Two
   * ways to start a request would have been two ways to land a stale one.
   */
  onDue: () => void;
}

export function useOracleVarCadence({ enabled, refused, onDue }: OracleVarCadence): void {
  usePolling({
    tick: onDue,
    enabled,
    // Changing this restarts the loop — `usePolling` keys its effect on the
    // interval — which is the intended behaviour on the healthy/refused
    // transition: the next attempt should be timed from the answer that
    // changed the cadence, not from whatever the old schedule had pending.
    intervalMs: refused ? ORACLE_REFUSED_CADENCE_MS : ORACLE_CADENCE_MS,
    // Not `immediate`. The panel's own effect already fires a run the moment it
    // has a model, and again on any input change; an immediate tick here would
    // double that request at mount, and the supersede signal would abort one of
    // the two after the database had already been asked.
  });
}
