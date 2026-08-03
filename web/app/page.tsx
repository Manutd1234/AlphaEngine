"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import Controls from "@/components/Controls";
import DataFeeds from "@/components/DataFeeds";
import EquityChart from "@/components/EquityChart";
import Heatmap from "@/components/Heatmap";
import LiveMarket from "@/components/LiveMarket";
import PriceChart from "@/components/PriceChart";
import StatTile from "@/components/StatTile";
import { ResultsTable, WalkForwardTable } from "@/components/Tables";
import Verdict from "@/components/Verdict";
import ThemeToggle from "@/components/ThemeToggle";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import {
  DEFAULT_REQUEST,
  ParamResult,
  STRATEGY_LABELS,
  SweepRequest,
  SweepResponse,
} from "@/lib/types";

export default function Page() {
  const [req, setReq] = useState<SweepRequest>(DEFAULT_REQUEST);
  const [data, setData] = useState<SweepResponse | null>(null);
  const [inspect, setInspect] = useState<ParamResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"research" | "live" | "data">("research");

  const run = useCallback(
    async (override?: Partial<SweepRequest>) => {
      setRunning(true);
      setError(null);
      try {
        const body = { ...req, ...override };
        const res = await fetch("/api/backtest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
        setData(json as SweepResponse);
        setInspect(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [req],
  );

  // One sweep on first paint so the page is never an empty shell.
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Re-run pinned to one parameter pair, so clicking a heatmap cell shows what
   *  that combination actually did rather than just its Sharpe. */
  const inspectCombo = useCallback(
    (r: ParamResult) => {
      setInspect(r);
      void run({
        fastMin: r.fast,
        fastMax: r.fast + 1,
        fastStep: 1,
        slowMin: r.slow,
        slowMax: r.slow + 1,
        slowStep: 1,
        walkForward: false,
      });
    },
    [run],
  );

  const shown = data?.best;
  const tiles = useMemo(() => {
    if (!data || !shown) return null;
    return (
      <div className="tiles" style={{ marginBottom: 16 }}>
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
        <StatTile label="Costs paid" value={usd(shown.feesPaid)} note={`on a $100k book`} />
      </div>
    );
  }, [data, shown]);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            Alpha<span>Engine</span>
            <small>Strategy research portal</small>
          </div>
          <div className="seg" style={{ maxWidth: 400 }} role="tablist" aria-label="View">
            <button role="tab" aria-selected={view === "research"} aria-pressed={view === "research"} onClick={() => setView("research")}>
              🧪 Research
            </button>
            <button role="tab" aria-selected={view === "live"} aria-pressed={view === "live"} onClick={() => setView("live")}>
              📡 Live market
            </button>
            <button role="tab" aria-selected={view === "data"} aria-pressed={view === "data"} onClick={() => setView("data")}>
              🛰 Data feeds
            </button>
          </div>
          <div className="grow" />
          {view === "research" && data && (
            <span className="num muted" style={{ fontSize: 11.5 }}>
              {data.combosTested} combos · {data.durationMs} ms · {data.bars} bars ·{" "}
              {data.dataSource === "binance" ? "Binance live" : "synthetic"}
            </span>
          )}
          <ThemeToggle />
        </div>
      </header>

      <main className="shell">
        {error && (
          <div className="banner error" role="alert">
            <span aria-hidden>✕</span>
            <div>
              <strong>Sweep failed.</strong> {error}
            </div>
          </div>
        )}
        {data?.warnings.map((w) => (
          <div className="banner warn" key={w} role="status">
            <span aria-hidden>!</span>
            <div>{w}</div>
          </div>
        ))}

        {view === "live" ? (
          <LiveMarket />
        ) : view === "data" ? (
          <DataFeeds />
        ) : (
        <div className="cols">
          <Controls req={req} setReq={setReq} onRun={() => run()} running={running} />

          <div>
            {!data && running && (
              <>
                <div className="skeleton" style={{ height: 150, marginBottom: 16 }} />
                <div className="skeleton" style={{ height: 330 }} />
              </>
            )}

            {data && (
              <>
                <Verdict data={data} />

                {inspect && (
                  <div className="banner warn" role="status">
                    <span aria-hidden>👁</span>
                    <div>
                      Inspecting the single combination <strong className="num">{inspect.fast}/{inspect.slow}</strong>{" "}
                      — statistics below are for this pair alone, not a search.{" "}
                      <button className="icon" style={{ marginLeft: 6 }} onClick={() => run()}>
                        Back to full sweep
                      </button>
                    </div>
                  </div>
                )}

                {tiles}

                <div className="card">
                  <h2>Performance</h2>
                  <p className="sub">
                    {data.request.symbol} · {data.request.interval} ·{" "}
                    {STRATEGY_LABELS[data.request.strategy]} {data.best.fast}/{data.best.slow} ·{" "}
                    {data.periodStart} → {data.periodEnd}. Both series are indexed to 1 at the start
                    so they share one axis.
                  </p>
                  <EquityChart series={data.series} />
                </div>

                <div className="card">
                  <h2>What the model actually did</h2>
                  <p className="sub">
                    Shaded bands are the bars the strategy held a position. Signals form on a bar
                    and execute on the next — there is no look-ahead.
                  </p>
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
                    <p className="sub">
                      Every combination in the grid. A broad plateau means the edge survives small
                      parameter changes; a lone bright cell surrounded by grey is an overfit that
                      happens to have won this particular search.
                    </p>
                    <Heatmap
                      results={data.results}
                      best={data.best}
                      selected={inspect}
                      onSelect={inspectCombo}
                    />
                  </div>
                )}

                <div className="card">
                  <h2>Walk-forward validation</h2>
                  <p className="sub">
                    The honest test: choose parameters on one window, trade the next one blind.
                  </p>
                  <WalkForwardTable data={data} />
                </div>

                <div className="card">
                  <h2>Top 15 by Sharpe</h2>
                  <p className="sub">
                    The full ranking behind the winner. Click a row to inspect that pair.
                  </p>
                  <ResultsTable data={data} onSelect={inspectCombo} selected={inspect} />
                </div>
              </>
            )}
          </div>
        </div>
        )}

        <footer style={{ marginTop: 28, fontSize: 12, color: "var(--text-muted)", maxWidth: "78ch" }}>
          Research tool, not investment advice. Backtests model fees and slippage but assume fills at
          the close of the next bar; live execution costs are measured separately by the
          AlphaEngine TCA gateway. Market data from Binance public endpoints.
        </footer>
      </main>
    </>
  );
}
