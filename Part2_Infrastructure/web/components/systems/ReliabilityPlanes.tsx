"use client";

/**
 * What the system depends on, in three views that each have exactly ONE source.
 *
 * Split out of `ReliabilityOverview` when that file passed the length ceiling.
 * This is the `planes` half of the section: the four KPI tiles that never move,
 * the view switcher, the dependency map and the provider digest. The platform
 * view — the gateway's own components and the evidence boundary — is
 * `ReliabilityPlatform`, mounted from here.
 *
 * Deliberately NOT a nested `<WorkspaceSubtabs>`: that publishes `--rail-h`
 * from a ResizeObserver and asserts exactly one rail is mounted, so a second
 * would fight the first over every sticky offset in the app. The house
 * in-panel pattern is `.seg role="group"`, as the blotter uses.
 *
 * Every tile states what it actually reads, and dashes what it cannot. A
 * missing gateway snapshot renders "—" with its reason underneath; it is never
 * a zero, and "1/1 active" is never printed for a process that has no fleet.
 */

import { useState } from "react";

import DependencyMix from "@/components/systems/DependencyMix";
import DependencyTree from "@/components/systems/DependencyTree";
import ReliabilityPlatform from "@/components/systems/ReliabilityPlatform";
import type { SystemHealthView } from "@/lib/use-system-health";
import type { GatewayOpsSnapshot, ProviderRow } from "./types";
import type { ReliabilityDrilldown } from "./ReliabilityOverview";

/**
 * Dependencies was four stacked card-sections in one scroll. These are three
 * questions, and each has exactly ONE source — so each degrades on its own
 * rather than dragging the others down with it.
 */
type DependencyPane = "map" | "providers" | "platform";

const DEPENDENCY_PANES: Array<{ id: DependencyPane; label: string; hint: string }> = [
  { id: "map", label: "Map", hint: "What depends on what, and what one failure removes" },
  { id: "providers", label: "Providers", hint: "Which research APIs are routable, and why the rest are not" },
  { id: "platform", label: "Platform", hint: "Components inside the gateway process, and what one snapshot proves" },
];


/**
 * One word per provider, and a sentence that says how it was earned.
 *
 * Healthy, Degraded and Failing need observed calls in the fifteen-minute
 * window; only calls that actually failed count against a provider — a vendor
 * answering "no data for this symbol" or refusing a capability the key does
 * not hold is recorded as such by dispatch, never as an error, so a trace on
 * the wrong asset class cannot mark four healthy vendors as degraded. Idle is
 * configured, within quota and not behind an open circuit, with no call in
 * the window; only OpenBB is probed automatically, so it earns "Probe healthy"
 * without traffic. A provider whose every call failed is Failing, not idle —
 * that reading used to fall through to "no live call observed".
 */
function providerSignal(provider: ProviderRow): {
  label: string;
  detail: string;
  tone: "good" | "warn" | "critical" | "neutral";
} {
  const licence = provider.licence?.length
    ? `; ${provider.licence.map((block) => block.capability).join(", ")} not licensed on this key`
    : "";
  if (!provider.configured) {
    return {
      label: "Not configured",
      detail: `Set ${provider.keyEnv} to enable this provider.`,
      tone: "warn",
    };
  }
  if (!provider.ready) {
    return {
      label: "Blocked",
      detail: `${provider.statusDetail}${licence}`,
      tone: "critical",
    };
  }
  const n = provider.latency.n;
  if (n > 0) {
    // Integers from a non-nullable rate: `errorRate` is 0–1 over `n` samples.
    const failures = Math.round(n * provider.latency.errorRate);
    const successes = n - failures;
    if (failures === n) {
      return {
        label: "Failing",
        detail: `All ${n} ${n === 1 ? "call" : "calls"} failed in the last 15 minutes${licence}.`,
        tone: "critical",
      };
    }
    if (provider.latency.errorRate > 0.05) {
      return {
        label: "Degraded",
        detail: `${failures} of ${n} calls failed in the last 15 minutes${licence}.`,
        tone: "warn",
      };
    }
    return {
      label: "Healthy",
      detail: `${successes} of ${n} ${n === 1 ? "call" : "calls"} succeeded in the last 15 minutes${licence}.`,
      tone: "good",
    };
  }
  if (provider.id === "openbb") {
    return {
      label: "Probe healthy",
      detail: `Configured; the readiness endpoint answered${licence}.`,
      tone: "good",
    };
  }
  return {
    label: "Idle",
    detail: `Configured; no call in the last 15 minutes${licence}.`,
    tone: "neutral",
  };
}

export default function ReliabilityPlanes({
  view,
  onOpenSection,
  onOpenData,
}: {
  view: SystemHealthView;
  onOpenSection: (section: ReliabilityDrilldown) => void;
  onOpenData: () => void;
}) {
  const [pane, setPane] = useState<DependencyPane>("map");
  const { health, healthError } = view;
  const providers = health?.providers ?? [];
  const configuredProviders = providers.filter((provider) => provider.configured).length;
  const routableProviders = providers.filter((provider) => provider.ready).length;
  const platform = health?.platform;
  const slowestRoute = platform?.route_latency.routes.reduce<GatewayOpsSnapshot["route_latency"]["routes"][number] | null>(
    (slowest, route) => !slowest || route.p95_ms > slowest.p95_ms ? route : slowest,
    null,
  ) ?? null;

  /**
   * One gateway, reported as a state rather than as a count. `1/1 active` is
   * true and misleading — it implies a fleet with one member up, when there is
   * exactly one FastAPI process and no notion of a second.
   */
  const gatewayState = health?.sources?.gateway?.state ?? (platform ? "fresh" : undefined);
  const gatewayTile = {
    value: gatewayState === "fresh" ? "Fresh"
      : gatewayState === "stale" ? "Stale"
      : gatewayState === "unreachable" ? "Unreachable"
      : gatewayState === "not_configured" ? "Not configured"
      : "—",
    note: health?.sources?.gateway?.detail ?? "one FastAPI process; there is no fleet to count",
  };

  /**
   * The fraction beside the percent on purpose: 1/3 rendered only as 33% reads
   * as a meaningful rate rather than as three calls.
   */
  const routeErrors = platform?.route_latency.routes.reduce(
    (acc, route) => ({ errors: acc.errors + route.errors_total, samples: acc.samples + route.samples }),
    { errors: 0, samples: 0 },
  ) ?? null;
  const routeErrorTile = {
    value: !routeErrors ? "—"
      : routeErrors.samples >= 20
        ? `${routeErrors.errors}/${routeErrors.samples} (${((routeErrors.errors / routeErrors.samples) * 100).toFixed(1)}%)`
        : `${routeErrors.errors}/${routeErrors.samples}`,
    note: !routeErrors
      ? "no gateway ops snapshot"
      : routeErrors.samples >= 20
        ? `across ${platform!.route_latency.routes.length} sampled routes`
        : "too few samples for a rate",
  };

  return (
    <div className="reliability-overview">
      {/* The summary stays ABOVE the switcher and never moves. Four numbers
          that change identity as you change view is the "re-learning where to
          look" failure PageHead exists to end.

          Two of the four requested KPIs are renamed, because they are not
          measurable here. There is exactly ONE FastAPI gateway, so "active
          gateways" would render 1/1 and invite belief in a fleet; and no
          process uptime or availability ratio is published anywhere, only
          durations. Each tile says what it actually reads. */}
      <div className="reliability-dependency-summary" aria-label="Dependency summary">
        <div>
          <span>Trading gateway</span>
          <strong>{gatewayTile.value}</strong>
          <small>{gatewayTile.note}</small>
        </div>
        <div>
          <span>Provider APIs routable</span>
          <strong>{health ? `${routableProviders}/${providers.length}` : "—"}</strong>
          <small>{health ? `${configuredProviders} configured` : "registry not observed"}</small>
        </div>
        <div>
          <span>Slowest route p99</span>
          <strong>
            {slowestRoute
              ? slowestRoute.samples >= 20 ? `${Math.round(slowestRoute.p99_ms)}ms` : `Collecting`
              : "—"}
          </strong>
          <small>
            {slowestRoute
              ? slowestRoute.samples >= 20
                ? `${slowestRoute.route}; a gateway HTTP route, in-process, not the decision p99`
                : `${slowestRoute.samples}/20 samples`
              : "no gateway ops snapshot"}
          </small>
        </div>
        <div>
          <span>Gateway route errors</span>
          <strong>{routeErrorTile.value}</strong>
          <small>{routeErrorTile.note}</small>
        </div>
      </div>

      {/* Conditional renders, not `hidden`: a switched-away view's
          ResizeObserver should not keep running behind the one on screen. */}
      <div className="seg" role="group" aria-label="Dependency view">
        {DEPENDENCY_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={pane === option.id}
            title={option.hint}
            onClick={() => setPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* The shape first: what depends on what, and which failure would take
          out five things at once. */}
      {pane === "map" && (
        <>
          <DependencyMix health={health} healthError={healthError} />
          <DependencyTree health={health} healthError={healthError} />
        </>
      )}

      {pane === "providers" && (
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
        <details className="disclosure">
          <summary>What Idle means, and what gets probed</summary>
          <p className="reliability-window-note">
            Idle means configured, within quota, no open circuit and no call in the fifteen-minute
            window. Only OpenBB is probed automatically; probing every paid API on each refresh
            would spend quota.
          </p>
        </details>
      </section>
      )}

      {pane === "platform" && <ReliabilityPlatform view={view} onOpenData={onOpenData} />}
    </div>
  );
}
