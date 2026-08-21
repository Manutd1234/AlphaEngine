/**
 * Whether a streaming venue is live, with hysteresis.
 * ==================================================
 *
 * `useLiveBook` decided this inline, as a pure function of the clock:
 *
 *     status: s.status === "live" && s.updates > 0 && now - s.lastUpdate > STALE_AFTER_MS
 *       ? "stale" : s.status
 *
 * recomputed on every publish tick — 3.3 times a second — against a single hard
 * 8s threshold, with `onBook` setting the status straight back to `"live"` on
 * any arriving update. For a venue whose book updates at roughly the threshold
 * (a thin instrument, a quiet hour, a throttled feed) that is an oscillator:
 * silent past 8s reads stale, the next frame reads live, silence past 8s reads
 * stale again, and the venue-status strip flips several times a minute.
 *
 * It is not only a badge. `useLiveBook` merges only the venues it currently
 * calls live — `venueStates.filter((s) => s.status === "live" && s.book.ok)` —
 * so the consolidated book that prices an order gains and loses a side of
 * liquidity on the same flip, and the mid, spread and depth tiles move with it.
 * A twitching badge and a twitching price are the same defect seen twice.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 *
 * The same asymmetry `DeskSourceMachine` uses, for the same reason. **Going
 * stale is immediate**: silence past the threshold means the book on screen is
 * not the book at the venue, and that has to be said at once because a stale
 * ladder must not price an order. **Coming back is not**: a venue that has gone
 * stale returns to live only once `promotionUpdates` further updates have
 * arrived, so a single straggling frame cannot flip the strip back. A feed
 * genuinely updating at the threshold therefore settles on stale — which is the
 * honest reading of a venue you hear from every eight seconds — rather than
 * alternating.
 *
 * Transport states are not liveness and pass straight through. `connecting` and
 * `error` come from the socket itself and mean something this class has no
 * opinion about; it decides only between `live` and `stale`, and only once the
 * venue has ever sent a book.
 *
 * ── Deliberately not a hook ────────────────────────────────────────────────
 *
 * Same argument as `PollingController`, `ValueThrottle` and
 * `DeskSourceMachine`: the oscillation above is three lines to reproduce
 * against a clock the test controls, and was unreachable by the suite while it
 * lived inside a `setInterval` inside a hook. The former `venues.test.ts` (since
 * split) had no assertion about staleness at all, which is how the flip survived.
 */

/** What a venue's stream is doing, as the desk describes it. */
export type VenueLivenessStatus = "connecting" | "live" | "stale" | "error";

/**
 * Silence, in ms, after which a venue that has been sending books is stale.
 *
 * Re-exported from the socket module rather than redefined, so the ladder and
 * the liveness rule cannot drift to two different ideas of "stale".
 */
export { STALE_AFTER_MS } from "./livebook-socket";

/**
 * Updates required to leave `stale`.
 *
 * Two, matching `PROMOTION_STREAK` in `desk-source.ts` and for the same reason:
 * it is the smallest number that cannot be satisfied by the single late frame
 * which caused the flip. Higher would keep a genuinely recovered venue out of
 * the merged book for longer than its data deserves.
 */
export const PROMOTION_UPDATES = 2;

export interface VenueLivenessOptions {
  staleAfterMs?: number;
  promotionUpdates?: number;
}

export class VenueLiveness {
  private readonly staleAfterMs: number;
  private readonly promotionUpdates: number;

  /** Books received. Frames that never parse into a book do not count. */
  private updates = 0;
  /** When the last book arrived. Null until one has. */
  private lastUpdateAt: number | null = null;
  /** Whatever the socket last said about itself. */
  private transportStatus: VenueLivenessStatus = "connecting";
  /**
   * `updates` at the moment this venue went stale, or null while it is not.
   *
   * The promotion counter is expressed as a mark on the update count rather
   * than as a separate tally so it cannot disagree with `updates` — there is
   * one number, read twice.
   */
  private staleAtUpdates: number | null = null;

  constructor({ staleAfterMs, promotionUpdates = PROMOTION_UPDATES }: VenueLivenessOptions = {}) {
    // Read at construction rather than defaulted in the signature so the import
    // stays a value import and the constant has one definition.
    this.staleAfterMs = staleAfterMs ?? 8_000;
    this.promotionUpdates = Math.max(1, promotionUpdates);
  }

  /** A parsed book arrived from the venue. */
  update(at: number): void {
    /*
     * The gap this update closes is itself the evidence of silence.
     *
     * Arming the stale mark only from `statusAt` would make the hysteresis
     * depend on somebody having LOOKED during the quiet period — and the only
     * caller is a `setInterval`, which browsers throttle to about once a minute
     * in a background tab. A venue could then go silent, return, and never be
     * marked, because nothing observed the gap. Reading the inter-arrival time
     * here makes the decision a property of the data rather than of the
     * observation schedule, so a backgrounded tab and a foreground one reach
     * the same answer.
     */
    if (this.lastUpdateAt !== null && at - this.lastUpdateAt > this.staleAfterMs) {
      this.staleAtUpdates = this.updates;
    }
    this.updates += 1;
    this.lastUpdateAt = at;
    // A book proves the socket is carrying data, whatever it last claimed.
    // This mirrors the old `onBook` handler, which set `status = "live"`
    // directly — the difference is that leaving `stale` is now gated below.
    this.transportStatus = "live";
  }

  /**
   * The socket reported its own state.
   *
   * `connecting` never downgrades a venue that is carrying data: a silent
   * reconnect underneath a working stream is not something the strip should
   * show. `error` always wins — it is a fact about the socket, not a guess.
   */
  transport(status: VenueLivenessStatus): void {
    if (status === "connecting" && this.transportStatus === "live") return;
    this.transportStatus = status;
  }

  /**
   * An operator asked for a re-handshake.
   *
   * Distinct from `transport("connecting")`, which refuses to downgrade a live
   * venue — correct for a silent reconnect, wrong for one somebody just
   * requested and is watching. Clears the stale mark too: the stream is being
   * rebuilt, so the promotion counter from the old one means nothing.
   */
  restart(): void {
    this.transportStatus = "connecting";
    this.staleAtUpdates = null;
  }

  /**
   * The status to show at `now`, applying the hysteresis.
   *
   * Called from the publish tick, so it must be cheap and must be safe to call
   * many times for one instant — it is, because the only state it writes is the
   * stale mark, and writing that twice for the same condition is a no-op.
   */
  statusAt(now: number): VenueLivenessStatus {
    // Not a liveness question. A socket that is connecting or errored says so.
    if (this.transportStatus === "connecting" || this.transportStatus === "error") {
      return this.transportStatus;
    }

    // `lastUpdateAt` seeds null and "live" is set on handshake, so without this
    // every venue would flash stale between the handshake and its first book,
    // when there is no ladder to be stale.
    if (this.lastUpdateAt === null || this.updates === 0) return this.transportStatus;

    const silent = now - this.lastUpdateAt > this.staleAfterMs;

    if (silent) {
      /*
       * Demotion is immediate, and the mark is re-armed on every silent tick.
       *
       * Setting it only when it was null is the subtle version of this bug: a
       * venue that goes silent, sends one frame, and goes silent again keeps
       * the mark from the FIRST silence, so the second frame satisfies a streak
       * that was never about it — and the strip flips back to live on exactly
       * the pattern this class exists to refuse. Re-arming is idempotent within
       * one episode, because silence is precisely the condition under which
       * `updates` does not move.
       */
      this.staleAtUpdates = this.updates;
      return "stale";
    }

    // Fresh, and never demoted: nothing to hold it back.
    if (this.staleAtUpdates === null) return "live";

    // Fresh, but recovering. One late frame is what caused the flip this class
    // exists to prevent, so it is not enough on its own.
    if (this.updates - this.staleAtUpdates >= this.promotionUpdates) {
      this.staleAtUpdates = null;
      return "live";
    }
    return "stale";
  }

  /** Whether this venue's ladder may take part in pricing, at `now`. */
  isLiveAt(now: number): boolean {
    return this.statusAt(now) === "live";
  }
}
