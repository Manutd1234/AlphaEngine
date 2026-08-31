import { applyManualWeights } from "./allocation";
import { covariance } from "./covariance";
import { ReturnsBySymbol, RiskPosition } from "./inputs";

// --------------------------------------------------------------------------
// Stress testing
// --------------------------------------------------------------------------

export interface Shock {
  /** Symbol or `"*"` for every instrument not named explicitly. */
  symbol: string;
  /** Fractional price move, e.g. -0.2 for −20%. */
  move: number;
}

/**
 * A hand-set shock table, in percent, converted to the fractional moves
 * `applyScenario` takes. `"*"` is the broad-book baseline; named values are
 * symbol-specific overlays, so both controls remain causal on a one-name book.
 *
 * A zero survives conversion rather than being dropped. Without a broad move
 * it pins the symbol flat; with one, it states a zero symbol overlay and leaves
 * the broad move intact. Both differ from an omission, which returns ownership
 * to beta propagation when there is no broad move.
 *
 * This has no Python mirror on purpose and is excluded from the parity fixture,
 * the same as `applyManualWeights`: it is an interaction surface over
 * `applyScenario`, which is mirrored, and the Telegram companion has no sliders.
 */
export function manualShocks(
  percentBySymbol: Record<string, number>,
  positionSymbols: readonly string[],
): Shock[] {
  const valid = new Map(
    Object.entries(percentBySymbol).filter(([, move]) => Number.isFinite(move)),
  );
  const broad = valid.get("*");
  if (broad === undefined) {
    return [...valid].map(([symbol, move]) => ({ symbol, move: move / 100 }));
  }
  return [...new Set(positionSymbols)].map((symbol) => ({
    symbol,
    move: (broad + (valid.get(symbol) ?? 0)) / 100,
  }));
}

export interface ScenarioResult {
  totalPnl: number;
  /** As a fraction of equity. */
  totalReturn: number;
  /** Equity remaining after the shock. */
  projectedEquity: number;
  perPosition: {
    symbol: string;
    signedNotional: number;
    /** The move applied, after beta propagation. */
    appliedMove: number;
    /** True when the move came from a beta rather than an explicit shock. */
    viaBeta: boolean;
    beta: number | null;
    pnl: number;
  }[];
  /** True when at least one instrument's move was inferred rather than given. */
  usedBeta: boolean;
}

/**
 * Beta of `symbol` against `reference`, measured from returns.
 *
 * Returns null rather than 1.0 when it cannot be estimated. Defaulting an
 * unknown beta to 1 is the quiet way a stress test starts inventing exposure:
 * every unmeasurable instrument would move exactly with the shocked one, and the
 * resulting number looks like a measurement.
 */
export function beta(
  symbol: string,
  reference: string,
  returns: ReturnsBySymbol,
): number | null {
  const a = returns[symbol];
  const b = returns[reference];
  if (!a?.length || !b?.length) return null;
  const n = Math.min(a.length, b.length);
  if (n < 20) return null;
  const x = b.slice(-n);
  const y = a.slice(-n);
  const varX = covariance(x, x);
  if (varX <= 0) return null;
  return covariance(y, x) / varX;
}

/**
 * Apply a scenario to the book.
 *
 * An instrument with no explicit shock is moved by `beta × the reference shock`
 * — and only when a beta could actually be measured. Anything else is left flat
 * and reported as such, so the total is never inflated by exposure the data
 * cannot support.
 */
export function applyScenario(
  positions: RiskPosition[],
  equity: number,
  shocks: Shock[],
  returns: ReturnsBySymbol,
  referenceSymbol: string,
): ScenarioResult {
  const explicit = new Map(shocks.filter((s) => s.symbol !== "*").map((s) => [s.symbol, s.move]));
  const wildcard = shocks.find((s) => s.symbol === "*")?.move ?? null;
  const reference = explicit.get(referenceSymbol) ?? wildcard ?? 0;

  let usedBeta = false;
  const perPosition = positions.map((p) => {
    const direct = explicit.get(p.symbol);
    if (direct !== undefined) {
      return {
        symbol: p.symbol,
        signedNotional: p.signedNotional,
        appliedMove: direct,
        viaBeta: false,
        beta: null,
        pnl: p.signedNotional * direct,
      };
    }
    const b = reference !== 0 ? beta(p.symbol, referenceSymbol, returns) : null;
    if (b !== null) usedBeta = true;
    const move = b !== null ? b * reference : (wildcard ?? 0);
    return {
      symbol: p.symbol,
      signedNotional: p.signedNotional,
      appliedMove: move,
      viaBeta: b !== null,
      beta: b,
      pnl: p.signedNotional * move,
    };
  });

  const totalPnl = perPosition.reduce((acc, p) => acc + p.pnl, 0);
  return {
    totalPnl,
    totalReturn: equity > 0 ? totalPnl / equity : 0,
    projectedEquity: equity + totalPnl,
    perPosition,
    usedBeta,
  };
}

export interface Scenario {
  id: string;
  label: string;
  /** One line on what this is meant to represent. */
  description: string;
  shocks: Shock[];
}

/**
 * Named scenarios, each a *hypothesis* rather than a forecast.
 *
 * The magnitudes are drawn from moves these markets have actually made — the
 * May 2021 and November 2022 crypto liquidations both exceeded −20% in a day —
 * so they are plausible rather than arbitrary. They are still assumptions, and
 * the panel says so.
 */
export const SCENARIOS: Scenario[] = [
  {
    id: "crypto_cascade",
    label: "Crypto liquidation cascade",
    description: "A leveraged unwind: majors gap down together and correlation goes to one.",
    shocks: [{ symbol: "BTCUSDT", move: -0.2 }, { symbol: "*", move: -0.25 }],
  },
  {
    id: "risk_off",
    label: "Broad risk-off",
    description: "Macro shock. Everything correlated to the reference falls with it.",
    shocks: [{ symbol: "BTCUSDT", move: -0.08 }],
  },
  {
    id: "melt_up",
    label: "Melt-up",
    description: "The upside case — worth running, because a short book fails here.",
    shocks: [{ symbol: "BTCUSDT", move: 0.15 }],
  },
  {
    id: "flat",
    label: "No shock",
    description: "Baseline. Any non-zero P&L here would be a bug in the propagation.",
    shocks: [{ symbol: "*", move: 0 }],
  },
];
