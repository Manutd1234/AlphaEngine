"use client";

/**
 * SRE's tab: is the platform up, and if not, which layer broke?
 *
 * The role's blueprint asks to locate a failure in compute, network, provider,
 * cache or broker connectivity without opening several dashboards, so the
 * workflow answers that question in layers — Telemetry surfaces symptoms, the
 * Services matrix says which provider or breaker is involved, Logs says when
 * it started, and Remediation is where a guarded response or drill is performed.
 *
 * Reads are free and always available; writes are gated and every control states
 * its cost. Provider-routing telemetry and the trading gateway are separate
 * observation planes; this UI keeps their source and scope explicit.
 */

import { useRef, useState } from "react";

import HealthMatrix from "@/components/systems/HealthMatrix";
import OperatorPanel, { OperatorActionResult } from "@/components/systems/OperatorPanel";
import ReliabilityOverview, { type ReliabilityDrilldown } from "@/components/systems/ReliabilityOverview";
import TraceConsole from "@/components/systems/TraceConsole";
import { ConsoleChrome, type ConsoleTile } from "@/components/systems/ConsoleChrome";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { fmt } from "@/lib/format";
import { LATENCY_MIN_SAMPLES, latencyTone } from "@/lib/overview-state";
import { deriveReliabilityPosture, type ReliabilityStatus } from "@/lib/reliability";
import type { SystemHealthView } from "@/lib/use-system-health";

export type ReliabilitySection = "overview" | "services" | "events" | "controls";

export const RELIABILITY_SECTION_IDS: ReliabilitySection[] = ["overview", "services", "events", "controls"];

const RELIABILITY_SECTIONS = [
  { id: "overview", label: "Telemetry & SLIs", description: "Signals, scope & active impact" },
  { id: "services", label: "Services & Circuits", description: "Providers, venues & failover" },
  { id: "events", label: "Logs & Traces", description: "Cross-origin event investigation" },
  { id: "controls", label: "Remediation", description: "Guarded, scoped operator actions" },
] as const;

export interface ReliabilityConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenData: () => void;
  section: ReliabilitySection;
  onSectionChange: (section: ReliabilitySection) => void;
}

const POSTURE_LABEL: Record<ReliabilityStatus, string> = {
  nominal: "Nominal",
  degraded: "Degraded",
  critical: "Critical",
  halted: "Trading halted",
  unknown: "Unknown",
};

function postureTone(status: ReliabilityStatus | undefined): ConsoleTile["tone"] {
  if (status === "critical" || status === "halted") return "bad";
  if (status === "degraded" || status === "unknown") return "warn";
  if (status === "nominal") return "good";
  return "neutral";
}

export default function ReliabilityConsole({
  view,
  workspaceSymbol,
  onOpenData,
  section,
  onSectionChange,
}: ReliabilityConsoleProps) {
  const [traceFilterRequest, setTraceFilterRequest] = useState<{
    id: number;
    query: string;
    label: string;
  } | null>(null);
  const traceFilterSequence = useRef(0);
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
  const posture = health ? deriveReliabilityPosture(health) : null;

  const overallState = view.healthError
    ? "Unreachable"
    : !posture
      ? "Checking"
      : POSTURE_LABEL[posture.overall];

  const openDrilldown = (next: ReliabilityDrilldown, targetId?: string) => {
    onSectionChange(next);
    window.requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      (target ?? document.getElementById(`reliability-subtab-${next}`))?.focus();
    });
  };

  const latencyState = latencyTone(latency?.p99 ?? null, latency?.n ?? 0, latency?.errorRate ?? 0);
  const hasReliableP99 = Boolean(
    latency?.p99 != null && (latency?.n ?? 0) >= LATENCY_MIN_SAMPLES,
  );

  const tiles: ConsoleTile[] = [
    {
      label: "Overall state",
      value: overallState,
      note: view.healthError
        ? health ? "last good snapshot retained" : "no health snapshot available"
        : posture
          ? `trading ${POSTURE_LABEL[posture.paths.trading.status].toLowerCase()} · research ${POSTURE_LABEL[posture.paths.research.status].toLowerCase()}`
          : "awaiting snapshot",
      tone: view.healthError
        ? "bad"
        : postureTone(posture?.overall),
    },
    {
      label: "Trading path",
      value: posture ? POSTURE_LABEL[posture.paths.trading.status] : "—",
      note: posture?.paths.trading.reason ?? "awaiting gateway source",
      tone: postureTone(posture?.paths.trading.status),
    },
    {
      label: "Provider APIs",
      value: health ? `${health.summary.ready}/${health.summary.total}` : "—",
      note: health
        ? `${health.summary.configured} configured · ${health.summary.ready} routable`
        : "checking provider registry",
      tone: postureTone(posture?.paths.research.status),
      actionLabel: "View every provider",
      onClick: () => openDrilldown("services", "reliability-provider-health"),
    },
    {
      label: "Tail latency (p99)",
      value: hasReliableP99 ? `${fmt(latency?.p99 ?? 0, 0)}ms` : "Collecting",
      note: hasReliableP99
        ? `99% completed within this · ${latencyState.label} · n=${latency?.n ?? 0}`
        : `${latency?.n ?? 0}/${LATENCY_MIN_SAMPLES} samples · not a failure`,
      tone: latencyState.tone === "bad" ? "bad" : latencyState.tone === "warn" ? "warn" : "neutral",
      actionLabel: "Explain p99",
      onClick: () => openDrilldown("services", "reliability-latency-guide"),
    },
  ];

  const openData = () => {
    onOpenData();
    window.requestAnimationFrame(() => document.getElementById("tab-data")?.focus());
  };

  const openEventsFor = (query: string, label: string) => {
    traceFilterSequence.current += 1;
    setTraceFilterRequest({ id: traceFilterSequence.current, query, label });
    openDrilldown("events");
  };

  return (
    <>
      <ConsoleChrome
        view={view}
        tiles={tiles}
        kicker="DevOps / SRE"
        title="Reliability"
        description="Is the desk up, what is degrading it, and which control brings it back — read from one health snapshot."
      />

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
          onInspectEvents={openEventsFor}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="reliability" tabId="events" activeId={section}>
        <TraceConsole
          pollMs={pollMs || 30_000}
          active={section === "events"}
          filterRequest={traceFilterRequest}
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
