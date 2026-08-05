"use client";

import { STRATEGY_LABELS, SweepRequest, SweepResponse } from "@/lib/types";
import { fmt, signedPct, usd } from "@/lib/format";
import type { Side } from "@/lib/venues";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { BookView } from "@/lib/use-book";
import type { SystemHealthView } from "@/lib/use-system-health";

interface WorkspaceOverviewProps {
  request: SweepRequest;
  result: SweepResponse | null;
  running: boolean;
  side: Side;
  notional: number;
  providerSummary: { configured: number; total: number; degraded: number } | null;
  book: BookView;
  systems: SystemHealthView;
  onNavigate: (view: WorkspaceView) => void;
}

export default function WorkspaceOverview({
  request,
  result,
  running,
  side,
  notional,
  providerSummary,
  book,
  systems,
  onNavigate,
}: WorkspaceOverviewProps) {
  const candidate = result
    ? `${STRATEGY_LABELS[result.request.strategy]} · ${result.best.fast}/${result.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  const validation = result
    ? result.walkForwardOosSharpe == null
      ? "Not available"
      : fmt(result.walkForwardOosSharpe, 2)
    : running
      ? "Running"
      : "Pending";
  const providers = providerSummary
    ? `${providerSummary.configured}/${providerSummary.total}`
    : "Checking";
  const researchStatus = result
    ? `${result.verdict.level.toUpperCase()} · ${validation} OOS Sharpe`
    : running
      ? "Baseline running"
      : "Awaiting validation";
  const systemStatus = providerSummary?.degraded
    ? `${providerSummary.degraded} degraded`
    : providerSummary
      ? `${providers} ready`
      : "Checking routes";

  const context: RoleContext = {
    symbol: request.symbol,
    candidate,
    researchStatus,
    side,
    notional,
    slippageBps: request.slippageBps,
    providers,
    systemStatus,
  };

  const attentionItems: AttentionItem[] = [];

  if (book.book?.trading_halted) {
    attentionItems.push({
      severity: "critical",
      owner: "Risk",
      headline: "Trading is halted",
      detail: book.book.halted_symbols.length
        ? `${book.book.halted_symbols.join(", ")} blocked by the current risk state`
        : "The global kill switch is active",
      view: "risk",
    });
  } else if (book.isStale) {
    attentionItems.push({
      severity: "warning",
      owner: "Portfolio",
      headline: "Book snapshot is stale",
      detail: "Execution handoffs remain disabled until the gateway reconnects",
      view: "portfolio",
    });
  } else if (book.sandbox) {
    attentionItems.push({
      severity: "info",
      owner: "Portfolio",
      headline: "Sandbox book is active",
      detail: "The workflow is real; positions and P&L are generated and clearly labelled",
      view: "portfolio",
    });
  }

  if (providerSummary?.degraded || systems.degraded) {
    const count = Math.max(providerSummary?.degraded ?? 0, systems.degraded);
    attentionItems.push({
      severity: "warning",
      owner: "Data",
      headline: `${count} provider${count === 1 ? " needs" : "s need"} attention`,
      detail: "Inspect failover, quota and quarantined payloads before trusting a fresh number",
      view: "data",
    });
  } else if (systems.healthError) {
    attentionItems.push({
      severity: "critical",
      owner: "Reliability",
      headline: "System health is unreachable",
      detail: "The last known desk state cannot be confirmed",
      view: "reliability",
    });
  }

  if (!result) {
    attentionItems.push({
      severity: running ? "info" : "warning",
      owner: "Research",
      headline: running ? "Baseline research is running" : "Candidate needs validation",
      detail: `${request.symbol} has no current out-of-sample verdict yet`,
      view: "research",
    });
  } else if (result.verdict.level !== "pass") {
    attentionItems.push({
      severity: result.verdict.level === "fail" ? "critical" : "warning",
      owner: "Research",
      headline: result.verdict.headline,
      detail: `${result.walkForwardOosSharpe == null ? "No" : fmt(result.walkForwardOosSharpe, 2)} OOS Sharpe · execution promotion remains gated`,
      view: "research",
    });
  }

  if (!attentionItems.length) {
    attentionItems.push({
      severity: "ready",
      owner: "All desks",
      headline: "No urgent exceptions",
      detail: "Research, book state and provider health are currently aligned",
      view: "research",
    });
  }

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div>
          <span className="page-kicker">AlphaEngine command center</span>
          <h1>From market signal to governed decision.</h1>
          <p>{request.symbol} research evidence, portfolio risk, execution intent and data health share one context — and reconcile to the same audit trail.</p>
        </div>
        <div className="overview-hero__signal" aria-label="AlphaEngine decision loop">
          <span>Decision loop</span>
          <strong>Research <i>→</i> Risk <i>→</i> Execution</strong>
          <small>Paper-only · observable · reproducible</small>
        </div>
      </section>

      <section className="decision-metrics" aria-label="Current decision context">
        <div>
          <span>Research candidate</span>
          <strong>{candidate}</strong>
          <small>{result ? `${result.verdict.level.toUpperCase()} validation verdict` : "First sweep in progress"}</small>
        </div>
        <div>
          <span>Out-of-sample Sharpe</span>
          <strong className="num">{validation}</strong>
          <small>{result ? `${signedPct(result.best.totalReturn)} in-sample return` : "Awaiting result"}</small>
        </div>
        <div>
          <span>Order intent</span>
          <strong className="num">{side} {usd(notional, 0)}</strong>
          <small>{request.slippageBps} bps modeled slippage</small>
        </div>
        <div>
          <span>Data plane</span>
          <strong className="num">{providers}</strong>
          <small>{systemStatus}</small>
        </div>
      </section>

      <section className="attention-board" aria-labelledby="attention-title">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Exception-led workflow</span>
            <h2 id="attention-title">What needs attention now</h2>
          </div>
          <span className="section-note">Severity · owner · evidence · next action</span>
        </div>
        <div className="attention-list">
          {attentionItems.map((item) => (
            <button
              type="button"
              className={`attention-item is-${item.severity}`}
              key={`${item.owner}-${item.headline}`}
              onClick={() => onNavigate(item.view)}
            >
              <span className="attention-item__status">
                <i aria-hidden /> {item.severity}
              </span>
              <span className="attention-item__copy">
                <small>{item.owner}</small>
                <strong>{item.headline}</strong>
                <span>{item.detail}</span>
              </span>
              <span className="attention-item__action">Open {item.owner} <span aria-hidden>→</span></span>
            </button>
          ))}
        </div>
      </section>

      <section className="overview-section">
        <div className="section-heading">
          <div>
            <span className="page-kicker">Workspaces</span>
            <h2>One tab per desk role</h2>
          </div>
          <span className="section-note">
            Each role owns its surface; every action still lands in the same audit log.
          </span>
        </div>

        {/* Ordered the way work moves — an idea is researched, executed, held,
            and constrained — then the three roles that keep that possible. */}
        <div className="role-grid">
          {ROLE_CARDS.map((card) => (
            <button
              type="button"
              key={card.view}
              className="pipeline-card pipeline-card--action role-card"
              onClick={() => onNavigate(card.view)}
            >
              <span className="role-card__header">
                <span className="role-monogram" aria-hidden>{card.code}</span>
                <span className="pipeline-card__step">{card.role}</span>
              </span>
              <strong className="pipeline-card__value">{card.headline(context)}</strong>
              <small className="pipeline-card__status">{card.status(context)}</small>
              <span className="pipeline-card__link">{card.action} <span aria-hidden>→</span></span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

interface RoleContext {
  symbol: string;
  candidate: string;
  researchStatus: string;
  side: Side;
  notional: number;
  slippageBps: number;
  providers: string;
  systemStatus: string;
}

interface AttentionItem {
  severity: "critical" | "warning" | "info" | "ready";
  owner: string;
  headline: string;
  detail: string;
  view: WorkspaceView;
}

/**
 * The seven roles the platform is built for. Each card states what that role
 * would open the tab to find out, filled in from live context where there is
 * any — a launcher that only listed names would be a table of contents.
 */
const ROLE_CARDS: {
  view: WorkspaceView;
  code: string;
  role: string;
  action: string;
  headline: (context: RoleContext) => string;
  status: (context: RoleContext) => string;
}[] = [
  {
    view: "research",
    code: "QR",
    role: "Quant researcher",
    action: "Inspect evidence",
    headline: (c) => c.candidate,
    status: (c) => c.researchStatus,
  },
  {
    view: "live",
    code: "EX",
    role: "Quant trader",
    action: "Work the order",
    headline: (c) => `${c.side} ${c.symbol} · ${usd(c.notional, 0)}`,
    status: (c) => `${c.slippageBps} bps modeled cost budget`,
  },
  {
    view: "portfolio",
    code: "PM",
    role: "Portfolio manager",
    action: "Open the book",
    headline: () => "Positions & allocation",
    status: () => "Exposure, concentration and sleeve attribution",
  },
  {
    view: "risk",
    code: "RM",
    role: "Risk manager",
    action: "Check headroom",
    headline: () => "Limits & tail risk",
    status: () => "VaR scored against its own record, scenarios, kill switch",
  },
  {
    view: "data",
    code: "DE",
    role: "Data engineer",
    action: "Verify lineage",
    headline: (c) => c.providers,
    status: () => "Routing, source agreement, quarantine and quota",
  },
  {
    view: "reliability",
    code: "SRE",
    role: "DevOps / SRE",
    action: "Check health",
    headline: (c) => c.systemStatus,
    status: () => "Breakers, latency percentiles, trace and outage drills",
  },
  {
    view: "developer",
    code: "API",
    role: "Quant developer",
    action: "Read the contract",
    headline: () => "API & verification",
    status: () => "Committed schema, parity fixtures and the CI gates",
  },
];
