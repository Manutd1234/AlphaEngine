"use client";

/**
 * Terminal-outcome Monte Carlo, resampling the research winner's realised
 * returns — the exact drivers behind the band on the Research equity chart.
 *
 * Sits one subtab away from (never inside) the Oracle GBM VaR: three loss
 * estimates share one workspace — parametric closed form, in-database GBM
 * simulation, and this bootstrap of realised returns — and disagreement
 * between them is signal, not error. The computation runs in a dedicated
 * worker; the main thread only draws the result.
 *
 * Every parameter the simulation runs on is a control (McParameterRail), and
 * where one is displayed it is read from the RESULT rather than from the
 * request — the resampler through `mcResamplerOf`, the confidences through
 * `mcLossConfidences`. A card that named a parameter from what it asked for
 * could not tell a reader when the two disagreed, which is the only case worth
 * reporting.
 *
 * The line that reported the seed, the block length and the path count was
 * removed on request. Note what that does and does not change: the run is
 * still reproducible, and the seed is still derived from the sweep rather than
 * drawn fresh — the property survives, only the sentence about it went. It is
 * `directed-removals.test.ts` (entry O.7) that keeps the sentence from coming
 * back, not this comment.
 */

import { useMemo, useState } from "react";

import McHistogram from "@/components/risk/McHistogram";
import McParameterRail, {
  MC_SEED_MAX,
  parseMcSeed,
  TAIL_CONFIDENCES,
  type McBandChoice,
} from "@/components/risk/McParameterRail";
import StatTile from "@/components/StatTile";
import { fmt, usd } from "@/lib/format";
import {
  MC_RESAMPLER_LABELS,
  mcLossConfidences,
  mcResamplerOf,
  type McResampler,
} from "@/lib/mc-distribution";
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
   * Owned by RiskWorkspace, not this card: the GBM panel on the oraclevar
   * subtab reads the same value, so the two loss estimates are always over
   * one horizon and their disagreement stays a statement about method.
   */
  horizonDays: number;
  onOpenResearch: () => void;
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
  /* The stationary bootstrap is the default because the drivers have
     volatility clustering and it keeps it; the i.i.d. draw is offered so a
     reader can see what that clustering is worth, not because it is a
     defensible way to read a tail on its own. */
  const [resampler, setResampler] = useState<McResampler>("stationary");
  /* "auto" is the √N heuristic the equity band uses — the derived value stays
     the default, and the control exists so it is a choice rather than a
     constant nobody can see. */
  const [blockLength, setBlockLength] = useState<"auto" | number>("auto");
  /* The three loss confidences. "standard" keeps 50/95/99, and keeping it the
     default matters beyond taste: a default request serialises exactly as it
     always has, which is what lib/mc-parity.ts compares byte for byte. */
  const [bands, setBands] = useState<McBandChoice>("standard");
  /* Empty means "the seed the sweep derived", which is shown in the box as a
     placeholder. It is text rather than a number so a half-typed seed is
     never committed as some other number. */
  const [seedText, setSeedText] = useState("");

  const seedTyped = seedText.trim() !== "";
  const seedOverride = seedTyped ? parseMcSeed(seedText) : null;
  // Typed, but not a seed. The simulation is NOT run on the derived seed
  // behind the reader's back, and not on 0 either — the request goes null and
  // the card says why, because a distribution under a seed nobody chose is
  // exactly the kind of quiet substitution this card exists to rule out.
  const seedUnusable = seedTyped && seedOverride === null;

  // Quantised so a live book repolling every 15s does not re-simulate on
  // every equity tick — the same restraint OracleVarPanel applies.
  const equityForRun = Math.round(equity / 1_000) * 1_000 || equity;

  const request = useMemo(() => {
    if (!driver || driver.returns.length === 0 || seedUnusable) return null;
    const barsPerDay = 24 / hoursPerBar(driver.interval);
    return {
      returns: driver.returns,
      horizonBars: Math.max(1, Math.round(horizonDays * barsPerDay)),
      paths,
      resampler,
      // Sent only where it means something: an i.i.d. draw has no block
      // length, and the simulation refuses the pair rather than dropping one.
      ...(resampler === "stationary" && blockLength !== "auto"
        ? { meanBlockLength: blockLength }
        : {}),
      ...(bands === "standard" ? {} : { lossConfidences: TAIL_CONFIDENCES }),
      seed: seedOverride ?? driver.seed,
      equity: equityForRun,
      // Not read by the simulation — changes request identity so the palette
      // action re-runs with identical inputs (and provably identical output).
      nonce: runNonce,
    };
  }, [driver, horizonDays, paths, resampler, blockLength, bands, seedOverride, seedUnusable, equityForRun, runNonce]);

  const state = useMcDistribution(request);
  const result = state.result;
  // Read once, off the result, beside the figures they describe. Every label
  // below is built from these rather than from a literal, so a figure cannot
  // be printed under a confidence or a resampler it was not computed at.
  const lossBands = result ? mcLossConfidences(result) : ([50, 95, 99] as [number, number, number]);
  const ran = result ? mcResamplerOf(result) : resampler;

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
        {/* Every parameter but the horizon. That one is the workspace-owned
            seg above the card, shared with the GBM panel's subtab, so the two
            estimates cannot be read against each other on two different
            clocks. */}
        <McParameterRail
          paths={paths}
          onPaths={setPaths}
          resampler={resampler}
          onResampler={setResampler}
          blockLength={blockLength}
          onBlockLength={setBlockLength}
          bands={bands}
          onBands={setBands}
          seedText={seedText}
          onSeedText={setSeedText}
          derivedSeed={driver.seed}
        />
      </div>
      <p className="sub">
        Resamples <strong>{driver.label}</strong>&apos;s realised {driver.interval} returns — the
        exact drivers behind the Research band — with the {MC_RESAMPLER_LABELS[ran]} over a{" "}
        {horizonDays}-day forward horizon, and keeps where each path ends. Computed off the main
        thread{state.engine === "main-thread" ? " (worker unavailable — chunked fallback, same numbers)" : ""}.
      </p>

      {ran === "iid" && (
        <div className="banner warn" role="status">
          <span aria-hidden>▲</span>
          <div>
            <strong>No volatility clustering.</strong> An i.i.d. draw treats every future bar as
            independent, so the losing runs these returns actually had never form and the tail
            comes back narrower than the book would experience. Read it against the blocked draw,
            not on its own.
          </div>
        </div>
      )}

      {seedUnusable && (
        <div className="banner warn" role="status">
          <span aria-hidden>▲</span>
          <div>
            <strong>Nothing simulated.</strong> A seed is a whole number from 0 to{" "}
            {MC_SEED_MAX.toLocaleString()}, and this card will not quietly run some other one.
            Clear the box to use the sweep&apos;s own seed, {driver.seed}.
          </div>
        </div>
      )}

      {state.status === "running" && (
        <>
          {/* Reserved at the shape of the result it precedes — the histogram
              with its range row (198px of svg plus the min/max line), then
              the tile row — rather than one short shimmer. A single 180px
              skeleton collapsed the card by roughly 200px on every re-run,
              so each horizon or parameter change bounced whatever sat below
              it: the twitch, not the simulation, was what the reader saw. */}
          <div className="skeleton" style={{ height: 212 }} />
          <div className="skeleton" style={{ height: 92, marginTop: 12 }} />
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
          <McHistogram result={result} />

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
            {/* Three tiles, one per confidence asked for, each labelled with
                the confidence its own figure was computed at. The first was a
                "P50 outcome" tile reading the median: true at 50, and a
                mislabelled median at any other first band. */}
            {[result.loss.p50, result.loss.p95, result.loss.p99].map((loss, index) => (
              <StatTile
                key={lossBands[index]}
                label={`P${lossBands[index]} loss`}
                value={usd(loss, 0)}
                tone="neg"
                note={`not exceeded in ${lossBands[index]}% of paths`}
              />
            ))}
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

          {/* The reproducibility note was removed on request. The property it
              described is unchanged — the seed still runs the simulation and
              is still on screen in the Seed control above (the derived seed as
              the placeholder, an override as the typed value). Do not re-add
              the sentence. */}
          <span className="sr-only" role="status">
            Monte Carlo complete: P{lossBands[1]} loss {usd(result.loss.p95, 0)},{" "}
            {withinHeadroom ? "within" : "breaching"} drawdown headroom.
          </span>
        </>
      )}
    </div>
  );
}
