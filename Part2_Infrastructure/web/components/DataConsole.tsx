"use client";

/**
 * Data engineer control plane: can the desk trust the number it is about to use?
 *
 * The first view is evidence, not administration. Quality, lineage and provider
 * capacity are live diagnostic surfaces; the work queue is deliberately last,
 * persisted on the gateway and labelled with where its rows came from.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { metricsForSection } from "@/components/data/data-console-metrics";
import DataQualityLedger from "@/components/data/DataQualityLedger";
import ReplayBackfillPanel, { REPLAY_BACKFILL_HEADING } from "@/components/data/ReplayBackfillPanel";
import DataTrustOverview from "@/components/data/DataTrustOverview";
import DataWorkBoard, { type DataWorkMutation } from "@/components/data/DataWorkBoard";
import CrossSourceCheck from "@/components/systems/CrossSourceCheck";
import FailoverGraph from "@/components/systems/FailoverGraph";
import { OperatorActionResult } from "@/components/systems/OperatorPanel";
import OutageIncidents from "@/components/systems/OutageIncidents";
import PipelineInspector from "@/components/systems/PipelineInspector";
import QuarantinePanel from "@/components/systems/QuarantinePanel";
import QuotaMeters from "@/components/systems/QuotaMeters";
import type { InspectResponse } from "@/components/systems/types";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import PageHead from "@/components/workspace/PageHead";
import type { DataWorkItem, DataWorkSource } from "@/lib/data-work-queue";
import { deriveDataTrust } from "@/lib/data-trust";
import { DATA_SECTIONS, type DataSection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";

export { DATA_SECTION_IDS, type DataSection } from "@/lib/sections";

export interface DataConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  workspaceInterval: string;
  onWorkspaceSymbolChange: (symbol: string) => void;
  onOpenReliability: () => void;
  section: DataSection;
  onSectionChange: (section: DataSection) => void;
  workItems: DataWorkItem[];
  onWorkItemsChange: (items: DataWorkItem[]) => void;
  /** Where the work items came from and how to persist an edit; absent in a bare render. */
  workSource?: DataWorkSource;
  onWorkMutation?: (mutation: DataWorkMutation) => void;
  pendingWorkWrites?: number;
  /** The last thing the gateway said about a work-queue write. */
  workNotice?: string | null;
  /** False while this workspace is mounted but hidden behind another tab. */
  active?: boolean;
}

/**
 * Two panes, and the cards named them first: the failover card's kicker
 * already reads "Routing" and the quota card's "Budget". Side by side each got
 * half of the panel, which wrapped a multi-node chain onto three rows and gave
 * the quota meters and cache table half the room their columns were drawn for.
 * One at a time, at full width — and they degrade separately: the chain comes
 * from the routing registry before any call is spent, while the quota ledger
 * only carries entries for metered providers.
 */
type ProvidersPane = "routing" | "budget";

const PROVIDERS_PANES: Array<{ id: ProvidersPane; label: string; hint: string }> = [
  {
    id: "routing",
    label: "Routing",
    hint: "The failover chain a request walks now, and the failover drill",
  },
  {
    id: "budget",
    label: "Budget",
    hint: "What each metered provider has left before background polling is fenced out",
  },
];

export default function DataConsole({
  view,
  workspaceSymbol,
  workspaceInterval,
  onWorkspaceSymbolChange,
  onOpenReliability,
  section,
  onSectionChange,
  workItems,
  onWorkItemsChange,
  workSource,
  onWorkMutation,
  pendingWorkWrites = 0,
  workNotice = null,
  active = true,
}: DataConsoleProps) {
  const {
    health, route, setRoute, guard, operatorReady, busyAction, actionResult, runAction,
    effectivePollMs, logLocal,
  } = view;
  const validation = health?.validation;
  const [probe, setProbe] = useState<InspectResponse | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeSymbol, setProbeSymbol] = useState(workspaceSymbol);
  // Opens on Routing: "Open providers" on the incidents tab's outage card
  // exists to show the reader the failover graph an outage is bending, so the
  // pane a cross-link lands on must be the one holding the graph.
  const [providersPane, setProvidersPane] = useState<ProvidersPane>("routing");
  const [replayOpen, setReplayOpen] = useState(false);
  const probeSequence = useRef(0);
  const activeProbeRequest = useRef<AbortController | null>(null);

  const refreshProbe = useCallback(async (force: boolean) => {
    activeProbeRequest.current?.abort();
    const controller = new AbortController();
    activeProbeRequest.current = controller;
    const sequence = ++probeSequence.current;
    setProbeSymbol(workspaceSymbol);
    setProbeLoading(true);
    setProbeError(null);
    try {
      const params = new URLSearchParams({
        symbol: workspaceSymbol,
        capability: "quote",
        priority: force ? "interactive" : "background",
      });
      if (force) params.set("refresh", "1");
      const response = await fetch(`/api/system/inspect?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (sequence !== probeSequence.current) return;
      if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
      const next = body as InspectResponse;
      if (next.symbol !== workspaceSymbol || next.capability !== "quote") {
        throw new Error("trust probe returned a different request identity");
      }
      setProbe(next);
      setProbeError(next.ok ? null : next.error ?? "no provider could answer the trust probe");
    } catch (error) {
      if ((error as Error).name !== "AbortError" && sequence === probeSequence.current) {
        setProbe(null);
        setProbeError(error instanceof Error ? error.message : "trust probe failed");
      }
    } finally {
      if (sequence === probeSequence.current) setProbeLoading(false);
      if (activeProbeRequest.current === controller) activeProbeRequest.current = null;
    }
  }, [workspaceSymbol]);

  useEffect(() => {
    setProbe(null);
    void refreshProbe(false);
    return () => {
      probeSequence.current += 1;
      activeProbeRequest.current?.abort();
    };
  }, [refreshProbe]);

  // Effects run after render. Gate the prior symbol's evidence during that one
  // render so a BTC heading can never briefly inherit AAPL's contract result.
  const currentProbe = probeSymbol === workspaceSymbol ? probe : null;
  const currentProbeError = probeSymbol === workspaceSymbol ? probeError : null;
  const currentProbeLoading = probeSymbol !== workspaceSymbol || probeLoading;
  const trust = deriveDataTrust(health, {
    symbol: workspaceSymbol,
    healthError: view.healthError,
    probe: currentProbe,
    probeError: currentProbeError,
    probeLoading: currentProbeLoading,
  });
  const trustState = {
    label: trust.verdict.label,
    tone: trust.verdict.tone === "unknown" ? "neutral" as const : trust.verdict.tone,
  };
  const metrics = metricsForSection(
    view,
    section,
    workspaceSymbol,
    workspaceInterval,
    workItems,
    workSource,
    pendingWorkWrites,
    currentProbe,
    currentProbeLoading,
    currentProbeError,
  );

  return (
    <div className="data-control-plane" data-data-section={section}>
      <PageHead
        kicker="Data engineer"
        title="Data operations"
        showTitle={false}
        description="Can the desk trust the number it is about to use?"
        metrics={metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          note: metric.note,
          tone: metric.tone === "bad" ? "critical" : metric.tone,
          wide: metric.wide,
        }))}
        status={{
          label: trustState.label,
          tone: trustState.tone === "bad" ? "critical" : trustState.tone === "good" ? "good" : trustState.tone === "warn" ? "warn" : "neutral",
        }}
        actions={
          <>
            <FreshnessStamp updatedAt={view.updatedAt} pollMs={effectivePollMs} paused={view.paused} />
            <button
              type="button"
              onClick={() => void Promise.all([view.refresh(false), refreshProbe(true)])}
              disabled={busyAction !== null || currentProbeLoading}
            >
              Refresh evidence
            </button>
          </>
        }
      />

      {view.healthError && (
        <div className="banner error" role="alert">
          <span aria-hidden>✕</span>
          <div><strong>System health is unreachable.</strong> {view.healthError}</div>
        </div>
      )}

      <WorkspaceSubtabs
        workspaceId="data"
        label="Data trust sections"
        tabs={DATA_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        secondary={["queue"]}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="data" tabId="overview" activeId={section}>
        <DataTrustOverview
          health={health}
          healthError={view.healthError}
          symbol={workspaceSymbol}
          probe={currentProbe}
          probeError={currentProbeError}
          probeLoading={currentProbeLoading}
          onOpenSection={onSectionChange}
          view="summary"
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="feeds" activeId={section}>
        <DataTrustOverview
          health={health}
          healthError={view.healthError}
          symbol={workspaceSymbol}
          probe={currentProbe}
          probeError={currentProbeError}
          probeLoading={currentProbeLoading}
          onOpenSection={onSectionChange}
          view="feeds"
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="quality" activeId={section}>
        <CrossSourceCheck symbol={workspaceSymbol} />
        <DataQualityLedger validation={validation} healthLoaded={health !== null} guard={guard} operatorReady={operatorReady} operatorToken={view.token} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="incidents" activeId={section}>
        {/* The incident half of the old subtab, and the pair earns its keep
            here: an outage is a transport incident, quarantine is the content
            failure beside it, and the two cards are the two readings of one
            question — what has been held out, and why. */}
        <div className="data-console-pair">
          <OutageIncidents
            outages={health?.outages ?? []}
            providerLabels={Object.fromEntries(
              (health?.providers ?? []).map((p) => [p.id, p.label]),
            )}
            onOpenProviders={() => onSectionChange("providers")}
          />
          <QuarantinePanel
            size={health?.quarantine?.size ?? 0}
            byProvider={health?.quarantine?.byProvider ?? []}
            recent={health?.quarantine?.recent ?? []}
            validation={validation}
          />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="lineage" activeId={section}>
        <PipelineInspector
          symbol={workspaceSymbol}
          interval={workspaceInterval}
          onSymbolChange={onWorkspaceSymbolChange}
          pollMs={effectivePollMs}
          onEvent={logLocal}
          active={active && section === "lineage"}
        />
        <details
          className="disclosure"
          onToggle={(event) => setReplayOpen(event.currentTarget.open)}
        >
          <summary>{REPLAY_BACKFILL_HEADING}</summary>
          <ReplayBackfillPanel
            symbol={workspaceSymbol}
            interval={workspaceInterval}
            pollMs={effectivePollMs}
            active={active && section === "lineage" && replayOpen}
            guard={guard}
            operatorReady={operatorReady}
            operatorToken={view.token}
          />
        </details>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="providers" activeId={section}>
        {/* Actions fired from this panel must answer on this panel — the shared
            hook state also mirrors into Reliability, but a 401 that only
            reports two workspaces away is indistinguishable from nothing.
            Above the pane switcher rather than inside the Routing pane that
            fires the actions: a slow answer must not land behind whichever
            pane the reader has moved on to. */}
        {actionResult && <OperatorActionResult result={actionResult} />}
        <div className="seg" role="group" aria-label="Providers and capacity view">
          {PROVIDERS_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={providersPane === option.id}
              title={option.hint}
              onClick={() => setProvidersPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* The chain and the ledger sat side by side in a `.compact-grid-2col`,
            which gave a multi-node failover chain and a four-column cache table
            half the panel each. One pane at a time, full width. */}
        {providersPane === "routing" && (
          <div className="data-console-stack">
            <FailoverGraph
              routes={health?.routes ?? []}
              selected={route}
              onSelect={setRoute}
              cacheByCapability={health?.cache.byCapability ?? {}}
              guard={guard}
              operatorReady={operatorReady}
              busyAction={busyAction}
              onAction={runAction}
            />
            {/* Under Routing, not Budget: the card's own numbers — degraded
                routes and live sockets — are transport state, and the reader it
                serves has just watched a chain fail over and wants the breaker
                and latency story behind it. */}
            <aside className="card data-console-handoff" aria-label="Reliability ownership handoff">
              <div>
                <span className="page-kicker">Owned by reliability</span>
                <h2>Need transport diagnostics?</h2>
                {/* "live with the SRE workflow" is the kicker above ("Owned by
                    reliability") and the button below ("Open Reliability") saying
                    it a third time. The list is what this card alone tells you. */}
                <p className="sub">Breaker timelines, latency SLOs, failure drills and remediation controls.</p>
              </div>
              <div className="cross-link-metrics">
                <div><span>Route issues</span><strong className={`num${view.degraded ? " warn" : ""}`}>{view.degraded}</strong><small>degraded or exhausted</small></div>
                <div><span>Sockets</span><strong className="num">{view.sockets.length}</strong><small>{view.sockets.length ? view.sockets.map((socket) => socket.venue).join(", ") : "wire tap idle"}</small></div>
              </div>
              <button className="text-action" onClick={onOpenReliability}>Open Reliability →</button>
            </aside>
          </div>
        )}

        {providersPane === "budget" && (
          <QuotaMeters providers={health?.providers ?? null} />
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="queue" activeId={section}>
        <DataWorkBoard
          items={workItems}
          onItemsChange={onWorkItemsChange}
          source={workSource}
          onMutation={onWorkMutation}
          pendingWrites={pendingWorkWrites}
          readOnly={guard === "locked"}
          readOnlyReason={guard === "locked" ? "Operator actions are disabled on this deployment, so this queue is read-only." : undefined}
        />
        {workNotice && <p className="sr-only" role="status" aria-live="polite">{workNotice}</p>}
      </WorkspaceSubtabPanel>
    </div>
  );
}
