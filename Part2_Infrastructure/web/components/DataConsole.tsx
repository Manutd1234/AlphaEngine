"use client";

/**
 * Data engineer's tab: is what arrived actually true?
 *
 * The blueprint's line for this role is that the improvement worth making is
 * more trustworthy data rather than more of it. The work queue opens first so
 * operational demand has one place to land; the diagnostic subtabs then follow
 * a request through routing and lineage to reconciliation, quarantine, and the
 * budget for asking.
 *
 * Transport health belongs to the Reliability tab. A provider can answer
 * quickly, from a closed breaker, with a bar series that halves the volatility a
 * backtest measures — those are different failures and they are read by
 * different people.
 */

import CrossSourceCheck from "@/components/systems/CrossSourceCheck";
import FailoverGraph from "@/components/systems/FailoverGraph";
import PipelineInspector from "@/components/systems/PipelineInspector";
import QuarantinePanel from "@/components/systems/QuarantinePanel";
import QuotaMeters from "@/components/systems/QuotaMeters";
import { ConsoleChrome, type ConsoleTile, providerTile } from "@/components/systems/ConsoleChrome";
import DataWorkBoard from "@/components/data/DataWorkBoard";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { DataWorkItem } from "@/lib/data-work-queue";
import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export type DataSection = "queue" | "routing" | "pipeline" | "quality" | "capacity";

const DATA_SECTIONS = [
  { id: "queue", label: "Work queue", description: "Requests, tickets & bugs" },
  { id: "routing", label: "Routing", description: "Provider path & failover" },
  { id: "pipeline", label: "Pipeline", description: "Trace, lineage & payloads" },
  { id: "quality", label: "Quality", description: "Reconcile & quarantine" },
  { id: "capacity", label: "Capacity", description: "Quota, reserve & cache" },
] as const;

export interface DataConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onWorkspaceSymbolChange: (symbol: string) => void;
  onOpenReliability: () => void;
  section: DataSection;
  onSectionChange: (section: DataSection) => void;
  workItems: DataWorkItem[];
  onWorkItemsChange: (items: DataWorkItem[]) => void;
}

export default function DataConsole({
  view,
  workspaceSymbol,
  onWorkspaceSymbolChange,
  onOpenReliability,
  section,
  onSectionChange,
  workItems,
  onWorkItemsChange,
}: DataConsoleProps) {
  const { health, route, setRoute, guard, busyAction, runAction, effectivePollMs, logLocal } = view;

  const quarantined = health?.quarantine?.size ?? 0;
  const tiles: ConsoleTile[] = [
    providerTile(view),
    {
      label: "Quarantined payloads",
      value: String(quarantined),
      note: quarantined
        ? `${health?.quarantine?.byProvider.length ?? 0} provider${(health?.quarantine?.byProvider.length ?? 0) === 1 ? "" : "s"} affected`
        : "no contract violations held",
      tone: quarantined ? "warn" : "good",
    },
    {
      label: "Cache hit rate",
      value: view.cacheHitRate === null ? "—" : `${fmt(view.cacheHitRate * 100, 1)}%`,
      note: health ? `${health.summary.cache.hits} hits · ${health.summary.cache.misses} misses` : "",
      tone: "good",
    },
    {
      label: "Lineage events",
      value: health ? String(health.events.retained) : "—",
      note: health ? `${health.events.retained}/${health.events.capacity} retained` : "checking event ring",
      tone: health && health.events.retained >= health.events.capacity ? "warn" : "good",
    },
  ];

  return (
    <>
      <ConsoleChrome view={view} tiles={tiles} />

      <WorkspaceSubtabs
        workspaceId="data"
        label="Data engineer sections"
        tabs={DATA_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
      />

      <WorkspaceSubtabPanel workspaceId="data" tabId="queue" activeId={section}>
        <DataWorkBoard items={workItems} onItemsChange={onWorkItemsChange} />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="routing" activeId={section}>
        <div className="data-console-stack">
          <FailoverGraph
            routes={health?.routes ?? []}
            selected={route}
            onSelect={setRoute}
            cacheByCapability={health?.cache.byCapability ?? {}}
            priority={health?.routePriority ?? "interactive"}
            guard={guard}
            busyAction={busyAction}
            onAction={runAction}
          />
          <aside className="card data-console-handoff" aria-label="Reliability ownership handoff">
            <div>
              <div>
                <span className="page-kicker">Owned by reliability</span>
                <h2>Need transport diagnostics?</h2>
              </div>
              <p className="sub">
                Breaker states, latency percentiles and failure drills live with the SRE workflow;
                this workspace follows correctness and provenance.
              </p>
            </div>
            <div className="cross-link-metrics">
              <div>
                <span>Breakers open</span>
                <strong className={`num${view.degraded ? " warn" : ""}`}>{view.degraded}</strong>
                <small>degraded or exhausted</small>
              </div>
              <div>
                <span>Sockets</span>
                <strong className="num">{view.sockets.length}</strong>
                <small>{view.sockets.length ? view.sockets.map((s) => s.venue).join(" · ") : "wire tap idle"}</small>
              </div>
            </div>
            <button className="text-action" onClick={onOpenReliability}>Open Reliability →</button>
          </aside>
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="pipeline" activeId={section}>
        <PipelineInspector
          symbol={workspaceSymbol}
          onSymbolChange={onWorkspaceSymbolChange}
          pollMs={effectivePollMs}
          onEvent={logLocal}
          active={section === "pipeline"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="quality" activeId={section}>
        <div className="data-console-pair">
          <CrossSourceCheck symbol={workspaceSymbol} />

          {/* Transport health and data health are different questions: a
              provider can answer quickly, from a closed breaker, with a bar
              series that halves the volatility a backtest measures. */}
          <QuarantinePanel
            size={health?.quarantine?.size ?? 0}
            byProvider={health?.quarantine?.byProvider ?? []}
            recent={health?.quarantine?.recent ?? []}
          />
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="capacity" activeId={section}>
        <QuotaMeters
          providers={health?.providers ?? null}
          cacheByCapability={health?.cache.byCapability ?? {}}
          cacheEntries={health?.cache.entries ?? 0}
        />
      </WorkspaceSubtabPanel>
    </>
  );
}
