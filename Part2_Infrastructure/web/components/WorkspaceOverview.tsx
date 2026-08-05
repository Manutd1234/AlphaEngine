"use client";

/**
 * The command center — a composer since the four-feature upgrade.
 *
 * The hero pipeline, KPI deck and role launcher live in components/overview/;
 * this file derives their inputs from live page state and keeps the exception
 * board. Provider readiness reads the polled health snapshot (the old one-shot
 * /api/providers summary froze at load and duplicated a subset of it).
 */

import DecisionLoopPipeline from "@/components/overview/DecisionLoopPipeline";
import KpiDeck from "@/components/overview/KpiDeck";
import RoleCards, { type RoleContext } from "@/components/overview/RoleCards";
import { STRATEGY_LABELS, SweepRequest, SweepResponse } from "@/lib/types";
import { fmt } from "@/lib/format";
import { deriveDecisionLoop } from "@/lib/overview-state";
import type { Side } from "@/lib/venues";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { BookView } from "@/lib/use-book";
import type { SystemHealthView } from "@/lib/use-system-health";

interface WorkspaceOverviewProps {
  request: SweepRequest;
  result: SweepResponse | null;
  running: boolean;
  researchStale: boolean;
  /** The previous run while the desk context is dirty — shown labelled. */
  staleResult: SweepResponse | null;
  side: Side;
  notional: number;
  book: BookView;
  systems: SystemHealthView;
  onNavigate: (view: WorkspaceView) => void;
  onRun: () => void;
}

export default function WorkspaceOverview({
  request,
  result,
  running,
  researchStale,
  staleResult,
  side,
  notional,
  book,
  systems,
  onNavigate,
  onRun,
}: WorkspaceOverviewProps) {
  const summary = systems.health?.summary;
  const capabilitiesDown = systems.health
    ? Object.values(systems.health.capabilities).filter((c) => c.available.length === 0).length
    : 0;

  const stages = deriveDecisionLoop({
    healthPresent: systems.health !== null,
    healthError: Boolean(systems.healthError),
    degradedCount: systems.degraded,
    capabilitiesDown,
    quarantineSize: systems.health?.quarantine?.size ?? 0,
    providersReady: summary?.ready ?? 0,
    providersTotal: summary?.total ?? 0,
    running,
    researchStale,
    verdictLevel: result?.verdict.level ?? null,
    bookPresent: book.book !== null,
    bookSandbox: Boolean(book.book?.sandbox),
    bookStale: book.isStale,
    riskUtilisation: book.book?.risk_budget.binding_constraint?.[1] ?? null,
    bindingConstraint: book.book?.risk_budget.binding_constraint?.[0] ?? null,
    varZone: book.varValidation?.zone ?? null,
    tradingHalted: Boolean(book.book?.trading_halted),
    haltedSymbolCount: book.book?.halted_symbols.length ?? 0,
    // Real gateway blotter only; the sandbox blotter is generated data.
    fillRate: null,
  });

  const shown = result ?? staleResult;
  const candidate = shown
    ? `${STRATEGY_LABELS[shown.request.strategy]} · ${shown.best.fast}/${shown.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  const validation = result
    ? result.walkForwardOosSharpe == null
      ? "Not available"
      : fmt(result.walkForwardOosSharpe, 2)
    : running
      ? "Running"
      : "Pending";
  const providers = summary ? `${summary.ready}/${summary.total}` : "Checking";
  const researchStatus = researchStale
    ? "Context changed · rerun required"
    : result
      ? `${result.verdict.level.toUpperCase()} · ${validation} OOS Sharpe`
      : running
        ? "Baseline running"
        : "Awaiting validation";
  const systemStatus = systems.degraded
    ? `${systems.degraded} degraded`
    : summary
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

  if (systems.degraded) {
    attentionItems.push({
      severity: "warning",
      owner: "Data",
      headline: `${systems.degraded} provider${systems.degraded === 1 ? " needs" : "s need"} attention`,
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
      headline: running
        ? "Baseline research is running"
        : researchStale
          ? "Desk context changed"
          : "Candidate needs validation",
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
        <DecisionLoopPipeline stages={stages} />
      </section>

      <KpiDeck
        request={request}
        result={result}
        running={running}
        researchStale={researchStale}
        staleResult={staleResult}
        side={side}
        notional={notional}
        book={book}
        systems={systems}
      />

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
        <RoleCards
          context={context}
          onNavigate={onNavigate}
          onRun={onRun}
          running={running}
          researchStale={researchStale}
          onRefreshBook={() => void book.refresh(true)}
          bookRefreshing={book.refreshing}
          onRefreshHealth={() => void systems.refresh(false)}
        />
      </section>
    </div>
  );
}

interface AttentionItem {
  severity: "critical" | "warning" | "info" | "ready";
  owner: string;
  headline: string;
  detail: string;
  view: WorkspaceView;
}
