"use client";

/**
 * The command center — a composer since the four-feature upgrade.
 *
 * The hero pipeline, KPI deck and role launcher live in components/overview/;
 * this file derives their inputs from live page state. Provider readiness reads
 * the polled health snapshot (the old one-shot /api/providers summary froze at
 * load and duplicated a subset of it).
 *
 * The exception board that used to sit between the deck and the launcher is
 * gone: its four rows restated the four stages the hero pipeline already
 * derives from the same call, one screen higher.
 */

import AuditTrail from "@/components/overview/AuditTrail";
import DecisionLoopPipeline from "@/components/overview/DecisionLoopPipeline";
import KpiDeck from "@/components/overview/KpiDeck";
import RoleCards, { type RoleContext } from "@/components/overview/RoleCards";
import Sparkline from "@/components/overview/Sparkline";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { STRATEGY_LABELS, SweepRequest, SweepResponse } from "@/lib/types";
import { fmt, signedPct, usd } from "@/lib/format";
import { deriveDecisionLoop, downsample } from "@/lib/overview-state";
import { OVERVIEW_SECTIONS, type OverviewSection } from "@/lib/sections";
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
  section: OverviewSection;
  onSectionChange: (section: OverviewSection) => void;
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
  section,
  onSectionChange,
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
    // Null while the first probe is still in flight: useBook reports "error"
    // for the no-book-no-error initial state, and a verdict must not be
    // rendered before anything was actually measured.
    bookConnection: book.book || book.error ? book.connectionState : null,
    bookErrorCode: book.error?.code ?? null,
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

  /**
   * The one primary action on the overview.
   *
   * The launcher used to carry seven, one per desk, all identical — which told
   * a reader nothing about which desk to open. The loop already knows: the
   * first stage that is not `ok` is the thing holding the desk up, so that
   * stage names the action. When everything is clear the loop continues at
   * research, which is where the next decision starts.
   */
  const blocking = stages.find((stage) => stage.state !== "ok" && stage.state !== "idle");
  const primaryAction: { label: string; run: () => void } = (() => {
    switch (blocking?.id) {
      case "data":
        return { label: "Inspect data health", run: () => onNavigate("data") };
      case "research":
        return researchStale || !result
          ? { label: running ? "Research running…" : "Run research", run: onRun }
          : { label: "Review the verdict", run: () => onNavigate("research") };
      case "risk":
        return { label: "Open risk limits", run: () => onNavigate("risk") };
      case "execution":
        return { label: "Open execution", run: () => onNavigate("live") };
      default:
        return { label: "Open research", run: () => onNavigate("research") };
    }
  })();

  /**
   * The hero band. Four figures the desk asks for before anything else, all
   * from state this component already receives — the strip adds no request.
   * Each carries its own provenance and its own honest empty state, because a
   * dash with no explanation reads as breakage rather than as absence.
   */
  const equity = book.book?.equity ?? null;
  const equitySpark = downsample(book.equityTrack.map((p) => p.equity), 64);
  const dayTone = equity ? (equity.daily_pnl >= 0 ? "up" : "down") : null;
  const risk = book.risk;
  const latency = summary?.latency ?? null;
  const latencyMeasured = latency?.p99 != null && (latency.n ?? 0) >= 20;

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

  return (
    <div className="overview-page">
      <section className="overview-hero">
        <div className="overview-hero__copy">
          <span className="page-kicker">AlphaEngine command center</span>
          <h1>From market signal to governed decision.</h1>
          <p>{request.symbol} research evidence, portfolio risk, execution intent and data health share one context — and reconcile to the same audit trail.</p>
          <button
            type="button"
            className="overview-hero__cta"
            onClick={primaryAction.run}
            disabled={running && primaryAction.label.endsWith("…")}
          >
            {primaryAction.label}
            <span aria-hidden>→</span>
          </button>
        </div>
        <DecisionLoopPipeline stages={stages} />

        <div className="overview-hero__stats">
          <div className="overview-hero__stat">
            <span>Equity</span>
            <strong className="num">{equity ? usd(equity.current, 0) : "—"}</strong>
            <div className="overview-hero__stat-line">
              <small>
                {equity ? `start ${usd(equity.start_of_day, 0)} · gateway snapshot` : "book connecting"}
              </small>
              {equitySpark.length >= 2 ? (
                <Sparkline
                  variant="area"
                  points={equitySpark}
                  width={90}
                  height={26}
                  ariaLabel={`Equity through the session, ending at ${usd(equitySpark[equitySpark.length - 1], 0)}`}
                />
              ) : null}
            </div>
          </div>

          <div className="overview-hero__stat">
            <span>Day P&amp;L</span>
            <strong className="num">
              {equity ? `${equity.daily_pnl >= 0 ? "+" : "−"}${usd(Math.abs(equity.daily_pnl), 0)}` : "—"}
            </strong>
            <small>
              {equity ? `${signedPct(equity.daily_return)} · ${dayTone} on the session` : "book connecting"}
            </small>
          </div>

          <div className="overview-hero__stat">
            <span>VaR 95 · 1 day</span>
            <strong className="num">{risk ? usd(risk.var95, 0) : "—"}</strong>
            <small>
              {risk
                ? `CVaR ${usd(risk.cvar95, 0)}${book.varValidation ? ` · zone ${book.varValidation.zone}` : ""} · backtested in this browser`
                : "needs price history"}
            </small>
          </div>

          <div className="overview-hero__stat">
            <span>Data plane p99</span>
            <strong className="num">
              {latencyMeasured ? `${Math.round(latency!.p99!)}ms` : "—"}
            </strong>
            <small>
              {latencyMeasured
                ? `${summary?.ready ?? 0}/${summary?.total ?? 0} routes ready${systems.degraded ? ` · ${systems.degraded} degraded` : ""} · measured from this browser's polls`
                : "fewer than 20 polls measured"}
            </small>
          </div>
        </div>
      </section>

      {/* The hero (and its pipeline) stays above the rail the way BookChrome
          does on Portfolio/Risk — it is the workspace's identity, not a
          section. The three sections below it are real locations. */}
      <WorkspaceSubtabs
        workspaceId="overview"
        label="Overview sections"
        tabs={OVERVIEW_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
      />

      <WorkspaceSubtabPanel workspaceId="overview" tabId="loop" activeId={section}>
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
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="overview" tabId="desks" activeId={section}>
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
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="overview" tabId="audit" activeId={section}>
        <AuditTrail active={section === "audit"} />
      </WorkspaceSubtabPanel>
    </div>
  );
}

