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
import StatTile from "@/components/StatTile";
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
  /**
   * Owned by the montecarlo section, not this card: the GBM panel beside it
   * reads the same value, so the two loss estimates are always over one
   * horizon and their disagreement stays a statement about method.
   */
  horizonDays: number;
  onOpenResearch: () => void;
}

const PATH_CHOICES = [2_000, 10_000, 50_000] as const;
/* 1 is the i.i.d. degenerate case and is offered deliberately: comparing the
   cone against it is how a reader sees what volatility clustering is worth. */
const BLOCK_CHOICES = [1, 5, 10, 20, 50] as const;

/** The confidences a result was computed at.
 *
 * `lossBands` is present only when the caller asked for something other than
 * the default three — that absence is what keeps a default result's canonical
 * JSON byte-identical for lib/mc-parity.ts. So its absence MEANS 50/95/99,
 * and reading it that way is how every label stays true to its figure. */
function bandConfidences(result: McDistributionResult): [number, number, number] {
  const bands = result.lossBands;
  if (!bands || bands.length !== 3) return [50, 95, 99];
  return [bands[0].confidence, bands[1].confidence, bands[2].confidence];
}

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

  // Labels come from the RESULT, never from a constant. With tail bands
  // selected these are 90/99/99.9, and printing a 99.9 % loss under a "P99"
  // label would be a figure wearing the wrong name — which is worse than not
  // offering the choice at all.
  const [c50, c95, c99] = bandConfidences(result);
  const markers = [
    { label: `P${c50}`, value: result.pnl.p50 },
    { label: `P${c95}`, value: -result.loss.p95 },
    { label: `P${c99}`, value: -result.loss.p99 },
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
              fontSize={10}
              fill={marker.label === "P50" ? "var(--text-muted)" : "var(--critical-text)"}
            >
              {marker.label}
            </text>
          </g>
        ))}
      </svg>
      <div
        className="muted num"
        style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--fs-2xs)" }}
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
  horizonDays,
  onOpenResearch,
}: MonteCarloDistributionProps) {
  const [paths, setPaths] = useState<number>(10_000);
  /* "auto" is the √N heuristic the equity band uses; 1 makes the resampler
     i.i.d., which is the resampler choice rather than a separate control —
     with pNew = 1 every draw starts a new block, so blocks never form. The
     option says what that costs, because i.i.d. destroys the volatility
     clustering these returns have and narrows the cone in exactly the tail
     the cone exists to show. */
  const [blockLength, setBlockLength] = useState<"auto" | number>("auto");
  /* The three loss confidences. "standard" keeps 50/95/99, and keeping it the
     default matters beyond taste: a default request serialises exactly as it
     always has, which is what lib/mc-parity.ts compares byte for byte. */
  const [confidences, setConfidences] = useState<"standard" | "tail">("standard");

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
      ...(blockLength === "auto" ? {} : { meanBlockLength: blockLength }),
      ...(confidences === "standard" ? {} : { lossConfidences: [90, 99, 99.9] as [number, number, number] }),
      seed: driver.seed,
      equity: equityForRun,
      // Not read by the simulation — changes request identity so the palette
      // action re-runs with identical inputs (and provably identical output).
      nonce: runNonce,
    };
  }, [driver, horizonDays, paths, blockLength, confidences, equityForRun, runNonce]);

  const state = useMcDistribution(request);
  const result = state.result;
  // Read once, beside the result it describes. Every label below is built from
  // these rather than from a literal, so a figure cannot be printed under a
  // confidence it was not computed at.
  const lossBands = result ? bandConfidences(result) : ([50, 95, 99] as [number, number, number]);

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
          <button type="button" className="text-action" onClick={onOpenResearch}>
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
        {/* Paths only. The horizon moved to the section-level seg above the
            card, shared with the GBM panel, so the two estimates cannot be
            read against each other on two different clocks. */}
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
          Block
          <select
            value={String(blockLength)}
            onChange={(event) => {
              const next = event.target.value;
              setBlockLength(next === "auto" ? "auto" : Number(next));
            }}
            aria-label="Mean bootstrap block length, in bars"
          >
            <option value="auto">auto (&radic;N)</option>
            {BLOCK_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {choice === 1 ? "1 — i.i.d." : `${choice} bars`}
              </option>
            ))}
          </select>
        </label>
        <label className="rail-toggle">
          Bands
          <select
            value={confidences}
            onChange={(event) => setConfidences(event.target.value as "standard" | "tail")}
            aria-label="Loss confidences to report"
          >
            <option value="standard">50 / 95 / 99</option>
            <option value="tail">90 / 99 / 99.9</option>
          </select>
        </label>
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
          <p className="muted num" style={{ fontSize: "var(--fs-body)" }}>
            simulating: {(state.progress?.done ?? 0).toLocaleString()} /{" "}
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

          {/* `<StatTile>`, not five hand-typed copies of what it renders. The
              markup here was character-for-character its output — label div,
              `num stat-tile__value` with a data-tone, note div — while sibling
              panels in this same directory imported the component. */}
          <div className="tiles stability-tiles">
            <StatTile
              label="Mean outcome"
              value={usd(result.pnl.mean, 0)}
              tone={result.pnl.mean < 0 ? "neg" : "pos"}
              note={`${fmt(result.probLoss * 100, 1)}% of paths end in loss`}
            />
            <StatTile label={`P${lossBands[0]} outcome`} value={usd(result.pnl.p50, 0)} note="median terminal P&L" />
            <StatTile
              label={`P${lossBands[1]} loss`}
              value={usd(result.loss.p95, 0)}
              tone="neg"
              note={`not exceeded in ${lossBands[1]}% of paths`}
            />
            <StatTile
              label={`P${lossBands[2]} loss`}
              value={usd(result.loss.p99, 0)}
              tone="neg"
              note={`not exceeded in ${lossBands[2]}% of paths`}
            />
            <StatTile
              label="Worst case"
              value={usd(result.pnl.worst, 0)}
              tone="neg"
              note={`single worst of ${result.paths.toLocaleString()} paths`}
            />
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
                P{lossBands[1]} loss {usd(result.loss.p95, 0)} over {horizonDays} days against the{" "}
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
            Reproducible: seed {result.seed}, mean block {result.meanBlockLength} bars,{" "}
            {result.paths.toLocaleString()} paths on {compact(equityForRun)} equity. Rerunning the
            same sweep redraws this exact distribution.
          </p>
          <span className="sr-only" role="status">
            Monte Carlo complete: P{lossBands[1]} loss {usd(result.loss.p95, 0)},{" "}
            {withinHeadroom ? "within" : "breaching"} drawdown headroom.
          </span>
        </>
      )}
    </div>
  );
}
