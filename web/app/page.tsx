"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Controls from "@/components/Controls";
import DataFeeds from "@/components/DataFeeds";
import EquityChart from "@/components/EquityChart";
import Heatmap from "@/components/Heatmap";
import LiveMarket from "@/components/LiveMarket";
import PortfolioWorkspace, { type PortfolioFocusDestination } from "@/components/PortfolioWorkspace";
import PriceChart from "@/components/PriceChart";
import StatTile from "@/components/StatTile";
import { ResultsTable, WalkForwardTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import WorkspaceHeader, { type WorkspaceView } from "@/components/WorkspaceHeader";
import WorkspaceOverview from "@/components/WorkspaceOverview";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import {
  DEFAULT_REQUEST,
  ParamResult,
  STRATEGY_LABELS,
  SweepRequest,
  SweepResponse,
} from "@/lib/types";
import type { Side } from "@/lib/venues";

const VIEWS: WorkspaceView[] = ["overview", "portfolio", "research", "live", "data"];

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
  const activeRun = useRef<AbortController | null>(null);
  const runSeq = useRef(0);

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
                <span className="page-kicker">Portfolio managers</span>
                <h1>Portfolio &amp; risk</h1>
                <p>Book-level exposure, concentration, P&amp;L and risk headroom from the authoritative gateway.</p>
              </div>
            </div>
            <PortfolioWorkspace workspaceSymbol={req.symbol} onFocusSymbol={focusPortfolioSymbol} />
          </section>
        )}

        {view === "research" && (
          <section id="panel-research" role="tabpanel" aria-labelledby="tab-research" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Researchers</span>
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

                    {data.results.length > 3 && (
                      <div className="card">
                        <h2>Sharpe surface</h2>
                        <p className="sub">A broad plateau suggests an edge that survives small parameter changes; an isolated bright cell is a warning sign.</p>
                        <Heatmap results={data.results} best={data.best} selected={inspect} onSelect={inspectCombo} />
                      </div>
                    )}

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
                <span className="page-kicker">Traders</span>
                <h1>Execution</h1>
                <p>Cross-venue liquidity, live order books and implementation cost for {req.symbol}.</p>
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
          </section>
        )}

        {view === "data" && (
          <section id="panel-data" role="tabpanel" aria-labelledby="tab-data" className="view-panel">
            <div className="page-heading">
              <div>
                <span className="page-kicker">Developers &amp; data operations</span>
                <h1>Systems &amp; data</h1>
                <p>Provider health, quote lineage, news, quotas and desk-facing APIs.</p>
              </div>
            </div>
            <DataFeeds
              workspaceSymbol={req.symbol}
              onWorkspaceSymbolChange={updateSymbol}
              onOpenResearch={() => navigate("research")}
              onOpenLive={() => navigate("live")}
            />
          </section>
        )}

        <footer className="workspace-footer">
          <span>AlphaEngine</span>
          <p>Research and execution support infrastructure. Not investment advice. Live orders remain gated by the authoritative risk gateway.</p>
        </footer>
      </main>
    </>
  );
}
