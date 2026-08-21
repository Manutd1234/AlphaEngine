/**
 * What the desk is showing, and why — one machine, every surface.
 * ==============================================================
 *
 * Two hooks decide this independently today, and they disagree about the one
 * question that matters: what a failed poll does to the data already on screen.
 *
 *   `useBook`          leaves `portfolio` alone and raises `error`. The numbers
 *                      stay, the screen says they are stale. Correct.
 *   `useCockpitFeed`   calls `setBook(null)`. The last good book is discarded,
 *                      `mode` falls to `"sandbox"`, and the whole cockpit —
 *                      blotter, alerts, P&L strip, fill quality — swaps to a
 *                      generated desk. On the next successful poll it swaps
 *                      back. At a 4s cadence against a gateway dropping even
 *                      one poll in three, that is a desk visibly alternating
 *                      between real fills and invented ones every few seconds.
 *
 * The second is the defect this module exists to make unrepresentable. It is
 * not a rendering bug and no banner fixes it: generated numbers replacing
 * measured ones is a data-provenance failure that happens to be visible.
 *
 * ── The two rules ──────────────────────────────────────────────────────────
 *
 * **1. Measured data is never replaced by generated data.** Once a probe has
 * succeeded even once, failure demotes `live` to `cached` and stops there.
 * The sandbox is reachable only from a desk that has never had a reading, or
 * by someone clicking Sandbox. `cached` is what most gateway failures deserve:
 * a redeploy, a dropped connection, an Always-Free database that auto-stopped
 * — real numbers from forty seconds ago, carried with their age.
 *
 * **2. Demotion is immediate; promotion is not.** Falling to `cached` on the
 * first failure is the conservative direction — `writesEnabled` is false there,
 * so the desk locks rather than acts on a number it is unsure of. Returning to
 * `live` waits for `promotionStreak` consecutive successes, and that asymmetry
 * is the whole anti-twitch property. A gateway alternating success and failure
 * settles at `cached` and stays there, which is also the honest description of
 * a gateway you can only reach half the time. Without the streak the tier
 * tracks the last packet, so the badge, the order ticket's enabled state and
 * the writes lock all flap on the poll cadence.
 *
 * ── Deliberately not a hook ────────────────────────────────────────────────
 *
 * Same argument as `PollingController` and `ValueThrottle`: a class can be
 * driven by a fake clock and a scripted sequence of probe outcomes with no DOM
 * and no renderer. The oscillation above was unreachable by the unit suite
 * precisely because the decision lived inside a component — every test that
 * could see it had to mount React and simulate a flapping network. Here it is
 * eleven lines of arrange-act-assert. `useDeskSource` is the thin wrapper.
 */

import type { DataTier, TierCause } from "@/lib/data-tier";

/** Which side of the Live/Sandbox control a human pressed. */
export type DeskSource = "live" | "sandbox";

export interface ProbeFailure {
  /** The typed code from the route, when it sent one. */
  code?: string;
  message?: string;
  hint?: string;
}

export type ProbeOutcome<T> =
  | { ok: true; payload: T }
  | { ok: false; failure: ProbeFailure };

/**
 * What the caller should render — a union, so the three cases are exhaustive
 * at the type level rather than three things to remember.
 *
 * `data-tier.ts` makes this argument for `DataTier` itself ("Removing it from
 * the union is what makes those branches a compile error rather than a thing
 * to remember"); this is the same move one level up, for the payload.
 */
export type DeskShowing<T> =
  /** A payload the backend really returned. `tier` says how long ago. */
  | { kind: "measured"; payload: T; tier: "live" | "cached"; lastGoodAt: Date }
  /** Nothing measured to show, and generating one is allowed. */
  | { kind: "generated"; cause: TierCause }
  /**
   * Nothing to show and nothing may be invented: the first probe has not
   * settled yet, or someone pressed Live on a desk that has no reading. The
   * caller renders its own "connecting" or failure card.
   */
  | { kind: "empty"; failure: ProbeFailure | null };

export interface DeskSourceState<T> {
  showing: DeskShowing<T>;
  /**
   * The flat tier, for the badge and for `writesEnabled`.
   *
   * An `empty` desk reports `"sandbox"`. That is the safe reading rather than
   * an accurate one — there is no member meaning "nothing yet", and inventing
   * one would reintroduce the dead-end branch `data-tier.ts` deleted. What
   * matters is that `writesEnabled("sandbox")` is false, so a desk with no
   * reading cannot submit. Anything that needs to tell "nothing yet" from
   * "generated" reads `showing.kind` or `settled`, never this field.
   */
  tier: DataTier;
  cause: TierCause | null;
  /**
   * True once at least one probe has settled.
   *
   * Before it, `tier` is a default and not a finding — a badge that reads
   * "Sandbox; no gateway here" during the first 2.5s probe is asserting a
   * conclusion it has no evidence for, and then contradicting itself when the
   * probe lands. Copy that describes the desk must wait for this.
   */
  settled: boolean;
  lastGoodAt: Date | null;
  /** The human's explicit choice, or null if they have not made one. */
  chosen: DeskSource | null;
  /**
   * Why the gateway is not answering right now, or null while it is.
   *
   * Cleared by any success, so it describes the current condition rather than
   * the worst one ever seen — a panel showing the reason for a failure that
   * has since resolved is how an outage banner outlives its outage.
   */
  failure: ProbeFailure | null;
}

/**
 * Consecutive successes required to return to `live` after a demotion.
 *
 * Two is the minimum that breaks a one-in-two oscillation, and at the book's
 * 15s cadence it costs at most one extra poll of reading `cached` — which is
 * true anyway, since the gateway did just fail. Higher would make a genuinely
 * recovered gateway look broken for longer than it is.
 */
export const PROMOTION_STREAK = 2;

export interface DeskSourceOptions {
  promotionStreak?: number;
  /** Injected so a test can stamp observation times without waiting. */
  now?: () => number;
}

export class DeskSourceMachine<T> {
  private readonly promotionStreak: number;
  private readonly now: () => number;

  private chosenSource: DeskSource | null = null;
  private settledYet = false;
  private lastGood: { payload: T; at: Date } | null = null;
  private lastFailure: ProbeFailure | null = null;
  /** Consecutive successes since the last failure. */
  private successes = 0;
  /**
   * True while a measured payload is being reported as `cached` rather than
   * `live`. Set by any failure that has data behind it, cleared only by a
   * full promotion streak — rule 2.
   */
  private demoted = false;

  constructor({ promotionStreak = PROMOTION_STREAK, now = Date.now }: DeskSourceOptions = {}) {
    this.promotionStreak = Math.max(1, promotionStreak);
    this.now = now;
  }

  /**
   * Record a settled probe.
   *
   * A superseded or cancelled request is not an outcome and must not be passed
   * here: it is neither evidence of health nor of failure, and counting it
   * would move the streak on the strength of a race.
   */
  observe(outcome: ProbeOutcome<T>): void {
    this.settledYet = true;
    if (outcome.ok) {
      this.lastGood = { payload: outcome.payload, at: new Date(this.now()) };
      this.lastFailure = null;
      this.successes += 1;
      if (this.demoted && this.successes >= this.promotionStreak) this.demoted = false;
      return;
    }
    this.lastFailure = outcome.failure;
    this.successes = 0;
    // Only meaningful with data behind it. With none, the desk is not demoted
    // from anything — it has never been live — and `showing` falls to
    // `generated` or `empty` on its own.
    if (this.lastGood) this.demoted = true;
  }

  /** A click on either side of the Live/Sandbox control. Outranks every probe. */
  choose(source: DeskSource): void {
    this.chosenSource = source;
  }

  /**
   * Restore a choice made earlier in this session.
   *
   * Distinct from `choose` only in intent — both make the choice binding — but
   * kept separate so a reader of the call site can tell a restored preference
   * from a fresh click without checking what the argument came from.
   */
  restore(source: DeskSource): void {
    this.chosenSource = source;
  }

  /** Drop the human's choice and let probes decide again. */
  release(): void {
    this.chosenSource = null;
  }

  get state(): DeskSourceState<T> {
    const showing = this.resolve();
    return {
      showing,
      tier: showing.kind === "measured" ? showing.tier : "sandbox",
      cause: showing.kind === "generated" ? showing.cause : null,
      settled: this.settledYet,
      lastGoodAt: this.lastGood?.at ?? null,
      chosen: this.chosenSource,
      failure: this.lastFailure,
    };
  }

  private resolve(): DeskShowing<T> {
    // A chosen sandbox is generated whatever any probe says, and says so.
    if (this.chosenSource === "sandbox") return { kind: "generated", cause: "chosen" };

    // Rule 1, and the reason the cockpit's twitch is unrepresentable here:
    // measured data outranks a generated stand-in in every state but an
    // explicit choice, which is handled above.
    if (this.lastGood) {
      return {
        kind: "measured",
        payload: this.lastGood.payload,
        tier: this.demoted ? "cached" : "live",
        lastGoodAt: this.lastGood.at,
      };
    }

    // Nothing measured, ever. Before the first probe settles there is no
    // finding to report — see `settled`.
    if (!this.settledYet) return { kind: "empty", failure: null };

    // Someone pressed Live on a desk with no reading. Honour it: they asked
    // for the real thing and there isn't one, which is a card, not a fiction.
    if (this.chosenSource === "live") return { kind: "empty", failure: this.lastFailure };

    if (!this.lastFailure) return { kind: "empty", failure: null };

    // `gateway_not_configured` is the deployed workspace's normal state, not a
    // fault; anything else is an incident, and the badge must not imply this
    // desk never had a gateway.
    return {
      kind: "generated",
      cause: this.lastFailure.code === "gateway_not_configured" ? "not-configured" : "incident",
    };
  }
}
