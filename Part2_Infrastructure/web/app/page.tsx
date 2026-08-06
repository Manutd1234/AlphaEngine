"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Controls from "@/components/Controls";
import DataConsole, { DATA_SECTION_IDS, type DataSection } from "@/components/DataConsole";
import DeveloperConsole, { type DeveloperSection } from "@/components/DeveloperConsole";
import EquityChart from "@/components/EquityChart";
import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket, { type ExecutionSection } from "@/components/LiveMarket";
import PortfolioWorkspace, { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import PriceChart from "@/components/PriceChart";
import ReliabilityConsole, { RELIABILITY_SECTION_IDS, type ReliabilitySection } from "@/components/ReliabilityConsole";
import RiskWorkspace from "@/components/RiskWorkspace";
import ExperimentHistory from "@/components/research/ExperimentHistory";
import FactorPanel from "@/components/research/FactorPanel";
import PromotionPanel from "@/components/research/PromotionPanel";
import RegimePanel from "@/components/research/RegimePanel";
import SizingPanel from "@/components/research/SizingPanel";
import StabilityPanel from "@/components/research/StabilityPanel";
import StaleGate from "@/components/research/StaleGate";
import TearSheet from "@/components/research/TearSheet";
import WalkForwardTimeline from "@/components/research/WalkForwardTimeline";
import StatTile from "@/components/StatTile";
import { ResultsTable, WalkForwardTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import WorkspaceHeader, { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceIntro from "@/components/WorkspaceIntro";
import WorkspaceOverview from "@/components/WorkspaceOverview";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { createInitialDataWorkItems, type DataWorkItem } from "@/lib/data-work-queue";
import { createInitialDeveloperWorkItems, type DeveloperWorkItem } from "@/lib/developer-work";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import { REFERENCE_EQUITY } from "@/lib/portfolio";
import { useBook } from "@/lib/use-book";
import { useSystemHealth } from "@/lib/use-system-health";
import {
  DEFAULT_REQUEST,
  ParamResult,
  STRATEGY_LABELS,
  SweepRequest,
  SweepResponse,
} from "@/lib/types";
import {
  addExperiment,
  annotateExperiment,
  clearExperiments,
  loadExperiments,
  removeExperiment,
  saveExperiments,
  type ExperimentRecord,
} from "@/lib/experiments";
import { APP_COMMIT } from "@/lib/version";
import type { Side } from "@/lib/venues";

const VIEWS: WorkspaceView[] = NAV_ITEMS.map((item) => item.id);

type ResearchSection = "summary" | "parameters" | "walkforward" | "attribution" | "decision" | "runs";

const RESEARCH_SECTIONS = [
  { id: "summary", label: "Summary", description: "Verdict & performance" },
  { id: "parameters", label: "Parameters", description: "Stability & ranking" },
  { id: "walkforward", label: "Walk-forward", description: "Out-of-sample evidence" },
  { id: "attribution", label: "Attribution", description: "Factors & tail behavior" },
  { id: "decision", label: "Decision", description: "Promotion & sizing" },
  { id: "runs", label: "Runs", description: "Experiment history" },
] as const;

const EXECUTION_SECTIONS = [
  { id: "trade", label: "Trade", description: "Ticket & pre-trade gates" },
  { id: "liquidity", label: "Liquidity", description: "Depth & consolidated book" },
  { id: "routing", label: "Routing & TCA", description: "Cost & venue allocation" },
  { id: "activity", label: "Activity", description: "Quality, fills & alerts" },
] as const;

/**
 * The console used to be one "Systems" tab. Anyone holding a link to it lands on
 * reliability, which is the half that answers "is it up" — the question someone
 * following a saved systems link is most likely asking.
 */
const LEGACY_VIEWS: Record<string, WorkspaceView> = {
  systems: "reliability",
};

export default function Page() {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  const [data, setData] = useState<SweepResponse | null>(null);
  const [inspectionData, setInspectionData] = useState<SweepResponse | null>(null);
  const [inspect, setInspect] = useState<ParamResult | null>(null);
  const [running, setRunning] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [side, setSide] = useState<Side>("BUY");
  const [notional, setNotional] = useState(100_000);
  // The order draft beyond side/notional, lifted like they are so the ladder
  // (liquidity subtab) can stage a limit the ticket (trade subtab) picks up —
  // panels stay mounted, so the draft survives the jump.
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [limitPrice, setLimitPrice] = useState<number | null>(null);
  const [researchSection, setResearchSection] = useState<ResearchSection>("summary");
  const [showMcBands, setShowMcBands] = useState(true);
  const [executionSection, setExecutionSection] = useState<ExecutionSection>("trade");
  const [dataSection, setDataSection] = useState<DataSection>("overview");
  const [reliabilitySection, setReliabilitySection] = useState<ReliabilitySection>("overview");
  const [developerSection, setDeveloperSection] = useState<DeveloperSection>("overview");
  const [dataWorkItems, setDataWorkItems] = useState<DataWorkItem[]>(createInitialDataWorkItems);
  const [developerWorkItems, setDeveloperWorkItems] = useState<DeveloperWorkItem[]>(createInitialDeveloperWorkItems);
  const [experiments, setExperiments] = useState<ExperimentRecord[]>([]);
  const activeRun = useRef<AbortController | null>(null);
  const runSeq = useRef(0);

  // One book and one health snapshot, shared by the tabs that read them. Both
  // hooks own their polling, so a tab is a rendering decision rather than a
  // second source of truth.
  const book = useBook();
  const systems = useSystemHealth(req.symbol);
  const navigate = useCallback((next: WorkspaceView, replace = false) => {
    setView(next);
    if (next === "data") setDataSection("overview");
    if (next === "reliability") setReliabilitySection("overview");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = next;
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    }
  }, []);

  useEffect(() => {
    const readLocation = () => {
      const [workspace, nestedSection] = window.location.hash.slice(1).split("/");
      const hashView = workspace as WorkspaceView;
      if (VIEWS.includes(hashView)) {
        setView(hashView);
        if (hashView === "data") {
          const requested = nestedSection as DataSection;
          setDataSection(DATA_SECTION_IDS.includes(requested) ? requested : "overview");
        }
        if (hashView === "reliability") {
          const requested = nestedSection as ReliabilitySection;
          setReliabilitySection(RELIABILITY_SECTION_IDS.includes(requested) ? requested : "overview");
        }
      } else if (LEGACY_VIEWS[workspace]) {
        setView(LEGACY_VIEWS[workspace]);
      }
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    window.addEventListener("hashchange", readLocation);
    return () => {
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("hashchange", readLocation);
    };
  }, []);

  const changeDataSection = useCallback((next: DataSection) => {
    setDataSection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `data/${next}`;
      window.history.pushState({}, "", url);
    }
  }, []);

  const changeReliabilitySection = useCallback((next: ReliabilitySection) => {
    setReliabilitySection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `reliability/${next}`;
      window.history.pushState({}, "", url);
    }
  }, []);

  const openReliabilitySection = useCallback((next: ReliabilitySection, targetId?: string) => {
    setView("reliability");
    setReliabilitySection(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = `reliability/${next}`;
      window.history.pushState({}, "", url);
      if (targetId) {
        window.requestAnimationFrame(() => document.getElementById(targetId)?.focus());
      }
    }
  }, []);

  const run = useCallback(
    async (override?: Partial<SweepRequest>, preserveInspect = false) => {
      activeRun.current?.abort();
      const controller = new AbortController();
      activeRun.current = controller;
      const sequence = ++runSeq.current;

      setRunning(true);
      setError(null);
      if (!preserveInspect) {
        setInspect(null);
        setInspectionData(null);
      }

      try {
        const body = { ...req, ...override };
        const response = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
        if (sequence !== runSeq.current) return;
        if (preserveInspect) setInspectionData(json as SweepResponse);
        else setData(json as SweepResponse);
        setResearchDirty(false);
        // Drill-downs are not hypotheses. `inspectCombo` re-runs the sweep
        // pinned to one cell to isolate it; recording that would inflate the
        // attempt count, which is the single number the history panel exists to
        // keep honest.
        if (!preserveInspect) {
          setExperiments((current) => addExperiment(current, json as SweepResponse, Date.now()));
        }
      } catch (runError) {
        if ((runError as Error).name !== "AbortError" && sequence === runSeq.current) {
          setError((runError as Error).message);
        }
      } finally {
        if (sequence === runSeq.current) setRunning(false);
      }
    },
    [req],
  );

  useEffect(() => {
    void run();
    return () => activeRun.current?.abort();
    // One baseline run only. Subsequent request edits are explicit so a slider
    // cannot fan out network work while it is being dragged.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hydrated in an effect rather than in the initial state. `page.tsx` is a
  // client component but is still server-rendered, so reading localStorage
  // during render throws on the server and desynchronises the first paint.
  useEffect(() => {
    setExperiments(loadExperiments());
  }, []);

  const cloneExperiment = useCallback((request: SweepRequest) => {
    setReq(request);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const dropExperiment = useCallback((id: string) => {
    setExperiments((current) => removeExperiment(current, id));
  }, []);

  const updateRequest = useCallback((next: SweepRequest) => {
    setReq(next);
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const updateSymbol = useCallback((symbol: string) => {
    setReq((current) => ({ ...current, symbol }));
    setResearchDirty(true);
    setInspect(null);
    setInspectionData(null);
  }, []);

  const focusPortfolioSymbol = useCallback((symbol: string, destination: PortfolioFocusDestination) => {
    updateSymbol(symbol);
    navigate(destination);
  }, [navigate, updateSymbol]);

  // Ladder click-to-trade: lifting an ask is a BUY, hitting a bid is a SELL.
  // The panels stay mounted, so the staged draft is live in the ticket the
  // moment the trade subtab unhides — no focus juggling needed.
  const stageLimitFromLadder = useCallback(({ side: picked, price }: { side: Side; price: number }) => {
    setSide(picked);
    setOrderType("LIMIT");
    setLimitPrice(price);
    setExecutionSection("trade");
  }, []);

  const inspectCombo = useCallback(
    (result: ParamResult) => {
      setInspect(result);
      void run(
        {
          fastMin: result.fast,
          fastMax: result.fast + 1,
          fastStep: 1,
          slowMin: result.slow,
          slowMax: result.slow + 1,
          slowStep: 1,
          walkForward: false,
        },
        true,
      );
    },
    [run],
  );

  const activeResult = researchDirty ? null : data;
  const displayedResult = inspectionData ?? data;
  // Drives the region-level gates: stale evidence stays visible under a veil,
  // never silently presented as current.
  const researchStale = researchDirty && Boolean(data);
  const shown = displayedResult?.best;
  const tiles = useMemo(() => {
    if (!displayedResult || !shown) return null;
    // A cost assumption must never be invisible: when anything beyond flat
    // bps was modelled, the tile says which frictions were charged.
    const costs = displayedResult.costs;
    const frictionNote = costs && !costs.flatOnly
      ? [
          costs.impactBps > 0 ? `+${fmt(costs.impactBps, 1)} bps impact` : null,
          costs.fundingBpsPer8h !== 0 ? `funding ${fmt(costs.fundingBpsPer8h, 1)} bps/8h` : null,
          costs.borrowBpsAnnual > 0 ? `borrow ${fmt(costs.borrowBpsAnnual, 0)} bps/yr` : null,
        ].filter(Boolean).join(" · ")
      : null;
    return (
      <div className="tiles research-tiles">
        <StatTile
          label="Annualised Sharpe"
          value={fmt(shown.sharpe, 2)}
          note={`buy & hold ${fmt(displayedResult.benchmark.sharpe, 2)}`}
          tone={shown.sharpe > displayedResult.benchmark.sharpe ? "pos" : "muted"}
        />
        <StatTile
          label="Total return"
          value={signedPct(shown.totalReturn)}
          note={`buy & hold ${signedPct(displayedResult.benchmark.totalReturn)}`}
          tone={shown.totalReturn >= 0 ? "pos" : "neg"}
        />
        <StatTile label="Max drawdown" value={pct(shown.maxDrawdown)} note={`calmar ${fmt(shown.calmar, 2)}`} tone="neg" />
        <StatTile label="Trades" value={String(shown.trades)} note={`win rate ${pct(shown.winRate, 0)}`} />
        <StatTile label="Time in market" value={pct(shown.exposure, 0)} note={`turnover ${fmt(shown.turnover, 1)}×`} />
        <StatTile
          label="Costs paid"
          value={usd(shown.feesPaid)}
          note={frictionNote ? `on a $100k book · ${frictionNote}` : "on a $100k book"}
        />
      </div>
    );
  }, [displayedResult, shown]);

  return (
    <>
      <a className="skip-link" href="#workspace-content">Skip to workspace content</a>
      <WorkspaceHeader
        view={view}
        onViewChange={navigate}
        onOpenProviderHealth={() => openReliabilitySection("services", "reliability-provider-health")}
        onOpenTailLatency={() => openReliabilitySection("services", "reliability-latency-guide")}
        latency={systems.health?.summary.latency ?? null}
        degraded={systems.degraded}
        providersReady={systems.health?.summary.ready ?? null}
        providersTotal={systems.health?.summary.total ?? null}
        healthUnreachable={Boolean(systems.healthError)}
        halt={book.book
          ? {
              halted: book.book.trading_halted,
              haltedSymbols: book.book.halted_symbols,
              sandbox: Boolean(book.book.sandbox),
            }
          : null}
        riskControl={{
          guardMode: systems.guard,
          token: systems.token,
          onTokenChange: systems.setToken,
          onExecuted: () => {
            void book.refresh(true);
            void systems.refresh(true);
          },
        }}
      />

      <main id="workspace-content" className="workspace-shell" tabIndex={-1}>
        {view === "overview" && (
          <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="view-panel">
            <WorkspaceOverview
              request={req}
              result={activeResult}
              running={running}
              researchStale={researchStale}
              staleResult={researchDirty ? data : null}
              side={side}
              notional={notional}
              book={book}
              systems={systems}
              onNavigate={navigate}
              onRun={() => void run()}
            />
          </section>
        )}

        {view === "portfolio" && (
          <section id="panel-portfolio" role="tabpanel" aria-labelledby="tab-portfolio" className="view-panel">
            <WorkspaceIntro
              kicker="Portfolio manager"
              title="Portfolio"
              description={<>What the book holds, how capital is spread, and which sleeve earned the P&amp;L — from one reconciled snapshot.</>}
              insights={[
                {
                  label: "Book source",
                  value: book.sandbox ? "Sandbox" : book.connectionState,
                  detail: book.isStale ? "last good snapshot" : "shared with Risk",
                  tone: book.isStale || book.sandbox ? "warn" : "good",
                },
                {
                  label: "Positions",
                  value: String(book.book?.exposure.positions.length ?? 0),
                  detail: book.book ? "current book" : "connecting",
                  tone: "accent",
                  mono: true,
                },
                {
                  label: "Risk model",
                  value: book.riskLoading ? "Measuring" : book.risk ? "Measured" : "Pending",
                  detail: book.risk ? `${book.risk.observations} aligned bars` : "no assumptions substituted",
                  tone: book.risk ? "good" : "warn",
                },
              ]}
            />
            <PortfolioWorkspace
              view={book}
              workspaceSymbol={req.symbol}
              onFocusSymbol={focusPortfolioSymbol}
              onOpenRisk={() => navigate("risk")}
              operatorToken={systems.token}
            />
          </section>
        )}

        {view === "risk" && (
          <section id="panel-risk" role="tabpanel" aria-labelledby="tab-risk" className="view-panel">
            <WorkspaceIntro
              kicker="Risk manager"
              title="Risk"
              description={<>Limits, validated loss estimates, forward-looking scenarios and emergency controls — separated by decision.</>}
              insights={[
                {
                  label: "Trading state",
                  value: book.book?.trading_halted ? "Halted" : book.book ? "Active" : "Connecting",
                  detail: book.sandbox ? "sandbox book" : "gateway decision",
                  tone: book.book?.trading_halted ? "critical" : book.book ? "good" : "warn",
                },
                {
                  label: "Binding constraint",
                  value: book.book
                    ? book.book.risk_budget.binding_constraint[0].replaceAll("_", " ")
                    : "Pending",
                  detail: book.book
                    ? `${fmt(book.book.risk_budget.binding_constraint[1] * 100, 1)}% utilised`
                    : "waiting for the book",
                  tone: (book.book?.risk_budget.binding_constraint[1] ?? 0) >= 0.9 ? "critical" : "warn",
                },
                {
                  label: "Tail risk",
                  value: book.risk
                    ? usd(book.risk.historicalVar95 ?? book.risk.var95, 0)
                    : book.riskLoading ? "Measuring" : "Pending",
                  detail: book.varValidation
                    ? `${book.varValidation.zone} validation · ${book.varValidation.observations} obs`
                    : "historical VaR 95 · 1 day",
                  tone: book.varValidation?.zone === "red" ? "critical" : book.varValidation?.zone === "yellow" ? "warn" : "accent",
                },
              ]}
            />
            <RiskWorkspace
              view={book}
              onOpenPortfolio={() => navigate("portfolio")}
              onOpenResearch={() => navigate("research")}
              operatorToken={systems.token}
            />
          </section>
        )}

        {view === "research" && (
          <section id="panel-research" role="tabpanel" aria-labelledby="tab-research" className="view-panel">
            <WorkspaceIntro
              kicker="Quant researcher"
              title="Research lab"
              description={<>Build, validate and promote {req.symbol} experiments through focused evidence sections.</>}
              insights={[
                { label: "Instrument", value: req.symbol, detail: req.interval, tone: "accent", mono: true },
                {
                  label: "Candidate",
                  value: running ? "Running" : activeResult ? activeResult.verdict.level : researchDirty ? "Stale" : "Pending",
                  detail: activeResult ? `${activeResult.combosTested} combinations tested` : "explicit rerun required",
                  tone: activeResult?.verdict.level === "pass" ? "good" : activeResult?.verdict.level === "fail" ? "critical" : "warn",
                },
                {
                  label: "Experiment trail",
                  value: String(experiments.length),
                  detail: "locally recorded attempts",
                  tone: "accent",
                  mono: true,
                },
              ]}
            />

            {error && (
              <div className="banner error" role="alert">
                <span aria-hidden>✕</span>
                <div><strong>Sweep failed.</strong> {error}</div>
              </div>
            )}
            {data?.warnings.map((warning) => (
              <div className="banner warn" key={warning} role="status">
                <span aria-hidden>!</span>
                <div>
                  {warning}
                  <button className="text-action" onClick={() => navigate("data")}>Inspect data health →</button>
                </div>
              </div>
            ))}
            {researchDirty && data && (
              <div className="banner context-change" role="status">
                <span aria-hidden>↻</span>
                <div>
                  <strong>Desk context changed.</strong> The result below belongs to {data.request.symbol} · {data.request.interval}.
                  Run the sweep to refresh it for {req.symbol} · {req.interval}.
                </div>
                <button onClick={() => run()} disabled={running}>{running ? "Running…" : "Refresh research"}</button>
              </div>
            )}

            <WorkspaceSubtabs
              workspaceId="research"
              label="Quant researcher sections"
              tabs={RESEARCH_SECTIONS}
              activeId={researchSection}
              onChange={setResearchSection}
            />

            {inspect && (
              <div className="banner warn research-inspection-banner" role="status">
                <span aria-hidden>◎</span>
                <div>
                  Inspecting <strong className="num">{inspect.fast}/{inspect.slow}</strong> without replacing the full parameter sweep.
                  <button className="text-action" onClick={() => run()}>Back to full sweep →</button>
                </div>
              </div>
            )}

            <div className="research-layout research-layout--sectioned">
              <Controls req={req} setReq={updateRequest} onRun={() => run()} running={running} />

              <div className="research-content">
                {!data && RESEARCH_SECTIONS.map((section) => (
                  <WorkspaceSubtabPanel
                    key={section.id}
                    workspaceId="research"
                    tabId={section.id}
                    activeId={researchSection}
                  >
                    {running ? (
                      <>
                        <div className="skeleton" style={{ height: 150, marginBottom: 16 }} />
                        <div className="skeleton" style={{ height: 330 }} />
                      </>
                    ) : (
                      <div className="card capability-empty research-empty-section">
                        <span className="role-monogram" aria-hidden>R</span>
                        <div>
                          <span className="page-kicker">No completed run</span>
                          <h2>Run the experiment setup to populate {section.label.toLowerCase()}.</h2>
                          <p>The current controls stay available at left, so you can revise the hypothesis before starting.</p>
                          <button className="primary-action" onClick={() => run()}>Run research</button>
                        </div>
                      </div>
                    )}
                  </WorkspaceSubtabPanel>
                ))}

                {data && displayedResult && (
                  <>
                    <WorkspaceSubtabPanel workspaceId="research" tabId="summary" activeId={researchSection}>
                      {/* The capsule stays outside the stale gate: reading the
                          provenance of the old result is exactly what someone
                          facing the veil needs to do. */}
                      <div className="research-provenance" aria-label="Research reproducibility capsule">
                        <div className="research-provenance__lead">
                          <span className="page-kicker">Reproducibility capsule</span>
                          <strong>Evidence carries its own data identity.</strong>
                          <small>Compare the fingerprint before attributing a changed result to the model.</small>
                        </div>
                        <dl>
                          <div>
                            <dt>Instrument</dt>
                            <dd className="num">{displayedResult.request.symbol} · {displayedResult.request.interval}</dd>
                          </div>
                          <div>
                            <dt>Dataset</dt>
                            <dd><code title={displayedResult.dataHash}>{displayedResult.dataHash?.slice(0, 12) ?? "legacy run"}</code></dd>
                          </div>
                          <div>
                            <dt>Source</dt>
                            <dd>{displayedResult.dataSource}</dd>
                          </div>
                          <div>
                            <dt>Window</dt>
                            <dd className="num">{displayedResult.bars} bars</dd>
                          </div>
                          <div>
                            <dt>Search</dt>
                            <dd className="num">{displayedResult.combosTested} combos</dd>
                          </div>
                          <div>
                            <dt>Runtime</dt>
                            <dd className="num">{fmt(displayedResult.durationMs, 0)}ms</dd>
                          </div>
                          <div>
                            <dt>Build</dt>
                            <dd><code>{displayedResult.commit ?? APP_COMMIT}</code></dd>
                          </div>
                          {displayedResult.dataSource === "synthetic" && displayedResult.syntheticSeed != null && (
                            <div>
                              <dt>Seed</dt>
                              <dd className="num">{displayedResult.syntheticSeed}</dd>
                            </div>
                          )}
                        </dl>
                      </div>

                      <StaleGate
                        active={researchStale}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <Verdict data={displayedResult} />

                        {tiles}

                        <div className="card">
                          <div className="chart-heading">
                            <h2>Performance</h2>
                            <label className="chart-toggle">
                              <input
                                type="checkbox"
                                checked={showMcBands}
                                disabled={!displayedResult.monteCarlo}
                                onChange={(e) => setShowMcBands(e.target.checked)}
                              />
                              Monte Carlo band
                            </label>
                          </div>
                          <p className="sub">
                            {displayedResult.request.symbol} · {displayedResult.request.interval} · {STRATEGY_LABELS[displayedResult.request.strategy]} {displayedResult.best.fast}/{displayedResult.best.slow} · {displayedResult.periodStart} → {displayedResult.periodEnd}.
                            Both series are indexed to 1 at the start.
                            {displayedResult.monteCarlo && showMcBands && (
                              <> Shaded cone: {displayedResult.monteCarlo.paths} stationary-bootstrap resamples of the strategy&apos;s own bar returns.</>
                            )}
                          </p>
                          <EquityChart
                            series={displayedResult.series}
                            bands={displayedResult.monteCarlo ?? null}
                            showBands={showMcBands}
                          />
                        </div>

                        <div className="card">
                          <h2>Signal behavior</h2>
                          <p className="sub">Shaded bands are held positions. Signals form on one bar and execute on the next, with no look-ahead.</p>
                          <PriceChart
                            series={displayedResult.series}
                            strategy={displayedResult.request.strategy}
                            fast={displayedResult.best.fast}
                            slow={displayedResult.best.slow}
                            symbol={displayedResult.request.symbol}
                          />
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="parameters" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        {data.results.length > 3 ? (
                          <StabilityPanel
                            stability={data.stability}
                            results={data.results}
                            best={data.best}
                            selected={inspect}
                            onSelect={inspectCombo}
                          />
                        ) : null}
                        <div className="card">
                          <h2>Candidate ranking</h2>
                          <p className="sub">The top 15 combinations behind the winner. Select a row to inspect that pair without losing the full sweep.</p>
                          <ResultsTable data={data} onSelect={inspectCombo} selected={inspect} />
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="walkforward" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <WalkForwardTimeline report={data.walkForwardReport} />
                        <div className="card">
                          <h2>Walk-forward validation</h2>
                          <p className="sub">Choose parameters on one window, then trade the next window blind.</p>
                          <WalkForwardTable data={data} />
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="attribution" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <FactorPanel report={data.factors} />
                        <RegimePanel regimes={data.regimes} />
                        <TearSheet
                          tail={data.tail}
                          interval={data.request.interval}
                          turnoverPerYear={data.tail.annualisedTurnover}
                        />
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="decision" activeId={researchSection}>
                      <StaleGate
                        active={researchStale}
                        running={running}
                        targetSymbol={req.symbol}
                        targetInterval={req.interval}
                        onRerun={() => run()}
                      >
                        <PromotionPanel
                          gate={data.promotion}
                          symbol={data.request.symbol}
                          fast={data.best.fast}
                          slow={data.best.slow}
                          strategyLabel={STRATEGY_LABELS[data.request.strategy]}
                          slippageBps={data.request.slippageBps}
                          blocked={researchDirty || running || Boolean(inspect)}
                          blockedReason={researchDirty
                            ? "Refresh this candidate for the current desk context before promotion."
                            : inspect
                              ? "Return to the full parameter sweep before promotion."
                              : "Wait for the active research run to finish."}
                          onHandOff={() => navigate("live")}
                        />
                        <SizingPanel
                          best={data.best}
                          gate={data.promotion}
                          equity={REFERENCE_EQUITY}
                        />
                        <div className="workflow-handoff research-data-handoff">
                          <div>
                            <span className="page-kicker">Evidence lineage</span>
                            <strong>Verify the inputs before approving the candidate.</strong>
                            <small>Open the data workspace with {data.request.symbol} still in context.</small>
                          </div>
                          <button onClick={() => navigate("data")}>Trace market data</button>
                        </div>
                      </StaleGate>
                    </WorkspaceSubtabPanel>

                    <WorkspaceSubtabPanel workspaceId="research" tabId="runs" activeId={researchSection}>
                      <ExperimentHistory
                        records={experiments}
                        activeRequest={data.request}
                        onClone={cloneExperiment}
                        onRemove={dropExperiment}
                        onClear={() => setExperiments(clearExperiments())}
                        onAnnotate={(id, annotation) =>
                          setExperiments((current) => annotateExperiment(current, id, annotation))}
                        onImport={(merged) => setExperiments(saveExperiments(merged))}
                      />
                    </WorkspaceSubtabPanel>
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {view === "live" && (
          <section id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="view-panel">
            <WorkspaceIntro
              kicker="Quant trader"
              title="Execution"
              description={<>Trade {req.symbol}, inspect liquidity, compare routing cost and review fills without one endless page.</>}
              insights={[
                { label: "Instrument", value: req.symbol, detail: "consolidated L2", tone: "accent", mono: true },
                { label: "Intent", value: `${side} ${usd(notional, 0)}`, detail: "editable in the ticket", tone: side === "BUY" ? "good" : "warn", mono: true },
                { label: "Authority", value: "Paper only", detail: "pre-trade gates stay in control", tone: "good" },
              ]}
            />
            <WorkspaceSubtabs
              workspaceId="execution"
              label="Quant trader sections"
              tabs={EXECUTION_SECTIONS}
              activeId={executionSection}
              onChange={setExecutionSection}
            />
            <LiveMarket
              symbol={req.symbol}
              onSymbolChange={updateSymbol}
              side={side}
              onSideChange={setSide}
              notional={notional}
              onNotionalChange={setNotional}
              research={activeResult}
              onOpenResearch={() => navigate("research")}
              onOpenData={() => navigate("data")}
              section={executionSection}
              onPriceSelect={stageLimitFromLadder}
            >
              <ExecutionCockpit
                symbol={req.symbol}
                side={side}
                notional={notional}
                orderType={orderType}
                limitPrice={limitPrice}
                section={executionSection}
                onSideChange={setSide}
                onNotionalChange={setNotional}
                onOrderTypeChange={setOrderType}
                onLimitPriceChange={setLimitPrice}
                operatorToken={systems.token}
                researchStrategy={activeResult ? activeResult.request.strategy : null}
                researchExperimentId={null}
                onOpenResearch={() => navigate("research")}
              />
            </LiveMarket>
          </section>
        )}

        {view === "data" && (
          <section id="panel-data" role="tabpanel" aria-labelledby="tab-data" className="view-panel">
            <DataConsole
              view={systems}
              workspaceSymbol={req.symbol}
              workspaceInterval={req.interval}
              onWorkspaceSymbolChange={updateSymbol}
              onOpenReliability={() => navigate("reliability")}
              section={dataSection}
              onSectionChange={changeDataSection}
              workItems={dataWorkItems}
              onWorkItemsChange={setDataWorkItems}
            />
          </section>
        )}

        {view === "reliability" && (
          <section id="panel-reliability" role="tabpanel" aria-labelledby="tab-reliability" className="view-panel">
            <ReliabilityConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenData={() => navigate("data")}
              section={reliabilitySection}
              onSectionChange={changeReliabilitySection}
            />
          </section>
        )}

        {view === "developer" && (
          <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer" className="view-panel">
            <DeveloperConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenResearch={() => navigate("research")}
              onOpenLive={() => navigate("live")}
              onOpenReliability={() => navigate("reliability")}
              section={developerSection}
              onSectionChange={setDeveloperSection}
              workItems={developerWorkItems}
              onWorkItemsChange={setDeveloperWorkItems}
            />
          </section>
        )}

        <footer className="workspace-footer">
          <span>AlphaEngine</span>
          <p>
            Educational case-study demonstration built for a developer assessment. Not a brokerage
            or investment service: no accounts, no funds, no real orders, and no credentials are
            requested from visitors. Execution is paper-only and remains gated by the risk gateway.
            Not investment advice.
          </p>
        </footer>
      </main>
    </>
  );
}
