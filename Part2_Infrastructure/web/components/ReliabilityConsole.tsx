"use client";

/**
 * SRE's tab: is the platform up, and if not, which layer broke?
 *
 * The role's blueprint asks to locate a failure in compute, network, provider,
 * cache or broker connectivity without opening several dashboards, so the
 * workflow answers that question in layers — Overview surfaces symptoms, the
 * Services matrix says which provider or breaker is involved, Events says when
 * it started, and Controls is where a guarded response or drill is performed.
 *
 * Reads are free and always available; writes are gated and every control states
 * its cost. The gateway's own `/metrics` endpoint is the scrape surface for all
 * of this — this tab is the human view of the same counters.
 */

import HealthMatrix from "@/components/systems/HealthMatrix";
import OperatorPanel, { OperatorActionResult } from "@/components/systems/OperatorPanel";
import ReliabilityOverview, { type ReliabilityDrilldown } from "@/components/systems/ReliabilityOverview";
import TraceConsole from "@/components/systems/TraceConsole";
import { ConsoleChrome, type ConsoleTile } from "@/components/systems/ConsoleChrome";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export type ReliabilitySection = "overview" | "services" | "events" | "controls";

const RELIABILITY_SECTIONS = [
  { id: "overview", label: "Overview", description: "Signals & active impact" },
  { id: "services", label: "Services", description: "Providers, venues & circuits" },
  { id: "events", label: "Events", description: "Cross-origin trace" },
  { id: "controls", label: "Controls", description: "Guarded remediation" },
] as const;

export interface ReliabilityConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenData: () => void;
  section: ReliabilitySection;
  onSectionChange: (section: ReliabilitySection) => void;
}

export default function ReliabilityConsole({
  view,
  workspaceSymbol,
  onOpenData,
  section,
  onSectionChange,
}: ReliabilityConsoleProps) {
  const {
    health,
    guard,
    tokenEnv,
    token,
    setToken,
    busyAction,
    actionResult,
    runAction,
    sockets,
    onReconnectSockets,
    pollMs,
    setPaused,
    setPollMs,
    effectivePollMs,
  } = view;

  const latency = health?.summary.latency;
  const hasTraffic = Boolean(latency?.n);
  const unavailableCapabilities = health
    ? Object.entries(health.capabilities)
        .filter(([, capability]) => capability.available.length === 0)
        .map(([capability]) => capability)
    : [];
  const signalProviders = new Set([
    ...(health?.summary.degraded ?? []),
    ...(health?.summary.exhausted ?? []),
    ...(health?.summary.simulated ?? []),
  ]);
  const signalCount = (view.healthError ? 1 : 0)
    + signalProviders.size
    + unavailableCapabilities.length
    + (hasTraffic && (latency?.errorRate ?? 0) > 0.01 ? 1 : 0);

  const overallState = view.healthError
    ? "Unreachable"
    : !health
      ? "Checking"
      : unavailableCapabilities.length || health.summary.degraded.length || health.summary.exhausted.length
        ? "Degraded"
        : hasTraffic && (latency?.errorRate ?? 0) > 0.01
          ? "Upstream instability"
          : health.summary.simulated.length
            ? "Drill active"
            : "Nominal";

  const tiles: ConsoleTile[] = [
    {
      label: "Overall state",
      value: overallState,
      note: view.healthError
        ? health ? "last good snapshot retained" : "no health snapshot available"
        : health?.summary.simulated.length
          ? `${health.summary.simulated.length} controlled drill${health.summary.simulated.length === 1 ? "" : "s"}`
          : signalCount
            ? `${signalCount} active signal${signalCount === 1 ? "" : "s"}`
            : health
              ? "no active dependency symptom"
              : "awaiting snapshot",
      tone: view.healthError
        ? "bad"
        : unavailableCapabilities.length || health?.summary.degraded.length || health?.summary.exhausted.length
          ? "bad"
          : hasTraffic && (latency?.errorRate ?? 0) >= 0.05
            ? "bad"
            : hasTraffic && (latency?.errorRate ?? 0) > 0.01
              ? "warn"
              : health?.summary.simulated.length
                ? "warn"
                : health
                  ? "good"
                  : "neutral",
    },
    {
      label: "Providers ready",
      value: health ? `${health.summary.ready}/${health.summary.total}` : "—",
      note: health
        ? `${health.summary.configured} configured · ${health.summary.degraded.length} open · ${health.summary.exhausted.length} exhausted`
        : "checking registry",
      tone: !health
        ? "neutral"
        : unavailableCapabilities.length || signalProviders.size
          ? "warn"
          : "good",
    },
    {
      label: "Upstream success",
      value: hasTraffic
        ? `${fmt((1 - (latency?.errorRate ?? 0)) * 100, 1)}%`
        : "—",
      note: hasTraffic ? `n=${latency?.n ?? 0} provider / venue attempts` : "no attempts sampled yet",
      tone: !hasTraffic ? "neutral" : (latency?.errorRate ?? 0) >= 0.05 ? "bad" : (latency?.errorRate ?? 0) > 0.01 ? "warn" : "good",
    },
    {
      label: "Upstream p95",
      value: hasTraffic ? `${fmt(latency?.p95 ?? 0, 0)}ms` : "—",
      note: hasTraffic
        ? `p50 ${fmt(latency?.p50 ?? 0, 0)}ms · p99 ${fmt(latency?.p99 ?? 0, 0)}ms`
        : "no attempts sampled yet",
      tone: "neutral",
    },
  ];

  const openDrilldown = (next: ReliabilityDrilldown) => {
    onSectionChange(next);
    window.requestAnimationFrame(() => {
      document.getElementById(`reliability-subtab-${next}`)?.focus();
    });
  };

  const openData = () => {
    onOpenData();
    window.requestAnimationFrame(() => document.getElementById("tab-data")?.focus());
  };

  return (
    <>
      <ConsoleChrome view={view} tiles={tiles} />

      {section !== "controls" && actionResult && (
        <OperatorActionResult result={actionResult} />
      )}

      <WorkspaceSubtabs
        workspaceId="reliability"
        label="Reliability engineer sections"
        tabs={RELIABILITY_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
      />

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="overview" activeId={section}>
        <ReliabilityOverview
          view={view}
          onOpenSection={openDrilldown}
          onOpenData={openData}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel
        workspaceId="reliability"
        tabId="services"
        activeId={section}
        className="reliability-service-panel"
      >
        <HealthMatrix
          providers={health?.providers ?? null}
          routes={health?.routes ?? []}
          venues={health?.venues ?? []}
          guard={guard}
          operatorReady={guard === "open-dev" || (guard === "token" && Boolean(token.trim()))}
          busyAction={busyAction}
          onAction={runAction}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="events" activeId={section}>
        <TraceConsole
          pollMs={pollMs || 30_000}
          active={section === "events"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="controls" activeId={section}>
        <OperatorPanel
          guard={guard}
          tokenEnv={tokenEnv}
          providers={health?.providers ?? null}
          symbol={workspaceSymbol}
          pollMs={effectivePollMs}
          onPollMsChange={(ms) => {
            setPaused(ms === 0);
            if (ms > 0) setPollMs(ms);
          }}
          socketCount={sockets.length}
          onReconnectSockets={onReconnectSockets}
          busyAction={busyAction}
          lastResult={actionResult}
          token={token}
          onTokenChange={setToken}
          onAction={runAction}
        />
      </WorkspaceSubtabPanel>
    </>
  );
}
