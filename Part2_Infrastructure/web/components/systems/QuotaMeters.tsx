"use client";

/**
 * Quota consumption, per provider, with the reserve drawn on it.
 *
 * A percentage bar would be the obvious thing and it would hide the mechanism
 * that matters. The ledger does not have one threshold, it has two: the point
 * where *background* polling stops (the reserve) and the point where everything
 * stops (the limit). A provider at 82% of Alpha Vantage's 25 calls/day is not
 * "nearly out" — it is already refusing the dashboard's refreshes and saving
 * what remains for a person. The tick mark on each meter is where that happens.
 *
 * The window countdown is here for the same reason. "5 calls left" means
 * something different at 09:00 than at 23:50 UTC, and the ledger resets on the
 * vendor's calendar boundary, not on a rolling hour.
 */

import type { ProviderRow } from "./types";

interface QuotaMetersProps {
  providers: ProviderRow[] | null;
}

/**
 * Time until the vendor's counter rolls over.
 *
 * Calendar-aligned in UTC, matching `windowKey` in the runtime — a rolling
 * window here would disagree with the ledger it is describing.
 */
function msUntilWindowReset(window: string, now = Date.now()): number | null {
  const d = new Date(now);
  switch (window) {
    case "minute":
      return 60_000 - (now % 60_000);
    case "day":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
    case "month":
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) - now;
    default:
      return null;
  }
}

function humanDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

export default function QuotaMeters({ providers }: QuotaMetersProps) {
  const metered = (providers ?? []).filter((p) => p.quota !== null);

  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <h2>Quota &amp; rate limits</h2>
        </div>
        <span className="section-note">Counted before each call, so a timeout still costs a unit.</span>
      </div>

      {providers === null && <div className="skeleton" style={{ height: 120 }} />}

      {metered.map((provider) => {
        const quota = provider.quota!;
        const usedPct = quota.limit > 0 ? Math.min(1, quota.used / quota.limit) : 0;
        // Background traffic stops here — the reserve is measured from the top.
        const reserveMarkPct = quota.limit > 0 ? 1 - quota.reserve / quota.limit : 1;
        const tone = usedPct >= 0.95 ? "critical" : usedPct >= reserveMarkPct ? "warning" : "good";
        const resetIn = msUntilWindowReset(quota.window);
        return (
          <div className="console-quota-row" key={provider.id}>
            <div className="console-quota-row__head">
              <strong>{provider.label}</strong>
              <span className="num">
                {quota.used}/{quota.limit}
                <small className="muted"> per {quota.window}</small>
              </span>
            </div>

            <div
              className={`console-meter console-meter--wide is-${tone}`}
              role="img"
              aria-label={`${provider.label}: ${quota.used} of ${quota.limit} calls used this ${quota.window}; ${quota.remaining} left, ${quota.reserve} reserved for interactive lookups.`}
            >
              <i style={{ width: `${usedPct * 100}%` }} aria-hidden />
              {quota.reserve > 0 && (
                <b className="console-meter__mark" style={{ left: `${reserveMarkPct * 100}%` }} aria-hidden />
              )}
            </div>

            <div className="console-quota-row__foot">
              <small className="muted">
                {quota.remaining} left, {quota.reserve} reserved for interactive lookups
                {usedPct >= reserveMarkPct && quota.remaining > 0 && (
                  <strong className="console-warn">; background refresh already fenced out</strong>
                )}
                {quota.remaining <= 0 && <strong className="console-warn">; exhausted</strong>}
              </small>
              {resetIn !== null && (
                <small className="muted">resets in {humanDuration(resetIn)} (UTC)</small>
              )}
            </div>
          </div>
        );
      })}

      {providers !== null && metered.length === 0 && (
        <p className="muted console-empty">No metered provider is configured in this environment.</p>
      )}
    </div>
  );
}
