"use client";

/**
 * Terminal-outcome Monte Carlo, resampling the research winner's realised
 * returns — the exact drivers behind the band on the Research equity chart.
 *
 * Sits beside (not inside) the Oracle GBM VaR: three loss estimates now share
 * one workspace — parametric closed form, in-database GBM simulation, and this
 * bootstrap of realised returns — and disagreement between them is signal, not
 * error. The computation runs in a dedicated worker; the main thread only
 * draws the result.
 */

import { useMemo, useState } from "react";

import { linearScale, useMeasuredWidth } from "@/components/chart-kit";
import { compact, fmt, usd } from "@/lib/format";
import type { McDistributionResult } from "@/lib/mc-distribution";
import { hoursPerBar } from "@/lib/quant";
import { useMcDistribution } from "@/lib/use-mc-distribution";

export interface McDriver {
  /** `SweepResponse.bestRunReturns` — the band's driver distribution. */
  returns: number[];
  /** `mcSeedFor(dataHash, best.fast, best.slow)` — the band's seed. */
  seed: number;
  /** "Moving-average crossover · 20/80" */
  label: string;
  /** The run's bar interval, e.g. "4h" — converts the horizon to bars. */
  interval: string;
}

interface MonteCarloDistributionProps {
  driver: McDriver | null;
  equity: number;
  /** Dollars of drawdown left before the halt trips — the headroom screened. */
  cushionUsd: number;
  sandbox: boolean;
  /** Bumped by the palette action to re-run with the current inputs. */
  runNonce: number;
  onOpenResearch: () => void;
}

const PATH_CHOICES = [2_000, 10_000, 50_000] as const;
const HORIZON_CHOICES = [10, 30, 90] as const;

function HistogramChart({ result }: { result: McDistributionResult }) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const height = 180;
  const bins = result.histogram;
  if (!bins || width === 0) return <div ref={ref} />;

  const lo = bins.edges[0];
  const hi = bins.edges[bins.edges.length - 1];
  const peak = Math.max(...bins.counts, 1);
  const x = linearScale(lo, hi, 0, width);
  const y = linearScale(0, peak, height, 0);
  const barW = width / bins.counts.length;

  const markers = [
    { label: "P50", value: result.pnl.p50 },
    { label: "P95", value: -result.loss.p95 },
    { label: "P99", value: -result.loss.p99 },
  ];

  return (
    <div ref={ref}>
      <svg
        viewBox={`0 0 ${width} ${height + 18}`}
        width="100%"
        height={height + 18}
        role="img"
        aria-label={`Terminal P&L distribution of ${result.paths.toLocaleString()} paths between ${usd(lo, 0)} and ${usd(hi, 0)}, with P50, P95 and P99 loss markers`}
      >
        {bins.counts.map((count, i) => (
          <rect
            key={bins.edges[i]}
            x={i * barW + 0.5}
            y={y(count)}
            width={Math.max(1, barW - 1)}
            height={Math.max(count > 0 ? 1 : 0, height - y(count))}
            fill="var(--series-1)"
            opacity={0.7}
            rx={1}
          />
        ))}
        {/* Break-even line: everything left of it ended in loss. */}
        <line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke="var(--axis)" strokeDasharray="2 3" />
        {markers.map((marker) => (
          <g key={marker.label}>
            <line
              x1={x(marker.value)}
              x2={x(marker.value)}
              y1={10}
              y2={height}
              stroke={marker.label === "P50" ? "var(--text-muted)" : "var(--critical-text)"}
              strokeWidth={marker.label === "P50" ? 1 : 1.25}
            />
            <text
              x={x(marker.value)}
              y={height + 14}
              textAnchor="middle"
              fontSize={9.5}
              fill={marker.label === "P50" ? "var(--text-muted)" : "var(--critical-text)"}
            >
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
      <div
        className="muted num"
        style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}
      >
        <span>{usd(lo, 0)}</span>
        <span>break-even at $0</span>
        <span>{usd(hi, 0)}</span>
      </div>
    </div>
  );
}

export default function MonteCarloDistribution({
  driver,
  equity,
  cushionUsd,
  sandbox,
  runNonce,
  onOpenResearch,
}: MonteCarloDistributionProps) {
  const [paths, setPaths] = useState<number>(10_000);
  const [horizonDays, setHorizonDays] = useState<number>(30);

  // Quantised so a live book repolling every 15s does not re-simulate on
  // every equity tick — the same restraint OracleVarPanel applies.
  const equityForRun = Math.round(equity / 1_000) * 1_000 || equity;

  const request = useMemo(() => {
    if (!driver || driver.returns.length === 0) return null;
    const barsPerDay = 24 / hoursPerBar(driver.interval);
    return {
      returns: driver.returns,
      horizonBars: Math.max(1, Math.round(horizonDays * barsPerDay)),
      paths,
      seed: driver.seed,
      equity: equityForRun,
      // Not read by the simulation — changes request identity so the palette
      // action re-runs with identical inputs (and provably identical output).
      nonce: runNonce,
    };
  }, [driver, horizonDays, paths, equityForRun, runNonce]);

  const state = useMcDistribution(request);
  const result = state.result;

  if (!driver || driver.returns.length === 0) {
    return (
      <div className="card capability-empty">
        <span className="role-monogram" aria-hidden>MC</span>
        <div>
          <span className="page-kicker">No completed run</span>
          <h2>The distribution needs the research winner&apos;s returns.</h2>
          <p>
            It resamples the same drivers as the Monte Carlo band on the Research equity chart —
            run research first, then come back.
          </p>
          <button type="button" className="primary-action" onClick={onOpenResearch}>
            Open Research
          </button>
        </div>
      </div>
    );
  }

  const p95Loss = result?.loss.p95 ?? null;
  const withinHeadroom = p95Loss !== null ? p95Loss < cushionUsd : null;

  return (
    <div className="card" aria-busy={state.status === "running"}>
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Independent computation</span>
          <h2>Monte Carlo terminal distribution</h2>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label className="rail-toggle">
            Paths
            <select
              value={paths}
              onChange={(event) => setPaths(Number(event.target.value))}
              aria-label="Simulation path count"
            >
              {PATH_CHOICES.map((choice) => (
                <option key={choice} value={choice}>{choice.toLocaleString()}</option>
              ))}
            </select>
          </label>
          <label className="rail-toggle">
            Horizon
            <select
              value={horizonDays}
              onChange={(event) => setHorizonDays(Number(event.target.value))}
              aria-label="Forward horizon in days"
            >
              {HORIZON_CHOICES.map((choice) => (
                <option key={choice} value={choice}>{choice} days</option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="sub">
        Resamples <strong>{driver.label}</strong>&apos;s realised {driver.interval} returns — the
        exact drivers behind the Research band — with a stationary bootstrap over a{" "}
        {horizonDays}-day forward horizon, and keeps where each path ends. Computed off the main
        thread{state.engine === "main-thread" ? " (worker unavailable — chunked fallback, same numbers)" : ""}.
      </p>

      {state.status === "running" && (
        <>
          <div className="skeleton" style={{ height: 180 }} />
          <p className="muted num" style={{ fontSize: 11.5 }}>
            simulating · {(state.progress?.done ?? 0).toLocaleString()} /{" "}
            {(state.progress?.total ?? paths).toLocaleString()} paths
          </p>
          <span className="sr-only" role="status">
            Monte Carlo simulation running.
          </span>
        </>
      )}

      {state.status === "error" && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div><strong>Not computed.</strong> {state.error}</div>
        </div>
      )}

      {state.status === "done" && result && (
        <>
          <HistogramChart result={result} />

          <div className="tiles stability-tiles">
            <div className="stat-tile">
              <div className="stat-tile__label">Mean outcome</div>
              <div className="num stat-tile__value" data-tone={result.pnl.mean < 0 ? "neg" : "pos"}>
                {usd(result.pnl.mean, 0)}
              </div>
              <div className="stat-tile__note">
                {fmt(result.probLoss * 100, 1)}% of paths end in loss
              </div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">P50 outcome</div>
              <div className="num stat-tile__value">{usd(result.pnl.p50, 0)}</div>
              <div className="stat-tile__note">median terminal P&amp;L</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">P95 loss</div>
              <div className="num stat-tile__value" data-tone="neg">{usd(result.loss.p95, 0)}</div>
              <div className="stat-tile__note">not exceeded in 95% of paths</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">P99 loss</div>
              <div className="num stat-tile__value" data-tone="neg">{usd(result.loss.p99, 0)}</div>
              <div className="stat-tile__note">not exceeded in 99% of paths</div>
            </div>
            <div className="stat-tile">
              <div className="stat-tile__label">Worst case</div>
              <div className="num stat-tile__value" data-tone="neg">{usd(result.pnl.worst, 0)}</div>
              <div className="stat-tile__note">
                single worst of {result.paths.toLocaleString()} paths
              </div>
            </div>
          </div>

          {withinHeadroom !== null && (
            <div className={`banner${withinHeadroom ? "" : " warn"}`} role="status">
              <span
                aria-hidden
                style={{ color: withinHeadroom ? "var(--success-text)" : "var(--warning-text)" }}
              >
                {withinHeadroom ? "✓" : "▲"}
              </span>
              <div>
                <strong>
                  {withinHeadroom ? "Within headroom." : "Breaches headroom."}
                </strong>{" "}
                P95 loss {usd(result.loss.p95, 0)} over {horizonDays} days against the{" "}
                {usd(cushionUsd, 0)} left in the drawdown-to-halt budget on the Limits tab
                {withinHeadroom
                  ? "."
                  : " — a tail outcome at this size would trip the halt."}{" "}
                A multi-day loss screened against today&apos;s budget is deliberately conservative.
                {sandbox ? " Sandbox book — same limits, generated positions." : ""}
              </div>
            </div>
          )}

          <p className="research-note">
            Reproducible: seed {result.seed} · mean block {result.meanBlockLength} bars ·{" "}
            {result.paths.toLocaleString()} paths on {compact(equityForRun)} equity. Rerunning the
            same sweep redraws this exact distribution.
          </p>
          <span className="sr-only" role="status">
            Monte Carlo complete: P95 loss {usd(result.loss.p95, 0)},{" "}
            {withinHeadroom ? "within" : "breaching"} drawdown headroom.
          </span>
        </>
      )}
    </div>
  );
}
