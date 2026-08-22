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
 * What the desk removed was the STANDALONE line reporting the seed, the block
 * length and the path count, and `directed-removals.test.ts` (entry O.7) is
 * what keeps it from coming back, not this comment. The facts did not all go
 * with it: the run is still reproducible from the sweep-derived seed, and the
 * block the run resolved survives as a derivation inside the disclosure below.
 */

import { useMemo, useState } from "react";

import McDegenerateNotice from "@/components/risk/McDegenerateNotice";
import McHistogram from "@/components/risk/McHistogram";
import McParameterRail, {
  MC_SEED_MAX,
  parseMcSeed,
  TAIL_CONFIDENCES,
  type McBandChoice,
} from "@/components/risk/McParameterRail";
import { mcDriverDegeneracy, mcResultDegeneracy, mcRoundsToZero, mcUsd } from "@/components/risk/mc-degeneracy";
import NumberTicker from "@/components/common/NumberTicker";
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

  /* Whether these drivers can make a distribution at all, decided before a
     worker is spun up for an answer already known. A winner that never took a
     position ships returns that are every one of them zero and a driver that
     is non-null — `mc-degeneracy.ts` carries the trace from
     `lib/engine/combo.ts`. This is a SECOND branch, not an extension of the
     null one below: research completed, and what it produced was a winner with
     nothing to resample. The reader needs that sentence, not "run research". */
  const driverDefect = useMemo(() => (driver?.returns.length ? mcDriverDegeneracy(driver.returns) : null), [driver]);

  const request = useMemo(() => {
    if (!driver || driver.returns.length === 0 || seedUnusable || driverDefect) return null;
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
  }, [driver, driverDefect, horizonDays, paths, resampler, blockLength, bands, seedOverride, seedUnusable, equityForRun, runNonce]);

  const state = useMcDistribution(request);
  const result = state.result;
  // Read once, off the result, beside the figures they describe. Every label
  // below is built from these rather than from a literal, so a figure cannot
  // be printed under a confidence or a resampler it was not computed at.
  const lossBands = result ? mcLossConfidences(result) : ([50, 95, 99] as [number, number, number]);
  const ran = result ? mcResamplerOf(result) : resampler;
  /* The block the run RESOLVED, never the rail's request: "auto" derives √N and an asked block
     is clamped, so the two can differ. Rejected: widening `asked`, printed only when it refuses. */
  const blocksRan = result ? `${result.meanBlockLength} bar${result.meanBlockLength === 1 ? "" : "s"}` : "— nothing simulated yet";
  /* The other half of the guard, over the finished run rather than its inputs:
     a result whose paths all end at one value has no quantiles, whatever the
     drivers looked like going in. A guard only on the inputs would cover the
     one cause anybody has seen so far, and the tiles cannot tell a
     distribution from a repeated number — which is how five zeroes shipped
     under a "Within headroom" verdict. */
  const resultDefect = result ? mcResultDegeneracy(result) : null;
  // What was asked for, printed under either refusal.
  const asked = `${paths.toLocaleString()} paths, ${horizonDays}-day horizon, seed ${seedOverride ?? driver?.seed ?? "—"}`;

  if (!driver || driver.returns.length === 0) {
    return (
      <div className="card capability-empty">
        <span className="role-monogram" aria-hidden>MC</span>
        <div>
          <span className="page-kicker">No completed run</span>
          <h2>The distribution needs the research winner&apos;s returns.</h2>
          <p>Resamples the drivers behind the Research equity band. Run research first.</p>
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
      {/* The method, not the result. Which returns were resampled, by which
          resampler and over what horizon: read once, and every parameter it
          names is also a control in the rail above, so nothing at rest stops
          being knowable. Word for word what the card used to say openly.

          The engine notice does NOT come along. `.disclosure` takes
          derivations and never a status, and which of the two engines drew
          these numbers is a status — so it keeps its own line at rest and the
          reader is told before opening anything. */}
      <details className="disclosure">
        <summary>How is this simulated?</summary>
        <p className="research-note">
          Resamples <strong>{driver.label}</strong>&apos;s realised {driver.interval} returns with the{" "}
          {MC_RESAMPLER_LABELS[ran]} over a {horizonDays}-day forward horizon, keeping where each
          path ends. Blocks average {blocksRan}.
        </p>
      </details>
      {state.engine === "main-thread" && (
        <p className="sub">Worker unavailable; chunked fallback, same numbers.</p>
      )}

      {/* The live figure this card stands on, and why it is not the one the
          simulation ran against. The equity quantisation stays — a 99th
          percentile redrawn on every 15s poll is noise — but the card never
          said so, and a reader watching five figures hold still under a
          "live-pushed" chrome read the tab as disconnected. The silence was
          the defect, not the restraint. See BookConcentration for the rest. */}
      <p className="sub mc-live-equity">
        Book equity <NumberTicker value={equity} format={(value) => usd(value, 0)} /> on the live
        feed; this run holds the {usd(equityForRun, 0)} bucket and re-simulates when the book
        crosses into the next $1,000.
      </p>

      {ran === "iid" && (
        <div className="banner warn" role="status">
          <span aria-hidden>▲</span>
          <div>
            <strong>No volatility clustering.</strong> An i.i.d. draw treats every bar as
            independent, so losing runs never form and the tail comes back too narrow. Read it
            against the blocked draw.
          </div>
        </div>
      )}

      {seedUnusable && (
        <div className="banner warn" role="status">
          <span aria-hidden>▲</span>
          <div>
            <strong>Nothing simulated.</strong> A seed is a whole number from 0 to{" "}
            {MC_SEED_MAX.toLocaleString()}. Clear the box to use the sweep&apos;s own seed,{" "}
            {driver.seed}.
          </div>
        </div>
      )}

      {/* No worker was started, so `state` is idle and every branch below is
          already false; kept as its own guard so that stays true. */}
      {driverDefect && (
        <McDegenerateNotice
          headline={driverDefect.headline}
          detail={driverDefect.detail}
          asked={asked}
          /* Research is the fix here and only here — a different strategy or
             parameter range is what makes the winner trade. The post-run
             refusal offers no such button. */
          onOpenResearch={onOpenResearch}
        />
      )}

      {state.status === "running" && (
        <>
          {/* Reserved at the shape of the result it precedes — the histogram
              with its range row (198px of svg plus the min/max line), then
              the tile block — rather than one short shimmer. A single 180px
              skeleton collapsed the card by roughly 200px on every re-run,
              so each horizon or parameter change bounced whatever sat below
              it: the twitch, not the simulation, was what the reader saw.
              The tile reserve is two rows: the five tiles land 4 + 1 on the
              four-track stability grid, so a single-row reserve still let
              every re-run collapse the card by a tile row. 196 is two 92px
              rows plus the 12px grid gap — the fallback below. At desk width
              the density partial (14e) lays the five tiles on five tracks,
              one 92px row, and narrows `--mc-tile-reserve` alongside that
              grid rule, so reserve and result stay the same shape at every
              width rather than only below the desk breakpoint. */}
          <div className="skeleton" style={{ height: 212 }} />
          <div className="skeleton" style={{ height: "var(--mc-tile-reserve, 196px)", marginTop: 12 }} />
          <p className="muted num" style={{ fontSize: "var(--fs-body)" }}>
            Simulating {(state.progress?.done ?? 0).toLocaleString()} /{" "}
            {(state.progress?.total ?? paths).toLocaleString()} paths
          </p>
          <span className="sr-only" role="status">
            Monte Carlo running.
          </span>
        </>
      )}

      {state.status === "error" && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div><strong>Not computed.</strong> {state.error}</div>
        </div>
      )}

      {/* A completed run whose outcomes never moved. Tiles, histogram and
          verdict are skipped together — the verdict especially, because
          "Within headroom. P95 loss $0" is the sentence a trader acts on and
          it would be safety claimed from a simulation that measured nothing. */}
      {state.status === "done" && resultDefect && (
        <McDegenerateNotice
          headline={resultDefect.headline}
          detail={resultDefect.detail}
          asked={asked}
        />
      )}

      {state.status === "done" && result && !resultDefect && (
        <>
          <McHistogram result={result} />

          {/* `<StatTile>`, not five hand-typed copies of what it renders.
              `mcUsd`, never `usd`: the loss figures are negated percentiles, so
              a break-even quantile is negative zero by construction and the
              card shipped "P95 LOSS $-0". The tone obeys the same rule, or a
              figure that has rounded away would still be coloured as a loss. */}
          <div className="tiles stability-tiles">
            <StatTile
              label="Mean outcome"
              value={mcUsd(result.pnl.mean)}
              tone={mcRoundsToZero(result.pnl.mean) ? "muted" : result.pnl.mean < 0 ? "neg" : "pos"}
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
                value={mcUsd(loss)}
                tone={mcRoundsToZero(loss) ? "muted" : "neg"}
                note={`not exceeded in ${lossBands[index]}% of paths`}
              />
            ))}
            <StatTile
              label="Worst case"
              value={mcUsd(result.pnl.worst)}
              tone={mcRoundsToZero(result.pnl.worst) ? "muted" : "neg"}
              note={`single worst of ${result.paths.toLocaleString()} paths`}
            />
          </div>

          {withinHeadroom !== null && (
            <div className={`banner${withinHeadroom ? "" : " warn"}`} role="status">
              <span aria-hidden style={{ color: withinHeadroom ? "var(--success-text)" : "var(--warning-text)" }}>
                {withinHeadroom ? "✓" : "▲"}
              </span>
              <div>
                <strong>{withinHeadroom ? "Within headroom." : "Breaches headroom."}</strong>{" "}
                P{lossBands[1]} loss {mcUsd(result.loss.p95)} over {horizonDays} day{horizonDays === 1 ? "" : "s"}{" "}
                against the {usd(cushionUsd, 0)} left in the drawdown-to-halt budget on the Limits tab
                {withinHeadroom ? "." : " — a tail outcome this size would trip the halt."}{" "}
                {/* Gone at 1d, the seg's first choice, where it stops being true: this screen is
                    conservative BECAUSE a multi-day tail meets one day's cushion, and over one day
                    the spans match. `disclosure-risk.test.ts` pins the sentence, so WHEN is the lever. */}
                {horizonDays > 1 && <>A multi-day loss against today&apos;s budget is a conservative screen.</>}
                {sandbox ? " Sandbox book, same limits." : ""}
              </div>
            </div>
          )}

          {/* The reproducibility note was removed on request. The property it
              described is unchanged — the seed still runs the simulation and
              is still on screen in the Seed control above (the derived seed as
              the placeholder, an override as the typed value). Do not re-add
              the sentence. */}
          <span className="sr-only" role="status">
            Monte Carlo complete: P{lossBands[1]} loss {mcUsd(result.loss.p95)},{" "}
            {withinHeadroom ? "within" : "breaching"} drawdown headroom.
          </span>
        </>
      )}
    </div>
  );
}
