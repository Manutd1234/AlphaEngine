import { mean, normCdf, stdev } from "../stats";
import {
  BARS_PER_YEAR,
  type Bar,
  type CellKind,
  type FoldEfficiency,
  type MonthlyReturn,
  type ParamResult,
  type PromotionCheck,
  type PromotionGate,
  type Regression,
  type StabilityCell,
  type StabilityReport,
  type TailReport,
  type Verdict,
  type WalkForwardFold,
  type WalkForwardReport,
} from "../types";

// --------------------------------------------------------------------------
// Parameter stability
// --------------------------------------------------------------------------

/** Neighbour retention at or above this is a plateau. */
const PLATEAU_RETENTION = 0.6;
/** Retention at or below this is a cliff: the neighbours do not follow. */
const CLIFF_RETENTION = 0.2;

/**
 * Classify every grid point by what its neighbours do.
 *
 * Adjacency is in *grid index* space, not in raw parameter units, because the
 * grid is a sparse lattice: with `fastStep: 5` the neighbour of 25 is 20, and
 * measuring distance in parameter units would call 24 a neighbour when 24 was
 * never tested. Sorting the distinct values and stepping by index is the only
 * definition that matches what the sweep actually evaluated.
 */
export function parameterStability(results: ParamResult[]): StabilityReport {
  const fasts = [...new Set(results.map((r) => r.fast))].sort((a, b) => a - b);
  const slows = [...new Set(results.map((r) => r.slow))].sort((a, b) => a - b);
  const fastIndex = new Map(fasts.map((v, i) => [v, i]));
  const slowIndex = new Map(slows.map((v, i) => [v, i]));

  const grid = new Map<string, ParamResult>();
  for (const r of results) grid.set(`${fastIndex.get(r.fast)}:${slowIndex.get(r.slow)}`, r);

  const cells: StabilityCell[] = results.map((r) => {
    const fi = fastIndex.get(r.fast)!;
    const si = slowIndex.get(r.slow)!;
    const around: number[] = [];
    for (let df = -1; df <= 1; df++) {
      for (let ds = -1; ds <= 1; ds++) {
        if (df === 0 && ds === 0) continue;
        const hit = grid.get(`${fi + df}:${si + ds}`);
        if (hit) around.push(hit.sharpe);
      }
    }

    const neighbourMean = around.length ? mean(around) : 0;
    const neighbourMin = around.length ? Math.min(...around) : 0;
    const retention = r.sharpe > 0 && around.length ? neighbourMean / r.sharpe : null;

    let kind: CellKind;
    if (around.length < 3) kind = "isolated";
    else if (r.sharpe <= 0) kind = "dead";
    else if (retention === null) kind = "isolated";
    else if (retention >= PLATEAU_RETENTION) kind = "plateau";
    else if (retention <= CLIFF_RETENTION) kind = "cliff";
    else kind = "slope";

    return {
      fast: r.fast,
      slow: r.slow,
      sharpe: r.sharpe,
      neighbours: around.length,
      neighbourMean,
      neighbourMin,
      retention,
      kind,
    };
  });

  let best: StabilityCell | null = null;
  for (const cell of cells) if (!best || cell.sharpe > best.sharpe) best = cell;

  const plateauCount = cells.filter((c) => c.kind === "plateau").length;
  const cliffCount = cells.filter((c) => c.kind === "cliff").length;
  const classified = cells.filter((c) => c.kind !== "isolated").length;

  return { cells, best, plateauCount, cliffCount, classified, verdict: stabilityVerdict(best) };
}

function stabilityVerdict(best: StabilityCell | null): Verdict {
  if (!best) {
    return { level: "fail", headline: "No grid to assess", detail: "The sweep produced no results." };
  }
  if (best.sharpe <= 0) {
    return {
      level: "fail",
      headline: "The best cell is not profitable",
      detail:
        "The highest Sharpe in the grid is at or below zero, so there is no neighbourhood to assess. "
        + "Parameter stability is a question you only get to ask about something that worked.",
    };
  }
  if (best.kind === "isolated") {
    return {
      level: "marginal",
      headline: "The winner sits on the grid edge",
      detail:
        "Fewer than three tested neighbours surround the best combination, so its robustness cannot be judged. "
        + "Widen the search range so the winner is interior — an optimum at the boundary is usually a sign the "
        + "true optimum is outside the grid.",
    };
  }
  const around = describeNeighbourhood(best);
  if (best.kind === "cliff") {
    return {
      level: "fail",
      headline: "The winner is a cliff, not a plateau",
      detail:
        `${around} A real edge degrades smoothly as parameters move; an isolated spike that collapses one `
        + "grid step away is a coordinate the search found in noise, and it will not survive live.",
    };
  }
  if (best.kind === "plateau") {
    return {
      level: "pass",
      headline: "The winner sits on a plateau",
      detail:
        `${around} The result does not depend on hitting one exact coordinate, which is what a robust `
        + "parameterisation looks like — necessary, not sufficient.",
    };
  }
  return {
    level: "marginal",
    headline: "The winner sits on a slope",
    detail:
      `${around} Degrading, but not collapsing — treat the reported parameters as the top of a ridge `
      + "rather than a stable operating point.",
  };
}

/**
 * Describe the neighbourhood without letting a ratio explode.
 *
 * `retention` is `neighbourMean / sharpe`, and the denominator is a Sharpe that
 * can be a hair above zero — a winner at 0.006 with negative neighbours yields
 * −8268%, which is arithmetically correct and communicates nothing. Whenever the
 * ratio leaves the band where a percentage means something, the two Sharpes are
 * quoted directly instead. Percentages are a convenience, not the measurement.
 */
export function describeNeighbourhood(cell: StabilityCell): string {
  const own = cell.sharpe.toFixed(2);
  const mean_ = cell.neighbourMean.toFixed(2);
  const retention = cell.retention;
  if (retention === null || retention < 0 || retention > 2) {
    return (
      `The winner's Sharpe is ${own}; its ${cell.neighbours} tested neighbours average ${mean_}.`
    );
  }
  return (
    `Neighbouring combinations retain ${Math.round(retention * 100)}% of the winner's Sharpe on average `
    + `(${mean_} against ${own}).`
  );
}
