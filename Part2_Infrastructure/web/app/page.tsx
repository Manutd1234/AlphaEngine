"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Controls from "@/components/Controls";
import DataConsole from "@/components/DataConsole";
import DeveloperConsole from "@/components/DeveloperConsole";
import EquityChart from "@/components/EquityChart";
import ExecutionCockpit from "@/components/execution/ExecutionCockpit";
import LiveMarket from "@/components/LiveMarket";
import PortfolioWorkspace, { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import PriceChart from "@/components/PriceChart";
import ReliabilityConsole from "@/components/ReliabilityConsole";
import RiskWorkspace from "@/components/RiskWorkspace";
import ExperimentHistory from "@/components/research/ExperimentHistory";
import FactorPanel from "@/components/research/FactorPanel";
import PromotionPanel from "@/components/research/PromotionPanel";
import SizingPanel from "@/components/research/SizingPanel";
import StabilityPanel from "@/components/research/StabilityPanel";
import TearSheet from "@/components/research/TearSheet";
import WalkForwardTimeline from "@/components/research/WalkForwardTimeline";
import StatTile from "@/components/StatTile";
import { ResultsTable, WalkForwardTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import WorkspaceHeader, { NAV_ITEMS, type WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceOverview from "@/components/WorkspaceOverview";
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
  type ExperimentRecord,
} from "@/lib/experiments";
import type { Side } from "@/lib/venues";

const VIEWS: WorkspaceView[] = NAV_ITEMS.map((item) => item.id);

/**
 * The console used to be one "Systems" tab. Anyone holding a link to it lands on
 * reliability, which is the half that answers "is it up" — the question someone
 * following a saved systems link is most likely asking.
 */
const LEGACY_VIEWS: Record<string, WorkspaceView> = {
  systems: "reliability",
};

interface ProviderSummary {
  configured: number;
  total: number;
  degraded: number;
}

export default function Page() {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  const [data, setData] = useState<SweepResponse | null>(null);
  const [inspect, setInspect] = useState<ParamResult | null>(null);
  const [running, setRunning] = useState(false);
  const [researchDirty, setResearchDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>("overview");
  const [side, setSide] = useState<Side>("BUY");
  const [notional, setNotional] = useState(100_000);
  const [providerSummary, setProviderSummary] = useState<ProviderSummary | null>(null);
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
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = next;
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    }
  }, []);

  useEffect(() => {
    const readLocation = () => {
      const hash = window.location.hash.slice(1) as WorkspaceView;
      if (VIEWS.includes(hash)) setView(hash);
      else if (LEGACY_VIEWS[hash]) setView(LEGACY_VIEWS[hash]);
    };
    readLocation();
    window.addEventListener("popstate", readLocation);
    window.addEventListener("hashchange", readLocation);
    return () => {
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("hashchange", readLocation);
    };
  }, []);

  useEffect(() => {
    fetch("/api/providers")
      .then((response) => response.json())
      .then((body) => {
        const summary = body.summary as { configured?: number; ready?: number; total?: number; degraded?: string[] } | undefined;
        if (summary) {
          setProviderSummary({
            configured: summary.ready ?? summary.configured ?? 0,
            total: summary.total ?? 0,
            degraded: summary.degraded?.length ?? 0,
          });
        }
      })
      .catch(() => setProviderSummary({ configured: 0, total: 0, degraded: 1 }));
  }, []);

  const run = useCallback(
    async (override?: Partial<SweepRequest>, preserveInspect = false) => {
      activeRun.current?.abort();
      const controller = new AbortController();
      activeRun.current = controller;
      const sequence = ++runSeq.current;

      setRunning(true);
      setError(null);
      if (!preserveInspect) setInspect(null);

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
        setData(json as SweepResponse);
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
  }, []);

  const dropExperiment = useCallback((id: string) => {
    setExperiments((current) => removeExperiment(current, id));
  }, []);

  const updateRequest = useCallback((next: SweepRequest) => {
    setReq(next);
    setResearchDirty(true);
    setInspect(null);
  }, []);

  const updateSymbol = useCallback((symbol: string) => {
    setReq((current) => ({ ...current, symbol }));
    setResearchDirty(true);
    setInspect(null);
  }, []);

  const updateInterval = useCallback((interval: string) => {
    setReq((current) => ({ ...current, interval }));
    setResearchDirty(true);
    setInspect(null);
  }, []);

  const focusPortfolioSymbol = useCallback((symbol: string, destination: PortfolioFocusDestination) => {
    updateSymbol(symbol);
    navigate(destination);
  }, [navigate, updateSymbol]);

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
  const shown = data?.best;
  const contextNote = researchDirty
    ? `${req.symbol} context changed · rerun research`
    : activeResult
      ? `${STRATEGY_LABELS[activeResult.request.strategy]} ${activeResult.best.fast}/${activeResult.best.slow} · ${activeResult.verdict.level}`
      : running
        ? `Building ${req.symbol} baseline`
        : undefined;

  const tiles = useMemo(() => {
    if (!data || !shown) return null;
    return (
      <div className="tiles research-tiles">
        <StatTile
          label="Annualised Sharpe"
          value={fmt(shown.sharpe, 2)}
          note={`buy & hold ${fmt(data.benchmark.sharpe, 2)}`}
          tone={shown.sharpe > data.benchmark.sharpe ? "pos" : "muted"}
        />
        <StatTile
          label="Total return"
          value={signedPct(shown.totalReturn)}
          note={`buy & hold ${signedPct(data.benchmark.totalReturn)}`}
          tone={shown.totalReturn >= 0 ? "pos" : "neg"}
        />
        <StatTile label="Max drawdown" value={pct(shown.maxDrawdown)} note={`calmar ${fmt(shown.calmar, 2)}`} tone="neg" />
        <StatTile label="Trades" value={String(shown.trades)} note={`win rate ${pct(shown.winRate, 0)}`} />
        <StatTile label="Time in market" value={pct(shown.exposure, 0)} note={`turnover ${fmt(shown.turnover, 1)}×`} />
        <StatTile label="Costs paid" value={usd(shown.feesPaid)} note="on a $100k book" />
      </div>
    );
  }, [data, shown]);

  return (
    <>
      <WorkspaceHeader
        view={view}
        onViewChange={navigate}
        symbol={req.symbol}
        onSymbolChange={updateSymbol}
        interval={req.interval}
        onIntervalChange={updateInterval}
        providerSummary={providerSummary}
        contextNote={contextNote}
      />

      <main className="workspace-shell">
        {view === "overview" && (
          <section id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="view-panel">
            <WorkspaceOverview
              request={req}
              result={activeResult}
              running={running}
              side={side}
              notional={notional}
              providerSummary={providerSummary}
              onNavigate={navigate}
            />
          </section>
        )}

        {view === "portfolio" && (
          <section id="panel-portfolio" role="tabpanel" aria-labelledby="tab-portfolio" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Portfolio manager</span>
                <h1>Portfolio</h1>
                <p>
                  What the book holds, how the capital is spread across it, and which sleeve earned
                  the P&amp;L — from the authoritative gateway.
                </p>
              </div>
            </div>
            <PortfolioWorkspace
              view={book}
              workspaceSymbol={req.symbol}
              onFocusSymbol={focusPortfolioSymbol}
              onOpenRisk={() => navigate("risk")}
            />
          </section>
        )}

        {view === "risk" && (
          <section id="panel-risk" role="tabpanel" aria-labelledby="tab-risk" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Risk manager</span>
                <h1>Risk</h1>
                <p>
                  Limit headroom, loss estimates scored against their own record, scenario damage and
                  the controls that stop trading.
                </p>
              </div>
            </div>
            <RiskWorkspace
              view={book}
              onOpenPortfolio={() => navigate("portfolio")}
              onOpenResearch={() => navigate("research")}
            />
          </section>
        )}

        {view === "research" && (
          <section id="panel-research" role="tabpanel" aria-labelledby="tab-research" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Quant researchers</span>
                <h1>Research lab</h1>
                <p>Parameter search, robustness checks and walk-forward evidence for {req.symbol}.</p>
              </div>
            </div>

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

            <div className="research-layout">
              <Controls req={req} setReq={updateRequest} onRun={() => run()} running={running} />

              <div className="research-content">
                {!data && running && (
                  <>
                    <div className="skeleton" style={{ height: 150, marginBottom: 16 }} />
                    <div className="skeleton" style={{ height: 330 }} />
                  </>
                )}

                {data && (
                  <>
                    <Verdict data={data} />

                    <div className="workflow-handoff">
                      <div>
                        <span className="page-kicker">Research → execution handoff</span>
                        <strong>{data.request.symbol} · {STRATEGY_LABELS[data.request.strategy]} {data.best.fast}/{data.best.slow}</strong>
                        <small>
                          {data.verdict.level === "pass" ? "Candidate passed the current validation gates." : "Review the weak evidence before treating this as a trading candidate."}
                          {" "}The model assumes {data.request.slippageBps} bps slippage.
                        </small>
                      </div>
                      <div>
                        <button className="primary-action" onClick={() => navigate("live")}>Price {usd(notional, 0)} live</button>
                        <button onClick={() => navigate("data")}>Trace market data</button>
                      </div>
                    </div>

                    {inspect && (
                      <div className="banner warn" role="status">
                        <span aria-hidden>◎</span>
                        <div>
                          Inspecting <strong className="num">{inspect.fast}/{inspect.slow}</strong> as a single combination, not a search.
                          <button className="text-action" onClick={() => run()}>Back to full sweep →</button>
                        </div>
                      </div>
                    )}

                    {tiles}

                    <div className="card">
                      <h2>Performance</h2>
                      <p className="sub">
                        {data.request.symbol} · {data.request.interval} · {STRATEGY_LABELS[data.request.strategy]} {data.best.fast}/{data.best.slow} · {data.periodStart} → {data.periodEnd}.
                        Both series are indexed to 1 at the start.
                      </p>
                      <EquityChart series={data.series} />
                    </div>

                    <div className="card">
                      <h2>Signal behavior</h2>
                      <p className="sub">Shaded bands are held positions. Signals form on one bar and execute on the next, with no look-ahead.</p>
                      <PriceChart
                        series={data.series}
                        strategy={data.request.strategy}
                        fast={data.best.fast}
                        slow={data.best.slow}
                        symbol={data.request.symbol}
                      />
                    </div>

                    <PromotionPanel
                      gate={data.promotion}
                      symbol={data.request.symbol}
                      fast={data.best.fast}
                      slow={data.best.slow}
                      strategyLabel={STRATEGY_LABELS[data.request.strategy]}
                      slippageBps={data.request.slippageBps}
                      onHandOff={() => navigate("live")}
                    />

                    {/* Directly under the verdict, because "it passed" is only
                        half an answer and the other half is a position size. */}
                    <SizingPanel
                      best={data.best}
                      gate={data.promotion}
                      equity={REFERENCE_EQUITY}
                    />

                    {data.results.length > 3 && (
                      <StabilityPanel
                        stability={data.stability}
                        results={data.results}
                        best={data.best}
                        selected={inspect}
                        onSelect={inspectCombo}
                      />
                    )}

                    <WalkForwardTimeline report={data.walkForwardReport} />

                    <FactorPanel report={data.factors} />

                    <TearSheet
                      tail={data.tail}
                      interval={data.request.interval}
                      turnoverPerYear={data.tail.annualisedTurnover}
                    />

                    <div className="card">
                      <h2>Walk-forward validation</h2>
                      <p className="sub">Choose parameters on one window, then trade the next window blind.</p>
                      <WalkForwardTable data={data} />
                    </div>

                    <div className="card">
                      <h2>Candidate ranking</h2>
                      <p className="sub">The top 15 combinations behind the winner. Select a row to isolate that pair.</p>
                      <ResultsTable data={data} onSelect={inspectCombo} selected={inspect} />
                    </div>

                    <ExperimentHistory
                      records={experiments}
                      activeRequest={data.request}
                      onClone={cloneExperiment}
                      onRemove={dropExperiment}
                      onClear={() => setExperiments(clearExperiments())}
                      onAnnotate={(id, annotation) =>
                        setExperiments((current) => annotateExperiment(current, id, annotation))}
                    />
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {view === "live" && (
          <section id="panel-live" role="tabpanel" aria-labelledby="tab-live" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Quant traders</span>
                <h1>Execution</h1>
                <p>
                  Live books and implementation cost for {req.symbol}, with the desk&apos;s own flow — orders,
                  fills, P&amp;L and alerts — on the same screen.
                </p>
              </div>
            </div>
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
            />
            <ExecutionCockpit
              symbol={req.symbol}
              side={side}
              notional={notional}
              researchStrategy={activeResult ? activeResult.request.strategy : null}
              researchExperimentId={null}
              onOpenResearch={() => navigate("research")}
            />
          </section>
        )}

        {view === "data" && (
          <section id="panel-data" role="tabpanel" aria-labelledby="tab-data" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Data engineer</span>
                <h1>Data quality</h1>
                <p>
                  Where a request routes, whether independent sources agree, what failed its contract
                  and what the budget for asking looks like.
                </p>
              </div>
            </div>
            <DataConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onWorkspaceSymbolChange={updateSymbol}
              onOpenReliability={() => navigate("reliability")}
            />
          </section>
        )}

        {view === "reliability" && (
          <section id="panel-reliability" role="tabpanel" aria-labelledby="tab-reliability" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">DevOps / SRE</span>
                <h1>Reliability</h1>
                <p>
                  Service health, circuit breakers, latency percentiles, the live event trace and the
                  operator drills that rehearse an outage before a real one.
                </p>
              </div>
            </div>
            <ReliabilityConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenData={() => navigate("data")}
            />
          </section>
        )}

        {view === "developer" && (
          <section id="panel-developer" role="tabpanel" aria-labelledby="tab-developer" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Quant developer</span>
                <h1>Developer</h1>
                <p>
                  The API surface, the committed schema behind it, and the gates that fail the build
                  when either drifts.
                </p>
              </div>
            </div>
            <DeveloperConsole
              view={systems}
              workspaceSymbol={req.symbol}
              onOpenResearch={() => navigate("research")}
              onOpenLive={() => navigate("live")}
              onOpenReliability={() => navigate("reliability")}
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
