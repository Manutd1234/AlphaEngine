"use client";

/**
 * Symptom-first landing view for the Reliability workspace.
 *
 * This is intentionally a summary of the existing health contract rather than
 * a second telemetry source. SREs should be able to answer "is anyone hurting?"
 * here, then move to Services for causes, Events for correlation, and Controls
 * for a guarded response without this component starting another poller.
 */

import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";
import type { ProviderRow } from "./types";

export type ReliabilityDrilldown = "services" | "events" | "controls";

interface ReliabilityOverviewProps {
  view: SystemHealthView;
  onOpenSection: (section: ReliabilityDrilldown) => void;
  onOpenData: () => void;
}

type Tone = "good" | "warn" | "critical" | "neutral";

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  tone: Exclude<Tone, "good">;
  destination: ReliabilityDrilldown | "data";
  action: string;
}

function names(ids: string[], providers: ProviderRow[]): string {
  const labels = new Map(providers.map((provider) => [provider.id, provider.label]));
  return ids.map((id) => labels.get(id) ?? id).join(", ");
}

function providerState(provider: ProviderRow): { label: string; tone: Tone } {
  if (provider.simulatedOutage) return { label: "Drill active", tone: "warn" };
  if (provider.breaker.state === "open") return { label: "Circuit open", tone: "critical" };
  if (!provider.configured) return { label: "Not configured", tone: "neutral" };
  if (provider.quota && provider.quota.remaining <= 0) {
    return { label: "Quota exhausted", tone: "critical" };
  }
  if (provider.ready) return { label: "Ready", tone: "good" };
  return { label: "Unavailable", tone: "critical" };
}

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
  const successRate = hasTraffic ? (1 - (latency?.errorRate ?? 0)) * 100 : null;
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
  const quarantined = health?.quarantine?.size ?? 0;

  let serviceState: { label: string; detail: string; tone: Tone };
  if (healthError) {
    serviceState = {
      label: "Telemetry unavailable",
      detail: health ? "Showing the last good snapshot" : "No health snapshot is available",
      tone: "critical",
    };
  } else if (!health) {
    serviceState = {
      label: "Connecting",
      detail: "Waiting for the first health snapshot",
      tone: "neutral",
    };
  } else if (unavailableCapabilities.length) {
    serviceState = {
      label: "Service path unavailable",
      detail: `${unavailableCapabilities.length} ${unavailableCapabilities.length === 1 ? "routing capability has" : "routing capabilities have"} no ready provider`,
      tone: "critical",
    };
  } else if (openBreakers.length || exhausted.length) {
    const dependencies = openBreakers.length + exhausted.length;
    serviceState = {
      label: "Degraded",
      detail: `${dependencies} dependency signal${dependencies === 1 ? "" : "s"} active`,
      tone: "critical",
    };
  } else if ((latency?.errorRate ?? 0) > 0.01) {
    serviceState = {
      label: "Upstream instability",
      detail: "Provider / venue attempt success is below 99%",
      tone: "warn",
    };
  } else if (simulated.length) {
    serviceState = {
      label: "Drill active",
      detail: `${simulated.length} simulated outage${simulated.length === 1 ? "" : "s"} in progress`,
      tone: "warn",
    };
  } else {
    serviceState = {
      label: "Nominal",
      detail: "No active dependency symptom detected",
      tone: "good",
    };
  }

  const attention: AttentionItem[] = [];
  if (healthError) {
    attention.push({
      id: "telemetry-unreachable",
      title: "Health telemetry is unreachable",
      detail: healthError,
      tone: "critical",
      destination: "events",
      action: "Inspect events",
    });
  }
  if (hasTraffic && (latency?.errorRate ?? 0) > 0.01) {
    attention.push({
      id: "request-errors",
      title: "Upstream attempt errors are elevated",
      detail: `${fmt((latency?.errorRate ?? 0) * 100, 1)}% of ${latency?.n ?? 0} provider / venue attempts failed`,
      tone: (latency?.errorRate ?? 0) >= 0.05 ? "critical" : "warn",
      destination: "events",
      action: "Correlate events",
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

  const goldenSignals = [
    {
      label: "Upstream success",
      value: successRate === null ? "—" : `${fmt(successRate, 1)}%`,
      detail: hasTraffic ? `${latency?.n ?? 0} provider / venue attempts` : "No attempts sampled yet",
      tone: successRate === null ? "neutral" : successRate < 95 ? "critical" : successRate < 99 ? "warn" : "good",
    },
    {
      label: "Upstream latency",
      value: hasTraffic ? `${fmt(latency?.p95 ?? 0, 0)}ms` : "—",
      detail: hasTraffic
        ? `p50 ${fmt(latency?.p50 ?? 0, 0)}ms · p99 ${fmt(latency?.p99 ?? 0, 0)}ms`
        : "Waiting for a measured attempt",
      tone: "neutral",
    },
    {
      label: "Sample volume",
      value: hasTraffic ? String(latency?.n ?? 0) : "0",
      detail: "Upstream attempts · rolling 15m",
      tone: "neutral",
    },
    {
      label: "Saturation",
      value: exhausted.length + atReserve.length ? `${exhausted.length + atReserve.length} risks` : "Clear",
      detail: `${atReserve.length} at reserve · ${exhausted.length} exhausted`,
      tone: exhausted.length ? "critical" : atReserve.length ? "warn" : health ? "good" : "neutral",
    },
  ] as const;

  return (
    <div className="reliability-overview">
      <section className="card reliability-posture" aria-labelledby="reliability-posture-title">
        <div className="section-heading compact reliability-posture__heading">
          <div>
            <span className="page-kicker">Dependency signals</span>
            <h2 id="reliability-posture-title">Current service posture</h2>
          </div>
          <div className={`reliability-state is-${serviceState.tone}`} role="status">
            <span className="reliability-state__dot" aria-hidden />
            <span>
              <strong>{serviceState.label}</strong>
              <small>{serviceState.detail}</small>
            </span>
          </div>
        </div>

        <div className="reliability-signal-grid">
          {goldenSignals.map((signal) => (
            <div className={`reliability-signal is-${signal.tone}`} key={signal.label}>
              <span>{signal.label}</span>
              <strong className="num">{signal.value}</strong>
              <small>{signal.detail}</small>
            </div>
          ))}
        </div>
        <p className="reliability-window-note">
          Instance-local provider and venue attempts for fast dependency triage. Failover can recover
          a failed attempt, so these are not request-level availability or a fleet-wide SLO report.
        </p>
      </section>

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
                <strong>No active symptoms</strong>
                <small>Routes are available, quotas have headroom, and no dependency drill is running.</small>
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
                <span><strong>Correlate events</strong><small>Read server dispatch and browser wire events on one timeline.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenSection("controls")}>
                <span className="num">03</span>
                <span><strong>Recover safely</strong><small>Use authenticated, scoped controls with the cost shown first.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
          </ol>
        </section>
      </div>

      <section className="card reliability-dependency-digest" aria-labelledby="reliability-dependency-title">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Dependency posture</span>
            <h2 id="reliability-dependency-title">Provider readiness at a glance</h2>
          </div>
          <button type="button" className="text-action" onClick={() => onOpenSection("services")}>
            Open service matrix →
          </button>
        </div>

        <div className="reliability-dependency-summary" aria-label="Dependency summary">
          <div><span>Ready</span><strong className="num">{summary ? `${summary.ready}/${summary.total}` : "—"}</strong></div>
          <div><span>Circuits open</span><strong className={`num${openBreakers.length ? " critical" : ""}`}>{openBreakers.length}</strong></div>
          <div><span>At reserve</span><strong className={`num${atReserve.length ? " warn" : ""}`}>{atReserve.length}</strong></div>
          <div><span>Active drills</span><strong className={`num${simulated.length ? " warn" : ""}`}>{simulated.length}</strong></div>
        </div>

        <ul className="reliability-provider-digest">
          {providers.map((provider) => {
            const state = providerState(provider);
            return (
              <li key={provider.id}>
                <span className={`reliability-provider-digest__state is-${state.tone}`}>
                  <i aria-hidden /> {state.label}
                </span>
                <strong>{provider.label}</strong>
                <small>
                  {provider.latency.n
                    ? `p95 ${fmt(provider.latency.p95 ?? 0, 0)}ms · n=${provider.latency.n}`
                    : "Latency not sampled"}
                  {provider.quota ? ` · quota ${provider.quota.remaining}/${provider.quota.limit} remaining · ${provider.quota.window}` : ""}
                </small>
              </li>
            );
          })}
          {!health && <li className="is-loading"><strong>Loading provider registry…</strong></li>}
        </ul>

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
