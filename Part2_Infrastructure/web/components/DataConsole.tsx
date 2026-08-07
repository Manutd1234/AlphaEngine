"use client";

/**
 * Data engineer control plane: can the desk trust the number it is about to use?
 *
 * The first view is evidence, not administration. Quality, lineage and provider
 * capacity are live diagnostic surfaces; the work queue is deliberately last
 * and labelled as a session-only case-assessment sample.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import DataTrustOverview from "@/components/data/DataTrustOverview";
import DataWorkBoard from "@/components/data/DataWorkBoard";
import CrossSourceCheck from "@/components/systems/CrossSourceCheck";
import FailoverGraph from "@/components/systems/FailoverGraph";
import PipelineInspector from "@/components/systems/PipelineInspector";
import QuarantinePanel from "@/components/systems/QuarantinePanel";
import QuotaMeters from "@/components/systems/QuotaMeters";
import type { InspectResponse } from "@/components/systems/types";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import FreshnessStamp from "@/components/workspace/FreshnessStamp";
import PageHead from "@/components/workspace/PageHead";
import type { DataWorkItem } from "@/lib/data-work-queue";
import { deriveDataTrust } from "@/lib/data-trust";
import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export const DATA_SECTION_IDS = ["overview", "quality", "lineage", "providers", "queue"] as const;
export type DataSection = (typeof DATA_SECTION_IDS)[number];

const DATA_SECTIONS = [
  { id: "overview", label: "Overview & Trust", description: "Freshness, validation & next action" },
  { id: "quality", label: "Quality & Incidents", description: "Reconcile, contracts & quarantine" },
  { id: "lineage", label: "Lineage & Payloads", description: "Trace source, cache & coercion" },
  { id: "providers", label: "Providers & Capacity", description: "Failover, quota & reserve" },
  { id: "queue", label: "Work Queue", description: "Mocked, session-only workflow" },
] as const;

interface DataBarMetric {
  label: string;
  value: string;
  note: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

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
}

function absoluteTime(value: string | Date | null): string {
  if (!value) return "not observed";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

function metricsForSection(
  view: SystemHealthView,
  section: DataSection,
  symbol: string,
  interval: string,
  workItems: DataWorkItem[],
  probe: InspectResponse | null,
  probeLoading: boolean,
  probeError: string | null,
): DataBarMetric[] {
  const health = view.health;
  const validation = health?.validation;
  const quarantined = health?.quarantine?.size ?? 0;
  const rejected = health?.quarantine?.byProvider.reduce((sum, row) => sum + row.rejected, 0) ?? 0;
  const openWork = workItems.filter((item) => item.status !== "resolved");
  const urgentWork = openWork.filter((item) => item.priority === "P0" || item.priority === "P1");
  const activeWork = openWork.filter((item) => item.status === "progress");

  if (section === "quality") {
    return [
      {
        label: "Instance payloads evaluated",
        value: validation ? String(validation.evaluated) : "—",
        note: validation?.lastValidationAt ? `last ${absoluteTime(validation.lastValidationAt)}` : "no validation evidence",
        tone: validation?.evaluated ? "good" : "neutral",
      },
      {
        label: "Fatal findings",
        value: validation ? String(validation.fatal) : "—",
        note: "individual contract findings",
        tone: validation?.fatal ? "bad" : validation?.evaluated ? "good" : "neutral",
      },
      {
        label: "Warning / drift",
        value: validation ? `${validation.warn} / ${validation.drift}` : "—",
        note: "served but labelled",
        tone: validation && validation.warn + validation.drift > 0 ? "warn" : validation?.evaluated ? "good" : "neutral",
      },
      {
        label: "Quarantine buffer",
        value: health?.quarantine ? String(quarantined) : "—",
        note: health?.quarantine ? `${rejected} rejected · ${health.quarantine.byProvider.length} providers represented` : "not exposed by this deployment",
        tone: rejected
          ? "bad"
          : quarantined
            ? "warn"
            : health?.quarantine && validation?.evaluated
              ? "good"
              : "neutral",
      },
    ];
  }

  if (section === "lineage") {
    return [
      { label: "Instrument", value: symbol, note: interval, tone: "neutral" },
      {
        label: "Lineage events",
        value: health ? String(health.events.retained) : "—",
        note: health ? `${health.events.retained}/${health.events.capacity} retained` : "waiting for health snapshot",
        tone: health && health.events.retained >= health.events.capacity ? "warn" : "neutral",
      },
      {
        label: "Cache hit rate",
        value: view.cacheHitRate === null ? "—" : `${fmt(view.cacheHitRate * 100, 1)}%`,
        note: health ? `${health.summary.cache.hits} hits · ${health.summary.cache.misses} misses` : "no observations",
        tone: "neutral",
      },
      {
        label: "Contract coverage",
        value: "Quote + bars",
        note: "other capabilities not evaluated",
        tone: "warn",
      },
    ];
  }

  if (section === "providers") {
    return [
      {
        label: "Providers ready",
        value: health ? `${health.summary.ready}/${health.summary.total}` : "—",
        note: health ? `${health.summary.configured} configured` : "checking registry",
        tone: view.degraded
          ? "warn"
          : health?.summary.configured && health.summary.ready === health.summary.configured
            ? "good"
            : "neutral",
      },
      {
        label: "Degraded / exhausted",
        value: health ? String(view.degraded) : "—",
        note: "route-affecting states",
        tone: view.degraded ? "warn" : health ? "good" : "neutral",
      },
      {
        label: "Route graphs",
        value: health ? String(health.routes.length) : "—",
        note: "capability × asset paths",
        tone: "neutral",
      },
      {
        label: "Cache entries",
        value: health ? String(health.cache.entries) : "—",
        note: health ? `${health.cache.stateEntries} state records` : "not observed",
        tone: "neutral",
      },
    ];
  }

  if (section === "queue") {
    return [
      { label: "Open samples", value: String(openWork.length), note: "browser session only", tone: openWork.length ? "warn" : "good" },
      { label: "P0 / P1", value: String(urgentWork.length), note: "sample priority labels", tone: urgentWork.length ? "warn" : "good" },
      { label: "Active WIP", value: String(activeWork.length), note: "not a live worker queue", tone: activeWork.length > 3 ? "warn" : "neutral" },
      { label: "Persistence", value: "None", note: "reset on reload", tone: "neutral" },
    ];
  }

  const feeds = health?.platform?.market_data.feeds ?? [];
  const freshFeeds = feeds.filter((feed) => feed.status === "up" && feed.connected).length;
  const probeContract = probe?.provenance?.contract;
  return [
    { label: "Instrument", value: symbol, note: interval, tone: "neutral" },
    {
      label: "Validation evidence",
      value: probeLoading
        ? "Checking"
        : probeError
          ? "Unavailable"
          : probeContract
            ? probeContract.violations.length
              ? `${probeContract.violations.length} findings`
              : "Quote checked"
            : "No proof",
      note: probeContract
        ? `active ${symbol} payload · ${probeContract.notEvaluated.length} checks not evaluated`
        : probeError ?? "exact-payload contract result not observed",
      tone: probeError
        ? "bad"
        : probeContract?.violations.some((finding) => finding.severity === "fatal")
          ? "bad"
          : probeContract?.violations.length || probeContract?.notEvaluated.length
            ? "warn"
            : probeContract
              ? "good"
              : "neutral",
    },
    {
      label: "Market feeds up",
      value: health?.platform ? `${freshFeeds}/${feeds.length}` : "—",
      note: health?.platform ? (health.platform.market_data.synthetic_active ? "synthetic feed active" : "gateway observation") : "gateway not observed",
      tone: health?.platform && freshFeeds === feeds.length && feeds.length > 0 ? "good" : "warn",
    },
    {
      label: "Quarantine buffer",
      value: health?.quarantine ? String(quarantined) : "—",
      note: quarantined ? "review held or flagged payloads" : "bounded runtime evidence",
      tone: rejected
        ? "bad"
        : quarantined
          ? "warn"
          : health?.quarantine && validation?.evaluated
            ? "good"
            : "neutral",
    },
  ];
}

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
}: DataConsoleProps) {
  const { health, route, setRoute, guard, busyAction, runAction, effectivePollMs, logLocal } = view;
  const validation = health?.validation;
  const [probe, setProbe] = useState<InspectResponse | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [probeLoading, setProbeLoading] = useState(true);
  const [probeSymbol, setProbeSymbol] = useState(workspaceSymbol);
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
    currentProbe,
    currentProbeLoading,
    currentProbeError,
  );

  return (
    <div className="data-control-plane">
      <PageHead
        kicker="Data engineer"
        title="Data operations"
        description="Can the desk trust the number it is about to use — freshness, source agreement, contract evidence and payload lineage."
        metrics={metrics.map((metric) => ({
          label: metric.label,
          value: metric.value,
          note: metric.note,
          tone: metric.tone === "bad" ? "critical" : metric.tone,
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
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="quality" activeId={section}>
        <div className="data-console-pair">
          <CrossSourceCheck symbol={workspaceSymbol} />
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
          active={section === "lineage"}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="providers" activeId={section}>
        <div className="data-console-stack">
          <div className="compact-grid-2col">
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
            <QuotaMeters
              providers={health?.providers ?? null}
              cacheByCapability={health?.cache.byCapability ?? {}}
              cacheEntries={health?.cache.entries ?? 0}
            />
          </div>
          <aside className="card data-console-handoff" aria-label="Reliability ownership handoff">
            <div>
              <span className="page-kicker">Owned by reliability</span>
              <h2>Need transport diagnostics?</h2>
              <p className="sub">Breaker timelines, latency SLOs, failure drills and remediation controls live with the SRE workflow.</p>
            </div>
            <div className="cross-link-metrics">
              <div><span>Route issues</span><strong className={`num${view.degraded ? " warn" : ""}`}>{view.degraded}</strong><small>degraded or exhausted</small></div>
              <div><span>Sockets</span><strong className="num">{view.sockets.length}</strong><small>{view.sockets.length ? view.sockets.map((socket) => socket.venue).join(" · ") : "wire tap idle"}</small></div>
            </div>
            <button className="text-action" onClick={onOpenReliability}>Open Reliability →</button>
          </aside>
        </div>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="data" tabId="queue" activeId={section}>
        <DataWorkBoard items={workItems} onItemsChange={onWorkItemsChange} />
      </WorkspaceSubtabPanel>
    </div>
  );
}
