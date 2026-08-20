"use client";

/**
 * Research ▸ Summary: what this sweep produced, and what data produced it.
 *
 * The reproducibility capsule sits ABOVE the stale gate deliberately — reading
 * the provenance of the old result is exactly what someone facing the veil
 * needs to do. Everything below it is gated, because a Sharpe belonging to a
 * symbol the reader has since changed must never be presented as current.
 */

import { useMemo } from "react";

import EquityChart from "@/components/EquityChart";
import PriceChart from "@/components/PriceChart";
import StaleGate from "@/components/research/StaleGate";
import StatTile from "@/components/StatTile";
import Verdict from "@/components/Verdict";
import { fmt, pct, signedPct, usd } from "@/lib/format";
import { STRATEGY_LABELS, type SweepResponse } from "@/lib/types";
import { APP_COMMIT } from "@/lib/version";

export interface ResearchSummaryProps {
  /** The run on screen — the drill-down's result when one is open, else the sweep. */
  displayedResult: SweepResponse;
  researchStale: boolean;
  sweepIncoming: boolean;
  running: boolean;
  targetSymbol: string;
  targetInterval: string;
  showMcBands: boolean;
  onShowMcBandsChange: (next: boolean) => void;
  onRerun: () => void;
}

export default function ResearchSummary({
  displayedResult,
  researchStale,
  sweepIncoming,
  running,
  targetSymbol,
  targetInterval,
  showMcBands,
  onShowMcBandsChange,
  onRerun,
}: ResearchSummaryProps) {
  const shown = displayedResult.best;
  const tiles = useMemo(() => {
    // A cost assumption must never be invisible: when anything beyond flat
    // bps was modelled, the tile says which frictions were charged.
    const costs = displayedResult.costs;
    const frictionNote = costs && !costs.flatOnly
      ? [
          costs.impactBps > 0 ? `+${fmt(costs.impactBps, 1)} bps impact` : null,
          costs.fundingBpsPer8h !== 0 ? `funding ${fmt(costs.fundingBpsPer8h, 1)} bps/8h` : null,
          costs.borrowBpsAnnual > 0 ? `borrow ${fmt(costs.borrowBpsAnnual, 0)} bps/yr` : null,
        ].filter(Boolean).join(", ")
      : null;
    return (
      <div className="tiles research-tiles">
        <StatTile
          label="Annualised Sharpe"
          value={fmt(shown.sharpe, 2)}
          note={`buy & hold ${fmt(displayedResult.benchmark.sharpe, 2)}`}
          tone={shown.sharpe > displayedResult.benchmark.sharpe ? "pos" : "muted"}
          explain={{
            definition: "Excess return per unit of volatility, scaled to a year.",
            formula: "√periods·mean(r) ÷ stdev(r)",
            plainEnglish:
              "How much return the strategy earned for the amount it bounced around. "
              + "Compare it to buy-and-hold below — beating the market matters less than "
              + "beating it per unit of risk taken.",
          }}
        />
        <StatTile
          label="Total return"
          value={signedPct(shown.totalReturn)}
          note={`buy & hold ${signedPct(displayedResult.benchmark.totalReturn)}`}
          tone={shown.totalReturn >= 0 ? "pos" : "neg"}
        />
        <StatTile
          label="Max drawdown"
          value={pct(shown.maxDrawdown)}
          note={`calmar ${fmt(shown.calmar, 2)}`}
          tone="neg"
          explain={{
            definition: "The deepest peak-to-trough fall in equity over the run.",
            formula: "min(equity ÷ running-max(equity) − 1)",
            plainEnglish:
              "The worst losing streak you would have had to sit through. This is the number "
              + "that decides whether a strategy is actually tradable — a great Sharpe with a "
              + "60% drawdown gets turned off by a human long before it recovers.",
          }}
        />
        <StatTile label="Trades" value={String(shown.trades)} note={`win rate ${pct(shown.winRate, 0)}`} />
        <StatTile
          label="Time in market"
          value={pct(shown.exposure, 0)}
          note={`turnover ${fmt(shown.turnover, 1)}×`}
          explain={{
            definition: "Share of bars holding a position, and how often the book turned over.",
            plainEnglish:
              "Low exposure with a high Sharpe means the edge is concentrated in a few periods; "
              + "high turnover means costs matter more than the headline return suggests.",
          }}
        />
        <StatTile
          label="Costs paid"
          value={usd(shown.feesPaid)}
          note={frictionNote ? `on a $100k book; ${frictionNote}` : "on a $100k book"}
        />
      </div>
    );
  }, [displayedResult, shown]);

  return (
    <>
      {/* The capsule stays outside the stale gate: reading the
          provenance of the old result is exactly what someone
          facing the veil needs to do. */}
      <div className="research-provenance" aria-label="Research reproducibility capsule">
        <div className="research-provenance__lead">
          <span className="page-kicker">Reproducibility capsule</span>
          <strong>Evidence carries its own data identity.</strong>
        </div>
        <dl>
          <div>
            <dt>Instrument</dt>
            <dd className="num">{displayedResult.request.symbol} at {displayedResult.request.interval}</dd>
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
        mode={sweepIncoming ? "recomputing" : "stale"}
        running={running}
        targetSymbol={targetSymbol}
        targetInterval={targetInterval}
        onRerun={onRerun}
      >
        <Verdict data={displayedResult} />

        {tiles}

        <div className="compact-grid-2col research-chart-pair">
          <div className="card">
            <div className="chart-heading">
              <h2>Performance</h2>
              <label className="chart-toggle">
                <input
                  type="checkbox"
                  checked={showMcBands}
                  disabled={!displayedResult.monteCarlo}
                  onChange={(e) => onShowMcBandsChange(e.target.checked)}
                />
                Monte Carlo band
              </label>
            </div>
            <p className="sub">
              {displayedResult.request.symbol} at {displayedResult.request.interval}, {STRATEGY_LABELS[displayedResult.request.strategy]} {displayedResult.best.fast}/{displayedResult.best.slow}.
            </p>
            <EquityChart
              series={displayedResult.series}
              bands={displayedResult.monteCarlo ?? null}
              showBands={showMcBands}
            />
          </div>

          <div className="card">
            <h2>Signal behaviour</h2>
            <p className="sub">Shaded bands are held positions. Signals form on one bar and execute on the next.</p>
            <PriceChart
              series={displayedResult.series}
              strategy={displayedResult.request.strategy}
              fast={displayedResult.best.fast}
              slow={displayedResult.best.slow}
              symbol={displayedResult.request.symbol}
            />
          </div>
        </div>

      </StaleGate>
    </>
  );
}
