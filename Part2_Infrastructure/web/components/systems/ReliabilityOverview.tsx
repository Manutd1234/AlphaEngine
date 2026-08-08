"use client";

/**
 * Triage landing view for the Reliability workspace.
 *
 * ConsoleChrome owns the one status summary. This panel starts where a compact
 * strip should stop: active symptoms, evidence boundaries and the next safe
 * investigation step. It deliberately does not repeat golden signals or the
 * provider table that already lives in Services & Circuits.
 */

import LatencyTrend from "@/components/systems/LatencyTrend";
import { fmt } from "@/lib/format";
import { deriveReliabilityPosture, type ReliabilityStatus } from "@/lib/reliability";
import type { SystemHealthView } from "@/lib/use-system-health";
import type { GatewayOpsSnapshot, ProviderRow } from "./types";

export type ReliabilityDrilldown = "services" | "events" | "controls";

interface ReliabilityOverviewProps {
  view: SystemHealthView;
  onOpenSection: (section: ReliabilityDrilldown) => void;
  onOpenData: () => void;
}

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  tone: "warn" | "critical" | "neutral";
  destination: ReliabilityDrilldown | "data";
  action: string;
}

function names(ids: string[], providers: ProviderRow[]): string {
  const labels = new Map(providers.map((provider) => [provider.id, provider.label]));
  return ids.map((id) => labels.get(id) ?? id).join(", ");
}

function hasSuccessfulTraffic(provider: ProviderRow): boolean {
  return provider.latency.n > 0 && provider.latency.errorRate < 1;
}

function hasLiveEvidence(provider: ProviderRow): boolean {
  return hasSuccessfulTraffic(provider) || (provider.id === "openbb" && provider.ready);
}

function providerSignal(provider: ProviderRow): {
  label: string;
  detail: string;
  tone: "good" | "warn" | "critical" | "neutral";
} {
  if (!provider.configured) {
    return {
      label: "Not configured",
      detail: `Missing ${provider.keyEnv}`,
      tone: "warn",
    };
  }
  if (!provider.ready) {
    return {
      label: "Blocked",
      detail: provider.statusDetail,
      tone: "critical",
    };
  }
  if (hasSuccessfulTraffic(provider)) {
    const successes = Math.max(0, Math.round(provider.latency.n * (1 - provider.latency.errorRate)));
    const degraded = provider.latency.errorRate > 0.05;
    return {
      label: degraded ? "Successes + errors" : "Success observed",
      detail: `Configured · ${successes}/${provider.latency.n} attempts succeeded in the last 15m`,
      tone: degraded ? "warn" : "good",
    };
  }
  if (provider.id === "openbb") {
    return {
      label: "Live probe",
      detail: "Configured · readiness endpoint answered",
      tone: "good",
    };
  }
  return {
    label: "Routable",
    detail: "Configured · no live call observed in the last 15m",
    tone: "neutral",
  };
}

const POSTURE_LABEL: Record<ReliabilityStatus, string> = {
  nominal: "Nominal",
  degraded: "Degraded",
  critical: "Critical",
  halted: "Trading halted",
  unknown: "Unknown",
};

export default function ReliabilityOverview({
  view,
  onOpenSection,
  onOpenData,
}: ReliabilityOverviewProps) {
  const { health, healthError } = view;
  const providers = health?.providers ?? [];
  const summary = health?.summary;
  const latency = summary?.latency;
  const hasTraffic = Boolean(latency?.n);
  const openBreakers = summary?.degraded ?? [];
  const exhausted = summary?.exhausted ?? [];
  const simulated = summary?.simulated ?? [];
  const unavailableCapabilities = health
    ? Object.entries(health.capabilities)
        .filter(([, capability]) => capability.available.length === 0)
        .map(([capability]) => capability)
    : [];
  const atReserve = providers.filter(
    (provider) => provider.quota
      && provider.quota.remaining > 0
      && provider.quota.remaining <= provider.quota.reserve,
  );
  const configuredProviders = providers.filter((provider) => provider.configured).length;
  const routableProviders = providers.filter((provider) => provider.ready).length;
  const providersWithLiveEvidence = providers.filter(hasLiveEvidence).length;
  const quarantined = health?.quarantine?.size ?? 0;
  const posture = health ? deriveReliabilityPosture(health) : null;
  const platform = health?.platform;
  const hasPlatform = Boolean(platform);
  const gatewaySource = health?.sources?.gateway;
  const realFeeds = platform?.market_data.feeds.filter((feed) => !feed.synthetic) ?? [];
  const connectedFeeds = realFeeds.filter((feed) => feed.connected).length;
  const books = realFeeds.flatMap((feed) => feed.symbols);
  const staleBooks = books.filter((book) => book.stale).length;
  const queueActive = (platform?.queue.by_status.queued ?? 0) + (platform?.queue.by_status.running ?? 0);
  const routeSamples = platform?.route_latency.routes.reduce((total, route) => total + route.samples, 0) ?? 0;
  const slowestRoute = platform?.route_latency.routes.reduce<GatewayOpsSnapshot["route_latency"]["routes"][number] | null>(
    (slowest, route) => !slowest || route.p95_ms > slowest.p95_ms ? route : slowest,
    null,
  ) ?? null;

  const attention: AttentionItem[] = [];
  if (healthError) {
    attention.push({
      id: "telemetry-unreachable",
      title: "Health telemetry is unreachable",
      detail: healthError,
      tone: "critical",
      destination: "events",
      action: "Inspect logs",
    });
  }
  if (!healthError && posture && posture.paths.trading.status !== "nominal") {
    const tradingStatus = posture.paths.trading.status;
    attention.push({
      id: "trading-path-posture",
      title: tradingStatus === "halted"
        ? "Authoritative trading is halted"
        : tradingStatus === "critical"
          ? "Trading-path component is unavailable"
          : tradingStatus === "degraded"
            ? "Trading path is operating with restrictions"
            : "Trading-path health is unverified",
      detail: posture.paths.trading.reason,
      tone: tradingStatus === "critical" || tradingStatus === "halted" ? "critical" : "warn",
      destination: "events",
      action: "Inspect telemetry",
    });
  }
  if (hasTraffic && (latency?.errorRate ?? 0) > 0.01) {
    attention.push({
      id: "request-errors",
      title: "Upstream attempt errors are elevated",
      detail: `${fmt((latency?.errorRate ?? 0) * 100, 1)}% of ${latency?.n ?? 0} provider / venue attempts failed`,
      tone: (latency?.errorRate ?? 0) >= 0.05 ? "critical" : "warn",
      destination: "events",
      action: "Correlate logs",
    });
  }
  if (unavailableCapabilities.length) {
    attention.push({
      id: "unavailable-capabilities",
      title: `${unavailableCapabilities.length} service path${unavailableCapabilities.length === 1 ? " is" : "s are"} unavailable`,
      detail: unavailableCapabilities.join(", "),
      tone: "critical",
      destination: "services",
      action: "Inspect routing",
    });
  }
  if (openBreakers.length) {
    attention.push({
      id: "open-breakers",
      title: `${openBreakers.length} circuit${openBreakers.length === 1 ? "" : "s"} open`,
      detail: names(openBreakers, providers),
      tone: "critical",
      destination: "services",
      action: "Inspect services",
    });
  }
  if (exhausted.length) {
    attention.push({
      id: "quota-exhausted",
      title: `${exhausted.length} provider quota${exhausted.length === 1 ? "" : "s"} exhausted`,
      detail: names(exhausted, providers),
      tone: "critical",
      destination: "services",
      action: "Inspect capacity",
    });
  }
  if (simulated.length) {
    attention.push({
      id: "active-drills",
      title: `${simulated.length} controlled failure drill${simulated.length === 1 ? "" : "s"} active`,
      detail: names(simulated, providers),
      tone: "warn",
      destination: "services",
      action: "Follow failover",
    });
  }
  if (atReserve.length) {
    attention.push({
      id: "quota-reserve",
      title: `${atReserve.length} provider${atReserve.length === 1 ? " is" : "s are"} at reserve`,
      detail: atReserve.map((provider) => provider.label).join(", "),
      tone: "warn",
      destination: "services",
      action: "Review headroom",
    });
  }
  if (quarantined) {
    attention.push({
      id: "quarantine",
      title: `${quarantined} payload${quarantined === 1 ? "" : "s"} quarantined`,
      detail: "Transport may be healthy while a data contract is failing",
      tone: "warn",
      destination: "data",
      action: "Open Data quality",
    });
  }

  return (
    <div className="reliability-overview">
      <LatencyTrend history={view.latencyHistory} />

      <div className="reliability-overview__split">
        <section className="card reliability-attention" aria-labelledby="reliability-attention-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Triage</span>
              <h2 id="reliability-attention-title">Active attention</h2>
            </div>
            <span className="section-note">{attention.length} signal{attention.length === 1 ? "" : "s"}</span>
          </div>

          {health && attention.length === 0 ? (
            <div className="reliability-all-clear" role="status">
              <span aria-hidden>✓</span>
              <div>
                <strong>No active symptoms in the observed planes</strong>
                <small>Provider routes have headroom and no dependency drill is running.</small>
              </div>
            </div>
          ) : !health && !healthError ? (
            <div className="reliability-all-clear is-loading" role="status">
              <span aria-hidden>…</span>
              <div>
                <strong>Waiting for telemetry</strong>
                <small>The first health snapshot has not arrived yet.</small>
              </div>
            </div>
          ) : (
            <ul className="reliability-attention-list">
              {attention.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`is-${item.tone}`}
                    onClick={() => item.destination === "data" ? onOpenData() : onOpenSection(item.destination)}
                  >
                    <span className="reliability-attention-list__marker" aria-hidden />
                    <span className="reliability-attention-list__copy">
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="reliability-attention-list__action">{item.action} →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card reliability-response" aria-labelledby="reliability-response-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Incident path</span>
              <h2 id="reliability-response-title">Diagnose, correlate, recover</h2>
            </div>
          </div>
          <ol className="reliability-response-steps">
            <li>
              <button type="button" onClick={() => onOpenSection("services")}>
                <span className="num">01</span>
                <span><strong>Inspect services</strong><small>Find the provider, circuit, venue or quota under pressure.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenSection("events")}>
                <span className="num">02</span>
                <span><strong>Correlate logs</strong><small>Read server dispatch and browser wire events on one timeline.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenSection("controls")}>
                <span className="num">03</span>
                <span><strong>Recover safely</strong><small>Preview the target, cost and scope before a guarded mutation.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
          </ol>
        </section>
      </div>

      <section className="card reliability-dependency-digest" aria-labelledby="reliability-provider-api-title">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Research data plane</span>
            <h2 id="reliability-provider-api-title">Every provider API</h2>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenSection("services")}>
            Open latency, quota &amp; circuits →
          </button>
        </div>

        <div className="reliability-dependency-summary" aria-label="Provider API summary">
          <div><span>Configured</span><strong>{health ? `${configuredProviders}/${providers.length}` : "—"}</strong></div>
          <div><span>Routable now</span><strong>{health ? `${routableProviders}/${providers.length}` : "—"}</strong></div>
          <div><span>Success evidence</span><strong>{health ? `${providersWithLiveEvidence}/${providers.length}` : "—"}</strong></div>
          <div><span>Automatic probes</span><strong>OpenBB only</strong></div>
        </div>

        <ul className="reliability-provider-digest" aria-label="Configured, routable and live status for every provider">
          {providers.map((provider) => {
            const signal = providerSignal(provider);
            return (
              <li key={provider.id}>
                <span className={`reliability-provider-digest__state is-${signal.tone}`}>
                  <i aria-hidden />{signal.label}
                </span>
                <strong>{provider.label}</strong>
                <small>{signal.detail}</small>
              </li>
            );
          })}
          {!health && <li className="is-loading">Loading all provider states…</li>}
        </ul>
        <p className="reliability-window-note">
          “Routable” means configured, within quota and not held behind an open circuit. Success evidence needs an observed successful call;
          only OpenBB is probed automatically because probing every paid API on each health refresh would consume quota.
        </p>
      </section>

      {platform ? (
        <section className="card reliability-platform" aria-labelledby="reliability-platform-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Authoritative gateway</span>
              <h2 id="reliability-platform-title">Quant infrastructure components</h2>
            </div>
            <span className={`reliability-source-state is-${gatewaySource?.state ?? "invalid"}`}>
              {gatewaySource?.state === "fresh" ? "Fresh snapshot" : gatewaySource?.state?.replace("_", " ") ?? "Source unknown"}
            </span>
          </div>

          <div className="reliability-platform__grid">
            <article className={`is-${platform.market_data.status}`}>
              <span>Market data</span>
              <strong>{platform.market_data.status.replace("_", " ")}</strong>
              <small>
                {realFeeds.length
                  ? `${connectedFeeds}/${realFeeds.length} venue feeds connected · ${staleBooks}/${books.length} books stale`
                  : "No live venue feeds observed"}
                {platform.market_data.synthetic_active ? " · synthetic fallback active" : ""}
              </small>
            </article>
            <article className={`is-${platform.risk.status}`}>
              <span>Pre-trade risk</span>
              <strong>{platform.risk.status.replace("_", " ")}</strong>
              <small>
                {platform.risk.working_orders} working orders · {fmt(platform.risk.drawdown_budget_used_pct * 100, 0)}% drawdown budget used
              </small>
            </article>
            <article className={platform.queue.broker_configured && platform.queue.backend !== "celery" ? "is-degraded" : "is-nominal"}>
              <span>Research queue</span>
              <strong>{platform.queue.backend}</strong>
              <small>
                {queueActive} queued / running · {platform.queue.workers} configured worker slots
              </small>
            </article>
            <article className={platform.audit.available ? "is-nominal" : "is-critical"}>
              <span>Audit store</span>
              <strong>{platform.audit.available ? "available" : "unavailable"}</strong>
              <small>{platform.audit.backend} · append-only decision evidence</small>
            </article>
            {/* The gateway has always emitted these counters; nothing rendered
                them, so the durability of the Postgres mirror was invisible in
                the console whose job is visibility.

                Three distinct states, deliberately not collapsed: absent (this
                gateway build predates the mirror), configured:false (mirror
                off), and configured-and-failing. Only the last is a fault.
                `dropped` leads because the queue is bounded and drops rather
                than blocking the order path — a non-zero value means the
                Postgres blotter is silently incomplete, which is exactly the
                kind of quiet loss nobody notices without a number. */}
            {platform.supabase && (
              <article
                className={
                  !platform.supabase.configured
                    ? "is-disabled"
                    : platform.supabase.dropped > 0 || platform.supabase.last_error_kind
                      ? "is-degraded"
                      : "is-nominal"
                }
              >
                <span>Postgres mirror</span>
                <strong>
                  {!platform.supabase.configured
                    ? "not configured"
                    : platform.supabase.dropped > 0
                      ? "lossy"
                      : platform.supabase.running ? "streaming" : "idle"}
                </strong>
                <small>
                  {platform.supabase.configured
                    ? <>
                        {platform.supabase.written} mirrored · {platform.supabase.queued} queued
                        {platform.supabase.dropped > 0 && ` · ${platform.supabase.dropped} DROPPED`}
                        {platform.supabase.failed > 0 && ` · ${platform.supabase.failed} failed`}
                        {platform.supabase.last_error_kind && ` · last error: ${platform.supabase.last_error_kind}`}
                      </>
                    : "DuckDB stays authoritative; the mirror is optional durability"}
                </small>
              </article>
            )}
          </div>

          <div className="reliability-platform__sli" aria-label="Gateway route latency evidence">
            <span>
              <small>Slowest sampled route p95</small>
              <strong className="num">{slowestRoute ? `${fmt(slowestRoute.p95_ms, 1)}ms` : "—"}</strong>
              <code>{slowestRoute?.route ?? "no route samples"}</code>
            </span>
            <span>
              <small>Latency evidence</small>
              <strong className="num">{routeSamples}</strong>
              <code>{fmt(platform.route_latency.window_seconds / 60, 0)}m bounded window</code>
            </span>
            <span>
              <small>Gateway build</small>
              <strong className="num">v{platform.version}</strong>
              <code>{platform.environment}</code>
            </span>
          </div>
          <p className="reliability-platform__caveat">
            Queue workers are configured slots, not distributed worker heartbeats. This is one gateway-process snapshot;
            fleet aggregation and exchange order-to-ack timing still belong in external telemetry.
          </p>
        </section>
      ) : null}

      <section className="card reliability-evidence" aria-labelledby="reliability-evidence-title">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Evidence boundary</span>
            <h2 id="reliability-evidence-title">What this snapshot can prove</h2>
          </div>
        </div>
        <div className="reliability-evidence__grid">
          <div>
            <span className={`reliability-evidence__state is-${posture?.paths.research.status ?? "unknown"}`}>
              {posture ? POSTURE_LABEL[posture.paths.research.status] : "Connecting"}
            </span>
            <strong>Provider-routing plane</strong>
            <small>{posture?.paths.research.reason ?? "Waiting for the provider-routing snapshot."}</small>
          </div>
          <div>
            <span className={`reliability-evidence__state is-${posture?.paths.trading.status ?? "unknown"}`}>
              {posture ? POSTURE_LABEL[posture.paths.trading.status] : "Connecting"}
            </span>
            <strong>Trading gateway plane</strong>
            <small>
              {hasPlatform
                ? posture?.paths.trading.reason
                : posture?.paths.trading.reason ?? "A provider-only snapshot cannot prove market-data freshness, worker health or kill-switch state."}
            </small>
          </div>
        </div>

        <aside className="reliability-data-handoff" aria-label="Data quality ownership handoff">
          <div>
            <span className="page-kicker">Owned by data engineering</span>
            <strong>Transport healthy, payload suspect?</strong>
            <small>Contract checks, source reconciliation and quarantined records live in Data operations.</small>
          </div>
          <div className="reliability-data-handoff__metrics">
            <span><strong className={`num${quarantined ? " warn" : ""}`}>{quarantined}</strong> quarantined</span>
            <span><strong className="num">{health?.cache.entries ?? 0}</strong> cache entries</span>
          </div>
          <button type="button" className="text-action" onClick={onOpenData}>Open Data quality →</button>
        </aside>
      </section>
    </div>
  );
}
