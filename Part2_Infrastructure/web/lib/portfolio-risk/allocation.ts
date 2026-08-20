import { CovarianceModel, covariance } from "./covariance";
import { RiskPosition } from "./inputs";

// --------------------------------------------------------------------------
// Allocation
//
// The workspace could say what the book *is* — exposure, concentration, risk
// contributions — and nothing about what it should be. This closes that, and is
// deliberately naive about expected return: it allocates by risk, because
// forecasting covariance is hard and forecasting returns is harder. A proposal
// that pretended otherwise would be an opinion dressed as arithmetic.
//
// Mirrors `propose_allocation` / `rebalance_trades` in modules/quant_risk.py.
// --------------------------------------------------------------------------

export type AllocationMethod = "equal_weight" | "inverse_vol" | "equal_risk" | "min_variance";

/**
 * Every method this engine solves, in the order the desk reads them: the naive
 * one first, then the three that price risk.
 *
 * Mirrors `ALLOCATION_METHODS` in modules/quant_risk.py.
 */
export const ALLOCATION_METHODS: readonly AllocationMethod[] = [
  "equal_weight",
  "inverse_vol",
  "equal_risk",
  "min_variance",
];

/**
 * Both iterative solvers run a fixed number of steps rather than testing for
 * convergence. A tolerance check lets two implementations stop on different
 * iterations and disagree by more than the cross-language fixture allows; a
 * fixed count cannot.
 */
const SOLVER_ITERATIONS = 60;

/**
 * wᵀΣw for a weight map keyed by symbol.
 *
 * Mirrors `portfolio_variance` in modules/quant_risk.py. The summation is
 * sequential in both — never a pairwise or chunked sum, which would round
 * differently from Python's left-to-right accumulation and drift past what the
 * parity fixture tolerates.
 */
export function portfolioVariance(model: CovarianceModel, weights: Map<string, number>): number {
  const size = model.symbols.length;
  const vector = model.symbols.map((s) => weights.get(s) ?? 0);
  let total = 0;
  for (let i = 0; i < size; i++) {
    let marginal = 0;
    for (let j = 0; j < size; j++) marginal += model.covariance[i][j] * vector[j];
    total += vector[i] * marginal;
  }
  return total;
}

export interface TargetWeight {
  symbol: string;
  currentWeight: number;
  targetWeight: number;
  currentNotional: number;
  targetNotional: number;
  /** Signed change as a fraction of current gross: positive means add. */
  drift: number;
  /** Which constraint held this weight below its unclipped value, if any. */
  clippedBy: string | null;
}

export interface AllocationProposal {
  method: AllocationMethod;
  targets: TargetWeight[];
  grossBefore: number;
  grossAfter: number;
  clipped: boolean;
}

export interface AllocationLimits {
  maxSymbolNotional?: number;
  maxGrossNotional?: number;
}

/**
 * Constraint-aware target weights for the current book.
 *
 * Four methods, in increasing order of what they claim to know:
 *
 * - `equal_weight` — 1/n. It knows nothing and says so, which makes it the
 *   honest baseline the other three have to beat.
 * - `inverse_vol` — each position sized by the reciprocal of its own volatility.
 *   Ignores correlation.
 * - `equal_risk` — equalises each position's *contribution* to book volatility,
 *   so two names that move together are sized as one bet.
 * - `min_variance` — the long-only, fully-invested portfolio with the smallest
 *   variance the estimated covariance allows. The most concentrated of the four
 *   by construction, so it clips against a symbol cap most often.
 *
 * None of them forecasts a return. Mirrors `propose_allocation` in
 * modules/quant_risk.py; the fixture in tests/fixtures/risk-parity.json holds
 * the two implementations to 1e-4.
 */
export function proposeAllocation(
  positions: RiskPosition[],
  model: CovarianceModel,
  method: AllocationMethod = "inverse_vol",
  limits: AllocationLimits = {},
): AllocationProposal | null {
  const index = new Map(model.symbols.map((s, i) => [s, i]));
  const live = positions.filter((p) => index.has(p.symbol) && p.signedNotional !== 0);
  if (!live.length) return null;

  const vols = new Map(live.map((p) => [p.symbol, Math.sqrt(Math.max(0, model.covariance[index.get(p.symbol)!][index.get(p.symbol)!]))]));
  if ([...vols.values()].some((v) => !(v > 0))) return null;

  // Normalised explicitly rather than by falling through an else: the returned
  // proposal names its own method, and a silent fallback would let it name one
  // thing while the caller asked for another.
  const resolved: AllocationMethod = ALLOCATION_METHODS.includes(method) ? method : "inverse_vol";

  let weights = new Map<string, number>();
  if (resolved === "equal_weight") {
    // 1/n over *distinct* symbols, not `live.length`. Both engines key weights
    // by symbol but iterate the position list when building targets, so a
    // duplicated symbol would collect the same weight twice and silently
    // inflate gross. `vols` is already keyed by symbol, so its size is the
    // distinct count.
    const count = vols.size;
    for (const symbol of vols.keys()) weights.set(symbol, 1 / count);
  } else if (resolved === "min_variance") {
    // Minimum variance, long-only and fully invested. The KKT condition for
    // `min wᵀΣw s.t. Σw = 1, w >= 0` is that every marginal variance (Σw)ᵢ is
    // equal on the support, which gives a multiplicative update in the same
    // shape as the equal-risk solver below — one solver family in this file
    // rather than two, and no simplex projection or step size to tune.
    //
    // Seeded with inverse *variance*, which is already the exact answer when
    // the correlations are zero, so the iteration only has to undo the
    // correlation.
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / (vol * vol)); total += 1 / (vol * vol); }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);

    // A multiplicative fixed point is not proven to decrease the objective on
    // every step. A method called "minimum variance" that returned something
    // more volatile than inverse-vol would be indefensible, so the best iterate
    // is kept rather than whichever one the loop happened to end on.
    let best = weights;
    let bestVariance = portfolioVariance(model, weights);

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
      const vector = model.symbols.map((s) => weights.get(s) ?? 0);
      const marginal = model.symbols.map((_, i) =>
        model.symbols.reduce((acc, _s, j) => acc + model.covariance[i][j] * vector[j], 0));
      const variance = model.symbols.reduce((acc, _s, i) => acc + vector[i] * marginal[i], 0);
      if (!(variance > 0)) break;

      const updated = new Map<string, number>();
      for (const [symbol, w] of weights) {
        const i = index.get(symbol)!;
        // A negative marginal variance is a hedge: the fixed point has no update
        // for it, and Math.sqrt of a negative would put a NaN into every weight
        // at the next renormalisation. Held flat, exactly as equal_risk holds a
        // non-positive contribution.
        updated.set(symbol, marginal[i] > 0 ? w * Math.sqrt(variance / marginal[i]) : w);
      }
      const sum = [...updated.values()].reduce((a, b) => a + b, 0) || 1;
      weights = new Map([...updated].map(([s, w]) => [s, w / sum]));

      const candidate = portfolioVariance(model, weights);
      if (candidate < bestVariance) { bestVariance = candidate; best = weights; }
    }
    weights = best;
  } else if (resolved === "equal_risk") {
    // Fixed-point iteration toward equal risk contribution. The inverse-vol
    // solution is the natural start: it is already correct when correlations
    // are zero, so the iteration only has to undo the correlation.
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / vol); total += 1 / vol; }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);

    for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration++) {
      const vector = model.symbols.map((s) => weights.get(s) ?? 0);
      const marginal = model.symbols.map((_, i) =>
        model.symbols.reduce((acc, _s, j) => acc + model.covariance[i][j] * vector[j], 0));
      const variance = model.symbols.reduce((acc, _s, i) => acc + vector[i] * marginal[i], 0);
      if (!(variance > 0)) break;

      const targetRc = variance / weights.size;
      const updated = new Map<string, number>();
      for (const [symbol, w] of weights) {
        const i = index.get(symbol)!;
        const contribution = vector[i] * marginal[i];
        updated.set(symbol, contribution > 0 && marginal[i] > 0 ? w * Math.sqrt(targetRc / contribution) : w);
      }
      const sum = [...updated.values()].reduce((a, b) => a + b, 0) || 1;
      weights = new Map([...updated].map(([s, w]) => [s, w / sum]));
    }
  } else {
    let total = 0;
    for (const [symbol, vol] of vols) { weights.set(symbol, 1 / vol); total += 1 / vol; }
    for (const [symbol, w] of weights) weights.set(symbol, w / total);
  }

  const grossBefore = live.reduce((acc, p) => acc + Math.abs(p.signedNotional), 0);
  const budget = limits.maxGrossNotional
    ? Math.min(grossBefore, limits.maxGrossNotional)
    : grossBefore;

  let clipped = false;
  const targets: TargetWeight[] = live.map((p) => {
    const currentNotional = Math.abs(p.signedNotional);
    let targetNotional = (weights.get(p.symbol) ?? 0) * budget;
    let clippedBy: string | null = null;
    if (limits.maxSymbolNotional && targetNotional > limits.maxSymbolNotional) {
      targetNotional = limits.maxSymbolNotional;
      clippedBy = "max_symbol_notional_usd";
      clipped = true;
    }
    return {
      symbol: p.symbol,
      currentWeight: grossBefore ? currentNotional / grossBefore : 0,
      targetWeight: budget ? targetNotional / budget : 0,
      currentNotional,
      targetNotional,
      drift: grossBefore ? (targetNotional - currentNotional) / grossBefore : 0,
      clippedBy,
    };
  });

  targets.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  return {
    method: resolved,
    targets,
    grossBefore,
    grossAfter: targets.reduce((acc, t) => acc + t.targetNotional, 0),
    clipped,
  };
}

export interface ManualAllocation extends AllocationProposal {
  manual: true;
  /** Symbols the reader typed a weight for. */
  pinned: string[];
  /** Σ of every target weight before clipping. One when the override balances. */
  weightSum: number;
  /** `weightSum` within 1e-6 of one. Trades are withheld when this is false. */
  balanced: boolean;
}

/**
 * A solved proposal with some of its weights replaced by hand.
 *
 * This has **no Python mirror on purpose** and is excluded from the parity
 * fixture. It is a UI affordance — a PM disagreeing with a solver on one name —
 * and there is no Telegram counterpart for it, so a second implementation would
 * be a second thing to keep in step for no reader.
 *
 * Two rules carry the design:
 *
 *  - **Pinned weights are honoured verbatim.** A number the reader typed is not
 *    rescaled to make the column add up. If it does not add up, the panel says
 *    so and withholds the trades rather than quietly trading a different book.
 *  - **The remainder is spread pro-rata to the model's weights, never equally.**
 *    The solver's ordering among the names the reader did *not* touch is
 *    information they did not override; splitting the remainder equally would
 *    silently override those rows too.
 */
export function applyManualWeights(
  proposal: AllocationProposal,
  pinned: Record<string, number>,
  limits: AllocationLimits = {},
): ManualAllocation {
  const budget = limits.maxGrossNotional
    ? Math.min(proposal.grossBefore, limits.maxGrossNotional)
    : proposal.grossBefore;

  const pinnedSymbols: string[] = [];
  const held = new Map<string, number>();
  for (const target of proposal.targets) {
    const raw = pinned[target.symbol];
    if (raw == null || !Number.isFinite(raw)) continue;
    // Long-only, matching all four solvers. Clamped rather than rejected so a
    // stray keystroke does not blank the panel.
    held.set(target.symbol, Math.max(0, Math.min(1, raw)));
    pinnedSymbols.push(target.symbol);
  }

  const pinnedSum = [...held.values()].reduce((a, b) => a + b, 0);
  const unpinned = proposal.targets.filter((t) => !held.has(t.symbol));
  const modelSum = unpinned.reduce((acc, t) => acc + t.targetWeight, 0);
  const remainder = 1 - pinnedSum;

  const weights = new Map<string, number>(held);
  for (const target of unpinned) {
    if (remainder <= 0) {
      // Over-allocated. The pinned rows already claim the whole book, so the
      // rest go to zero and the panel reports the overshoot rather than
      // rescaling a number somebody typed.
      weights.set(target.symbol, 0);
    } else if (modelSum > 0) {
      weights.set(target.symbol, (target.targetWeight / modelSum) * remainder);
    } else {
      // Every unpinned row is at zero in the model, so pro-rata has nothing to
      // divide. Equal split is the only fallback, and the panel names it.
      weights.set(target.symbol, remainder / unpinned.length);
    }
  }

  const weightSum = [...weights.values()].reduce((a, b) => a + b, 0);

  let clipped = false;
  const targets: TargetWeight[] = proposal.targets.map((target) => {
    let targetNotional = (weights.get(target.symbol) ?? 0) * budget;
    let clippedBy: string | null = null;
    // Clipped after the manual weights, not before: a reader who types 60% into
    // a name the gate caps at 40% has to see the cap here rather than discover
    // it order by order.
    if (limits.maxSymbolNotional && targetNotional > limits.maxSymbolNotional) {
      targetNotional = limits.maxSymbolNotional;
      clippedBy = "max_symbol_notional_usd";
      clipped = true;
    }
    return {
      symbol: target.symbol,
      currentWeight: target.currentWeight,
      targetWeight: budget ? targetNotional / budget : 0,
      currentNotional: target.currentNotional,
      targetNotional,
      drift: proposal.grossBefore
        ? (targetNotional - target.currentNotional) / proposal.grossBefore
        : 0,
      clippedBy,
    };
  });

  targets.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));

  return {
    manual: true,
    method: proposal.method,
    pinned: pinnedSymbols,
    targets,
    grossBefore: proposal.grossBefore,
    grossAfter: targets.reduce((acc, t) => acc + t.targetNotional, 0),
    clipped,
    weightSum,
    balanced: Math.abs(weightSum - 1) <= 1e-6,
  };
}

export interface RebalanceTrade {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  reason: string;
}

/**
 * Trades needed to reach the proposal, filtered by a drift band.
 *
 * The band is what stops a rebalance being a fee-generating machine: a position
 * 1% away from target costs more to correct than the correction is worth.
 */
export function rebalanceTrades(
  proposal: AllocationProposal,
  positions: RiskPosition[],
  driftBand = 0.05,
): RebalanceTrade[] {
  const isLong = new Map(positions.map((p) => [p.symbol, p.signedNotional >= 0]));
  return proposal.targets
    .filter((t) => Math.abs(t.drift) >= driftBand)
    .map((t) => {
      const delta = t.targetNotional - t.currentNotional;
      const long = isLong.get(t.symbol) ?? true;
      // Adding to a short means selling more of it: direction depends on which
      // side the position is already on.
      const side: "BUY" | "SELL" = long
        ? (delta > 0 ? "BUY" : "SELL")
        : (delta > 0 ? "SELL" : "BUY");
      return {
        symbol: t.symbol,
        side,
        notional: Math.abs(delta),
        reason: `${delta < 0 ? "over" : "under"}weight by ${(Math.abs(t.drift) * 100).toFixed(1)}% of gross`
          + (t.clippedBy ? ` (target clipped by ${t.clippedBy})` : ""),
      };
    });
}
