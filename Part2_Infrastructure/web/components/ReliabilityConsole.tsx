"use client";

/**
 * SRE's tab: is the platform up, and if not, which layer broke?
 *
 * The role's blueprint asks to locate a failure in compute, network, provider,
 * cache or broker connectivity without opening several dashboards, so the
 * ordering answers that question directly — the matrix says which provider and
 * which breaker, the trace says when it started, and the operator panel is where
 * you do something about it, including rehearsing an outage before a real one.
 *
 * Reads are free and always available; writes are gated and every control states
 * its cost. The gateway's own `/metrics` endpoint is the scrape surface for all
 * of this — this tab is the human view of the same counters.
 */

import HealthMatrix from "@/components/systems/HealthMatrix";
import OperatorPanel from "@/components/systems/OperatorPanel";
import TraceConsole from "@/components/systems/TraceConsole";
import {
  ConsoleChrome,
  type ConsoleTile,
  latencyTile,
  providerTile,
} from "@/components/systems/ConsoleChrome";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface ReliabilityConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenData: () => void;
}

export default function ReliabilityConsole({
  view,
  workspaceSymbol,
  onOpenData,
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
    paused,
    setPaused,
    setPollMs,
    effectivePollMs,
  } = view;

  const tiles: ConsoleTile[] = [
    providerTile(view),
    latencyTile(view),
    {
      label: "Open sockets",
      value: String(sockets.length),
      note: sockets.length ? sockets.map((s) => s.venue).join(" · ") : "wire tap idle",
      tone: "good",
    },
  ];

  return (
    <>
      <ConsoleChrome view={view} tiles={tiles} />

      <div className="console-layout">
        <div className="console-column console-column--wide">
          <HealthMatrix
            providers={health?.providers ?? null}
            routes={health?.routes ?? []}
            venues={health?.venues ?? []}
            guard={guard}
            busyAction={busyAction}
            onAction={runAction}
          />

          <TraceConsole
            pollMs={pollMs || 30_000}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
          />
        </div>

        <div className="console-column console-column--narrow">
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

          <div className="card cross-link-tile">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Owned by data engineering</span>
                <h2>Data quality</h2>
              </div>
              <button className="text-action" onClick={onOpenData}>Open Data →</button>
            </div>
            <p className="sub">
              A green breaker only means the provider answered. Whether the payload passed its
              contract is the neighbouring question, and an incident often starts there.
            </p>
            <div className="cross-link-metrics">
              <div>
                <span>Quarantined</span>
                <strong className={`num${health?.quarantine?.size ? " warn" : ""}`}>
                  {health?.quarantine?.size ?? 0}
                </strong>
                <small>payloads held back</small>
              </div>
              <div>
                <span>Cache entries</span>
                <strong className="num">{health?.cache.entries ?? 0}</strong>
                <small>served without a vendor call</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
