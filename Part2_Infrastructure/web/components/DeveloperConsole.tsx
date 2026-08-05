"use client";

/**
 * Quant developer's tab: the contracts, and the evidence they still hold.
 *
 * The role's blueprint asks for stable service contracts so research code can
 * move into production safely, and for a way to debug a request without
 * guessing. Those are the two halves here — the API surface with its committed
 * schema, and the verification that fails loudly when either side drifts.
 *
 * What is listed below is checked, not claimed. Every gate named in the pipeline
 * card runs in CI on each push, and the snapshot check is the one that turns
 * "we documented the API" into "the API cannot change without the docs changing
 * with it".
 */

import { ConsoleChrome, type ConsoleTile, latencyTile } from "@/components/systems/ConsoleChrome";
import type { SystemHealthView } from "@/lib/use-system-health";

const API_SURFACES = [
  { method: "GET", path: "/api/system/health", purpose: "Providers, breakers, latency percentiles, failover graph, cache" },
  { method: "GET", path: "/api/system/events?since=", purpose: "Structured trace, cursored by sequence" },
  { method: "GET", path: "/api/system/inspect?symbol=&raw=1", purpose: "One lookup taken apart, with raw upstream payloads" },
  { method: "POST", path: "/api/system/actions", purpose: "Operator actions — purge, breaker, outage, probe" },
  { method: "GET", path: "/api/quote?symbols=", purpose: "Normalised quote with provider provenance" },
  { method: "GET", path: "/api/ohlcv?symbol=&interval=&bars=", purpose: "Historical bars and source warnings" },
  { method: "GET", path: "/api/depth?symbol=", purpose: "Cross-venue L2 snapshot" },
  { method: "GET", path: "/api/tca?symbol=&side=&notional=", purpose: "Pre-trade cost and routing estimate" },
  { method: "POST", path: "/api/backtest", purpose: "Synchronous research sweep" },
  { method: "GET", path: "/api/providers", purpose: "Provider, quota and circuit health" },
  { method: "GET", path: "/api/gateway/portfolio", purpose: "Authoritative portfolio and risk state" },
  { method: "GET", path: "/api/gateway/portfolio/history", purpose: "Persisted equity snapshots and period P&L" },
  { method: "GET", path: "/api/gateway/audit?feed=", purpose: "Audited orders and risk events for the blotter" },
  { method: "POST", path: "/api/gateway/orders", purpose: "Risk-gated order submission with the full check vector" },
] as const;

/** Each entry is a CI step, not an aspiration — see .github/workflows/ci.yml. */
const VERIFICATION = [
  {
    gate: "Contract snapshot",
    detail: "tools/export_openapi.py --check diffs the served schema against the committed tools/openapi.json.",
    breaks: "A route or field changing shape without the snapshot being regenerated.",
  },
  {
    gate: "Cross-language parity",
    detail: "The TypeScript engine and risk maths are pinned to Python-generated fixtures.",
    breaks: "The two implementations disagreeing on a Sharpe, a VaR or a fold boundary.",
  },
  {
    gate: "Gateway contract fixtures",
    detail: "Canonical gateway payloads are replayed through the web-side validators.",
    breaks: "The consumer drifting from what the gateway actually emits.",
  },
  {
    gate: "Money-path probe",
    detail: "tools/synthetic_probe.py walks book → cost → risk gate → audit in-process.",
    breaks: "Any step of the order path failing, even when each unit test still passes.",
  },
  {
    gate: "Lint and types",
    detail: "ruff over the Python tree; tsc --noEmit in strict mode over the workspace.",
    breaks: "Unused state, shadowed names, an any that crept into a payload type.",
  },
] as const;

export interface DeveloperConsoleProps {
  view: SystemHealthView;
  workspaceSymbol: string;
  onOpenResearch: () => void;
  onOpenLive: () => void;
  onOpenReliability: () => void;
}

export default function DeveloperConsole({
  view,
  workspaceSymbol,
  onOpenResearch,
  onOpenLive,
  onOpenReliability,
}: DeveloperConsoleProps) {
  const { health } = view;

  const tiles: ConsoleTile[] = [
    {
      label: "Documented endpoints",
      value: String(API_SURFACES.length),
      note: "committed to tools/openapi.json",
      tone: "good",
    },
    latencyTile(view),
    {
      label: "Guard mode",
      value: view.guard,
      note: view.guard === "locked" ? "writes refused without a token" : `token env ${view.tokenEnv}`,
      tone: view.guard === "open-dev" ? "warn" : "good",
    },
    {
      label: "CI gates",
      value: String(VERIFICATION.length),
      note: "contract, parity, journey, lint and types",
      tone: "good",
    },
  ];

  return (
    <>
      <ConsoleChrome view={view} tiles={tiles} />

      <div className="card api-surface-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Developer surface</span>
            <h2>Desk-facing APIs</h2>
          </div>
          <span className="section-note">Same contracts that power this workspace.</span>
        </div>
        <div className="api-surface-list">
          {API_SURFACES.map((surface) => (
            <div className="api-surface-row" key={`${surface.method}-${surface.path}`}>
              <span className={`method-badge method-${surface.method.toLowerCase()}`}>{surface.method}</span>
              <code>{surface.path}</code>
              <span>{surface.purpose}</span>
            </div>
          ))}
        </div>
        <p className="api-note">
          Live browser books are market-data signals, not an execution authority. Order submission,
          portfolio risk and kill-switch actions stay behind the authenticated gateway.
        </p>
      </div>

      <div className="card verification-card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Continuous verification</span>
            <h2>What breaks the build</h2>
          </div>
          <span className="section-note">Every push, three test suites, no network.</span>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">Continuous integration gates and the regressions they catch</caption>
            <thead>
              <tr>
                <th>Gate</th>
                <th>What it does</th>
                <th>What it catches</th>
              </tr>
            </thead>
            <tbody>
              {VERIFICATION.map((row) => (
                <tr key={row.gate}>
                  <th scope="row">{row.gate}</th>
                  <td>{row.detail}</td>
                  <td className="muted">{row.breaks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="api-note">
          The suites are offline by construction, so a reviewer with no API keys and no gateway
          running still gets the same result CI does.
        </p>
      </div>

      <div className="console-layout">
        <div className="console-column console-column--wide">
          <div className="workflow-handoff data-handoff">
            <div>
              <span className="page-kicker">Shared desk instrument</span>
              <strong className="num">{workspaceSymbol}</strong>
              <small>Research, Execution and the pipeline inspector all read this context.</small>
            </div>
            <div>
              <button className="primary-action" onClick={onOpenResearch}>Research {workspaceSymbol}</button>
              <button onClick={onOpenLive}>Open live book</button>
            </div>
          </div>
        </div>

        <div className="console-column console-column--narrow">
          <div className="card cross-link-tile">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Owned by reliability</span>
                <h2>Live trace</h2>
              </div>
              <button className="text-action" onClick={onOpenReliability}>Open Reliability →</button>
            </div>
            <p className="sub">
              The structured event ring, breaker transitions and operator drills. When a contract test
              passes locally but the deployed surface misbehaves, the trace is where the difference
              shows up.
            </p>
            <div className="cross-link-metrics">
              <div>
                <span>Providers ready</span>
                <strong className="num">
                  {health ? `${health.summary.ready}/${health.summary.total}` : "—"}
                </strong>
                <small>{view.degraded ? `${view.degraded} degraded` : "all nominal"}</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
