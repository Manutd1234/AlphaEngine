"use client";

/**
 * The failover chain, drawn.
 *
 * The old copy said "ranked failover across every configured provider" and left
 * the reader to believe it. This shows the chain the code will actually walk for
 * a given capability and asset class, evaluated with the same checks in the same
 * order as the dispatch loop, and marks the node a request issued right now
 * would land on.
 *
 * The `Trip` control is the point of the panel. "Does failover work" is a
 * question about behaviour, and the only honest way to answer it is to knock the
 * primary out and watch where the next request goes. The outage is server-side,
 * bounded and self-expiring, so the demonstration cannot outlive the person
 * running it.
 *
 * Rendered as ordered nodes and arrows rather than as a drawn SVG graph: the
 * chain is a list, `prefers-reduced-motion` removes every transition globally,
 * and a list stays readable when it wraps onto four lines on a narrow screen.
 */

import { UI_OUTAGE_MS, type ActionOptions } from "@/components/systems/OperatorPanel";
import { fmt, metricRow } from "@/lib/format";
import { routeLabel, routeNoun } from "@/lib/providers/route-labels";
import {
  type FailoverRoute,
  type GuardMode,
  ROUTE_STATE_STYLE,
} from "./types";

interface FailoverGraphProps {
  routes: FailoverRoute[];
  selected: string;
  onSelect: (key: string) => void;
  /** Per-capability, keyed by capability name — not the global figure. */
  cacheByCapability: Record<string, { hitRate: number | null }>;
  guard: GuardMode;
  /** From SystemHealthView — false in token mode until a token is entered. */
  operatorReady: boolean;
  busyAction: string | null;
  onAction: (action: string, options?: ActionOptions) => void;
}

export function routeKey(route: { capability: string; asset: string }): string {
  return `${route.capability}:${route.asset}`;
}

/**
 * The route that actually enters each chain.
 *
 * Written out rather than derived from the capability name: three of these do
 * not match. Bars are served by `/api/ohlcv`, and search and scrape share
 * `/api/research` behind different parameters. Printing `/api/bars` would send a
 * reader to a 404 from the one panel that is supposed to be authoritative about
 * how requests flow.
 */
const ENTRY_ROUTE: Record<string, string> = {
  quote: "/api/quote",
  bars: "/api/ohlcv",
  news: "/api/news",
  fundamentals: "/api/fundamentals",
  search: "/api/research?q=",
  scrape: "/api/research?url=",
};

export default function FailoverGraph({
  routes,
  selected,
  onSelect,
  cacheByCapability,
  guard,
  operatorReady,
  busyAction,
  onAction,
}: FailoverGraphProps) {
  const route = routes.find((r) => routeKey(r) === selected) ?? routes[0] ?? null;
  // Same gate as HealthMatrix: without it, token mode fired an unauthenticated
  // POST from an enabled button and the 401 vanished — this panel renders no
  // action result, so the only trace was a Reliability-side log line.
  const locked = guard === "locked" || !operatorReady;
  const lockNote = guard === "locked"
    ? "Operator actions are disabled on this deployment."
    : !operatorReady
      ? "Enter the operator token in Reliability → Remediation before running provider actions."
      : undefined;
  // The cache node sits inside *this* chain, so it must show this capability's
  // hit rate. The global figure belongs on the status tile, where it is labelled
  // as global — a quote chain reporting a rate driven mostly by bars lookups is
  // a number that means nothing where it is standing.
  const hitRate = route ? cacheByCapability[route.capability]?.hitRate ?? null : null;

  return (
    <div className="card console-card">
      <div className="section-heading compact">
        <div>
          <h2>Failover path</h2>
        </div>
      </div>

      <div className="seg console-route-picker" role="group" aria-label="Capability and asset class">
        {routes.map((r) => {
          const key = routeKey(r);
          return (
            <button
              key={key}
              type="button"
              aria-pressed={key === selected}
              onClick={() => onSelect(key)}
            >
              {routeLabel(r.capability, r.asset)}
            </button>
          );
        })}
      </div>

      {!route && <p className="muted console-empty">No capability is routable in this environment.</p>}

      {route && (
        <>
          <ol className="console-dag" aria-label={`Failover chain for ${routeNoun(route.capability, route.asset)}`}>
            <li className="console-node console-node--fixed">
              <span className="console-node__role">Entry</span>
              <strong>Client request</strong>
              <small className="muted">{ENTRY_ROUTE[route.capability] ?? `/api/${route.capability}`}</small>
            </li>

            <li className="console-edge" aria-hidden>→</li>

            <li className="console-node console-node--fixed">
              <span className="console-node__role">Cache</span>
              <strong>
                {hitRate === null ? "no lookups yet" : `${fmt(hitRate * 100, 1)}% hit`}
              </strong>
              <small className="muted">
                {routeNoun(route.capability, route.asset)} cache; TTL {Math.round(route.cacheTtlMs / 1000)} s; in-process
              </small>
            </li>

            <li className="console-edge" aria-hidden>
              <span className="console-edge__label">miss</span>→
            </li>

            {route.nodes.map((node, index) => {
              const style = ROUTE_STATE_STYLE[node.state];
              return (
                <li
                  key={node.provider}
                  className={`console-node ${node.active ? "is-active" : ""} ${node.state !== "ready" ? "is-down" : ""}`}
                >
                  <span className="console-node__role">
                    Rank {node.rank}
                    {node.active && <span className="console-node__badge">serving</span>}
                  </span>
                  <strong>{node.label}</strong>
                  <span style={{ color: style.tone }} className="console-node__state">
                    <span aria-hidden>{style.icon}</span> {style.label}
                  </span>
                  <small className="muted console-wrap">{node.detail}</small>
                  {/* Configured-and-unreachable is not the same as skipped: dispatch
                      will still try this node and only fall through after it times
                      out, so the routing state and the probe are both shown. */}
                  {node.health && !node.health.ok && (
                    <small className="console-warn console-wrap">
                      <span aria-hidden>▲</span> health probe: {node.health.detail} Dispatch will
                      still attempt it and fail over after the timeout.
                    </small>
                  )}
                  <small className="muted num">
                    {node.latency.n
                      ? metricRow([`p50 ${fmt(node.latency.p50 ?? 0, 0)} ms`, `n=${node.latency.n}`])
                      : "no samples yet"}
                  </small>
                  {node.state === "simulated_outage" ? (
                    <button
                      type="button"
                      className="console-node__action"
                      onClick={() => onAction("clear_outage", { provider: node.provider })}
                      disabled={locked || busyAction !== null}
                      title={lockNote ?? "Restore this provider now."}
                    >
                      Restore
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="console-node__action"
                      onClick={() => onAction("simulate_outage", { provider: node.provider, ttlMs: UI_OUTAGE_MS })}
                      disabled={locked || busyAction !== null || node.state !== "ready"}
                      title={
                        lockNote
                          ?? (node.state === "ready"
                            ? "Simulate an outage here and watch the next request move down the chain."
                            : "Only a routable provider can be knocked out.")
                      }
                    >
                      Simulate outage
                    </button>
                  )}
                  {index < route.nodes.length - 1 && (
                    <span className="console-node__next" aria-hidden>
                      falls through ↓
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="console-dag-note">
            {route.activeProvider ? (
              <>
                A request for <strong>{routeNoun(route.capability, route.asset)}</strong>{" "}
                would be served by <strong>{route.nodes.find((n) => n.active)?.label}</strong>
                {route.nodes.filter((n) => n.rank < (route.nodes.find((x) => x.active)?.rank ?? 0)).length > 0
                  && ", after skipping every higher-ranked provider above it"}.
              </>
            ) : (
              <>
                No provider in this chain is routable — a request for {routeNoun(route.capability, route.asset)}{" "}
                would return <strong>503</strong> with the full skip list attached.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
