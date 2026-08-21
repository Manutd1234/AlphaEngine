/**
 * The settle behind the Developer tab's health badge.
 *
 * `workspaceState` reads `view.healthError`, a transient the shared 30s poll
 * sets on any failure and clears on any success. Rendered raw, that reading
 * tracks the last packet: a gateway reachable half the time flipped the
 * headline pill between Healthy and Degraded every poll, and on a Vercel
 * build the readiness ladder's Deployment gate flipped the launch verdict
 * between READY and BLOCKED with it, replaying its entrance animation at each
 * turn. Demotion on the first failure is the conservative direction and stays
 * immediate; promotion is what needed the streak.
 *
 * The hysteresis is not written here. `DeskSourceMachine` already owns the
 * asymmetry — demotion immediate, promotion after `PROMOTION_STREAK`
 * consecutive successes — and this class only translates the poll's
 * observable transitions into probe outcomes for it: `updatedAt` moved means
 * a success (`applySnapshot` stamps a fresh Date on every good read), and
 * `healthError` newly set means a failure. A repeated render with an
 * unchanged view observes nothing, so the streak counts polls, never
 * renders.
 *
 * A plain class, deliberately — the same argument as the machine itself: a
 * scripted pass/fail/pass sequence with no DOM is eleven lines of
 * arrange-act-assert. `useWorkspaceHealth` is the thin wrapper, and
 * `tests/developer-stability.test.ts` drives the sequences.
 */

import { DeskSourceMachine, PROMOTION_STREAK } from "@/lib/desk-source";

import type { ControlState } from "./DeveloperStatus";

export class WorkspaceHealthSettle {
  /** The payload is a token: this settle needs the tier, not the snapshot. */
  private readonly machine = new DeskSourceMachine<true>();
  private lastUpdatedAt: Date | null = null;
  private lastFailure: string | null = null;

  /**
   * Record what the current view says, observing only what changed.
   *
   * A success clears the error and bumps `updatedAt` in the same render, and
   * the order below reflects the order it happened in: the good read landed,
   * then there was no failure. A failure never moves `updatedAt`, so the two
   * branches cannot double-count one poll.
   */
  note(updatedAt: Date | null, healthError: string | null): void {
    if (updatedAt !== null && updatedAt !== this.lastUpdatedAt) {
      this.machine.observe({ ok: true, payload: true });
    }
    if (healthError !== null && healthError !== this.lastFailure) {
      this.machine.observe({ ok: false, failure: { message: healthError } });
    }
    this.lastUpdatedAt = updatedAt;
    this.lastFailure = healthError;
  }

  /**
   * True while a poll has failed more recently than `PROMOTION_STREAK`
   * consecutive successes — the machine's `cached` tier, read out as the one
   * bit this badge needs. False on a desk that has never had a good read:
   * with nothing behind it there is nothing to demote from, and the
   * immediate reading already says Degraded with the live reason.
   */
  get demoted(): boolean {
    const { showing } = this.machine.state;
    return showing.kind === "measured" && showing.tier === "cached";
  }
}

/**
 * What the tab renders: the immediate reading, unless the settle is holding.
 *
 * Held only in the one window the raw reading gets wrong — a success has
 * landed but the streak has not — and the detail says exactly that, so the
 * pill is not claiming stale data. While `healthError` is current the
 * immediate state wins even when demoted: a held recovery note must never
 * replace the description of a failure that is happening now.
 */
export function settledWorkspaceState(
  immediate: ControlState,
  demoted: boolean,
  healthError: string | null,
): ControlState {
  if (!demoted || healthError !== null) return immediate;
  return {
    label: "Degraded",
    tone: "bad",
    detail: `The last health read succeeded, but a recent one failed; Healthy returns after ${PROMOTION_STREAK} consecutive good polls, so an intermittent connection settles here rather than alternating with the poll.`,
  };
}
