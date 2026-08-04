"use client";

/**
 * The upstream health matrix — one row per provider, live.
 *
 * The panel this replaces reported `6 Ready · 0 Needs attention`, which is true
 * and useless: it cannot tell you *which* leg of a failover chain is about to
 * give way. A summary count only distinguishes working from broken, and almost
 * every real data-plane incident happens in between — a provider that still
 * answers but at p99 1.2s, one at 94% of its daily allowance at 11am, one whose
 * breaker tripped and will probe again in 40 seconds.
 *
 * So every column here is a number an operator can act on, and each row carries
 * the actions that act on it. Latency shows its sample count because a p99 over
 * four calls is not a p99, and pretending otherwise is how a dashboard talks
 * someone into a wrong decision.
 */

import { UI_OUTAGE_MS, type ActionOptions } from "@/components/systems/OperatorPanel";
import { fmt } from "@/lib/format";
import {
  type FailoverRoute,
  type GuardMode,
  type LatencyStats,
  type ProviderRow,
  ROUTE_STATE_STYLE,
} from "./types";

interface HealthMatrixProps {
  providers: ProviderRow[] | null;
  /** Used to resolve each provider's true position in its preferred chain. */
  routes: FailoverRoute[];
  venues: { id: string; label: string; latency: LatencyStats }[];
  guard: GuardMode;
  busyAction: string | null;
  onAction: (action: string, options?: ActionOptions) => void;
}

/** Percentiles, or an honest dash. `0` and "never measured" are not the same. */
function latencyCell(latency: LatencyStats) {
  if (!latency.n) {
    return <span className="muted">not yet called</span>;
  }
  return (
    <span>
      {fmt(latency.p50 ?? 0, 0)}
      <span className="console-sep"> / </span>
      {fmt(latency.p95 ?? 0, 0)}
      <span className="console-sep"> / </span>
      {fmt(latency.p99 ?? 0, 0)}
      <small className="muted"> ms · n={latency.n}</small>
    </span>
  );
}

function statusOf(provider: ProviderRow) {
  if (provider.simulatedOutage) return ROUTE_STATE_STYLE.simulated_outage;
  if (provider.breaker.state === "open") return ROUTE_STATE_STYLE.circuit_open;
  if (!provider.configured) return ROUTE_STATE_STYLE.not_configured;
  if (provider.quota && provider.quota.remaining <= 0) return ROUTE_STATE_STYLE.quota_exhausted;
  if (provider.ready) return ROUTE_STATE_STYLE.ready;
  return { icon: "▲", label: "unavailable", tone: "var(--warning-text)" };
}

/**
 * The capability this provider is preferred for, and where it sits in that chain.
 *
 * `meta.rank` is a *sort key*, not a position: it is sparse and shared, so
 * Binance's `{quote: 0}` and FMP's `{quote: 1}` are ranks 1 and 2 in the crypto
 * chain but 1 and 1 with a different pool. Printing `rank + 1` as a chain
 * position was wrong wherever the pool did not happen to be dense from zero, so
 * the position is taken from the failover graph — which is computed from the
 * same `candidatesFor` sort the dispatcher walks — and the key is not shown.
 */
function bestRank(provider: ProviderRow, routes: FailoverRoute[]): string {
  const ranks = Object.entries(provider.rank ?? {});
  if (!ranks.length) return "—";
  const [capability] = ranks.reduce((a, b) => (b[1] < a[1] ? b : a));
  const chain = routes.find(
    (route) => route.capability === capability && route.nodes.some((n) => n.provider === provider.id),
  );
  const position = chain?.nodes.find((n) => n.provider === provider.id)?.rank;
  return position ? `${position}/${chain!.nodes.length} · ${capability}` : `— · ${capability}`;
}

export default function HealthMatrix({
  providers,
  routes,
  venues,
  guard,
  busyAction,
  onAction,
}: HealthMatrixProps) {
  const locked = guard === "locked";
  const lockNote = locked
    ? "Operator actions are disabled on this deployment — see the operator panel."
    : undefined;

  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Pipeline observability</span>
          <h2>Upstream health &amp; circuit breakers</h2>
        </div>
        <span className="section-note">Percentiles over the last 15 minutes on this instance.</span>
      </div>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Provider health: status, circuit-breaker state, latency percentiles, quota consumption
            and failover rank, with per-provider operator actions.
          </caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Status &amp; breaker</th>
              <th scope="col">p50 / p95 / p99</th>
              <th scope="col">Quota</th>
              <th scope="col">Rank</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(providers ?? []).map((provider) => {
              const style = statusOf(provider);
              const quota = provider.quota;
              const quotaPct = quota && quota.limit > 0 ? quota.used / quota.limit : null;
              return (
                <tr key={provider.id}>
                  <td>
                    <div className="console-provider">
                      <strong>{provider.label}</strong>
                      <small className="muted">{provider.capabilities.join(" · ")}</small>
                    </div>
                  </td>

                  <td className="console-status-cell">
                    {/* icon + word + colour, never colour alone */}
                    <span style={{ color: style.tone }}>
                      <span aria-hidden>{style.icon}</span> {style.label}
                    </span>
                    <small className="muted console-wrap">{provider.statusDetail}</small>
                    {provider.breaker.failures > 0 && provider.breaker.state !== "open" && (
                      <small className="muted">
                        {provider.breaker.failures}/{provider.breaker.threshold} failures toward a trip
                      </small>
                    )}
                  </td>

                  <td>{latencyCell(provider.latency)}</td>

                  <td>
                    {quota ? (
                      <div className="console-quota-cell">
                        <span>
                          {quota.used}/{quota.limit}
                          <small className="muted"> per {quota.window}</small>
                        </span>
                        <span
                          className={`console-meter is-${quotaPct !== null && quotaPct >= 0.95 ? "critical" : quotaPct !== null && quotaPct >= 0.8 ? "warning" : "good"}`}
                          role="img"
                          aria-label={`${Math.round((quotaPct ?? 0) * 100)} percent of the ${quota.window} allowance spent`}
                        >
                          <i style={{ width: `${Math.min(100, (quotaPct ?? 0) * 100)}%` }} aria-hidden />
                        </span>
                      </div>
                    ) : (
                      <span className="muted">unmetered</span>
                    )}
                  </td>

                  <td>{bestRank(provider, routes)}</td>

                  <td>
                    <div className="console-row-actions">
                      <button
                        type="button"
                        onClick={() => onAction("probe_provider", { provider: provider.id })}
                        disabled={locked || busyAction !== null || !provider.configured}
                        title={
                          lockNote
                            ?? (provider.configured
                              ? "Send one real request to this provider and time it. Spends one call."
                              : "Not configured — there is nothing to probe.")
                        }
                      >
                        Test
                      </button>
                      {provider.simulatedOutage ? (
                        <button
                          type="button"
                          onClick={() => onAction("clear_outage", { provider: provider.id })}
                          disabled={locked || busyAction !== null}
                          title={lockNote ?? "Return this provider to routing now."}
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onAction("simulate_outage", { provider: provider.id, ttlMs: UI_OUTAGE_MS })}
                          disabled={locked || busyAction !== null || !provider.ready}
                          title={
                            lockNote
                              ?? (provider.ready
                                ? "Hold this provider out of routing so you can watch failover. Expires by itself."
                                : "Only a routable provider can be knocked out.")
                          }
                        >
                          Trip
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onAction("reset_breaker", { provider: provider.id })}
                        disabled={locked || busyAction !== null || provider.breaker.state === "closed"}
                        title={
                          lockNote
                            ?? (provider.breaker.state === "closed"
                              ? "This circuit is already closed."
                              : "Close the circuit now instead of waiting out the cooldown.")
                        }
                      >
                        Reset
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}

            {providers === null && (
              <tr>
                <td colSpan={6} className="muted">Loading provider health…</td>
              </tr>
            )}
            {providers?.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">No providers are registered.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {venues.length > 0 && (
        <>
          <p className="console-subhead">
            Direct venue clients
            <small className="muted">
              {" "}— reached by <code>/api/depth</code> and <code>/api/tca</code> without the registry, so they
              have no failover chain and no breaker. Measured separately.
            </small>
          </p>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">Latency of the exchange clients that bypass the provider registry.</caption>
              <thead>
                <tr>
                  <th scope="col">Client</th>
                  <th scope="col">p50 / p95 / p99</th>
                  <th scope="col">Error rate</th>
                </tr>
              </thead>
              <tbody>
                {venues.map((venue) => (
                  <tr key={venue.id}>
                    <td>{venue.label}</td>
                    <td>{latencyCell(venue.latency)}</td>
                    <td>
                      {venue.latency.n
                        ? `${fmt(venue.latency.errorRate * 100, 1)}%`
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
