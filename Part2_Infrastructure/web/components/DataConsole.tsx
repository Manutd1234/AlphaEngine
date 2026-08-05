"use client";

/**
 * Data engineer's tab: is what arrived actually true?
 *
 * The blueprint's line for this role is that the improvement worth making is
 * more trustworthy data rather than more of it, so this tab is ordered by trust
 * rather than by traffic: where a request would be routed, whether independent
 * sources agree on the price, what was quarantined for failing its contract, and
 * what the budget for asking looks like.
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
import { fmt } from "@/lib/format";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface DataConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onWorkspaceSymbolChange: (symbol: string) => void;
  onOpenReliability: () => void;
}

export default function DataConsole({
  view,
  workspaceSymbol,
  onWorkspaceSymbolChange,
  onOpenReliability,
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

      <div className="console-layout">
        <div className="console-column console-column--wide">
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

          <CrossSourceCheck symbol={workspaceSymbol} />

          {/* Transport health and data health are different questions: a
              provider can answer quickly, from a closed breaker, with a bar
              series that halves the volatility a backtest measures. */}
          <QuarantinePanel
            size={health?.quarantine?.size ?? 0}
            byProvider={health?.quarantine?.byProvider ?? []}
            recent={health?.quarantine?.recent ?? []}
          />

          <QuotaMeters
            providers={health?.providers ?? null}
            cacheByCapability={health?.cache.byCapability ?? {}}
            cacheEntries={health?.cache.entries ?? 0}
          />
        </div>

        <div className="console-column console-column--narrow">
          <PipelineInspector
            symbol={workspaceSymbol}
            onSymbolChange={onWorkspaceSymbolChange}
            pollMs={effectivePollMs}
            onEvent={logLocal}
          />

          <div className="card cross-link-tile">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Owned by reliability</span>
                <h2>Transport health</h2>
              </div>
              <button className="text-action" onClick={onOpenReliability}>Open Reliability →</button>
            </div>
            <p className="sub">
              Breaker states, latency percentiles and the operator drills that exercise them. A feed
              that is <em>up</em> and a feed that is <em>correct</em> are separate questions; this tab
              answers the second.
            </p>
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
          </div>
        </div>
      </div>
    </>
  );
}
