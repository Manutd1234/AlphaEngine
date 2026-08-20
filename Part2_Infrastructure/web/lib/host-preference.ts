/**
 * Which host in a failover list last answered, remembered per process.
 *
 * ── Why this is a class and not three module-level variables ────────────────
 * It was three. `lib/venues/types.ts` kept a `Map<string, number>`, and the two
 * klines transports each kept a bare `let preferredBinanceHost = 0` /
 * `let preferredBybitHost = 0` beside a hand-written reordering expression.
 * Three copies of one idea, none of them owned by anything, each mutated from a
 * different place in its own file — the memo was written at the success site
 * and read at the loop site, with nothing in between saying they were the same
 * fact. The Binance copy and the Bybit copy had already drifted into two
 * different spellings of the same three lines.
 *
 * The state is genuinely state: it changes, it is read back, and it survives
 * between calls. So it gets an owner. One instance per host list, constructed
 * beside the list it remembers, so the index can never be applied to the wrong
 * array — which is the failure the `Math.max(0, HOSTS.indexOf(host))` guards at
 * the old write sites existed to paper over.
 *
 * ── Why the memo exists at all ──────────────────────────────────────────────
 * When a region is blocked the primary does not fail *sometimes* — it fails
 * every single time, so every request pays a full failed round trip before the
 * mirror answers. Measured in production that was a 50% error rate on Binance
 * and roughly double the latency on every depth, ticker and klines call.
 *
 * Starting from the last host that worked removes that. It is a *preference*,
 * not a pin: `ordered()` still yields the whole list, so if the remembered host
 * starts failing the next one is tried and the memo is rewritten. Per-instance
 * and non-durable, exactly like the quota ledger — a cold start simply pays the
 * discovery cost once more.
 *
 * No imports on purpose. `lib/venues/types.ts` is in the client bundle and the
 * klines transports are server-only; those two must not import each other, and
 * a dependency-free module is what lets all three share one implementation
 * without one of them dragging the other into the wrong runtime.
 */
export class HostPreference {
  /** Index into `hosts` of the host that last answered. 0 until one does. */
  private index = 0;

  constructor(private readonly hosts: readonly string[]) {}

  /**
   * The whole list, starting from the remembered host.
   *
   * Every host is still yielded — a caller walks this until one answers, so a
   * remembered host that has since died costs one failed attempt, not a
   * permanent outage.
   */
  ordered(): readonly string[] {
    if (this.index <= 0 || this.index >= this.hosts.length) return this.hosts;
    return [this.hosts[this.index], ...this.hosts.filter((_, i) => i !== this.index)];
  }

  /**
   * Record that `host` answered. A host not in the list is ignored rather than
   * stored as -1, which is the bug the old `Math.max(0, indexOf(...))` at each
   * write site was defending against by rounding a miss up to the primary.
   */
  remember(host: string): void {
    const at = this.hosts.indexOf(host);
    if (at >= 0) this.index = at;
  }

  /** The remembered host itself — for diagnostics, and for tests. */
  preferred(): string {
    return this.hosts[this.index] ?? this.hosts[0];
  }

  /** Forget the memo. The next call pays the discovery cost again. */
  reset(): void {
    this.index = 0;
  }
}
