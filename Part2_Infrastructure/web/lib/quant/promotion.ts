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
// Promotion gate
// --------------------------------------------------------------------------

/**
 * The gates a candidate must clear before it may be handed to execution.
 *
 * Every one is a *veto*, and they are shown whether they pass or fail. A gate
 * panel that only appears on success teaches people that the absence of a
 * warning means safety; showing the full vector every time makes the one red row
 * the thing you read.
 */
export function promotionGate(input: {
  deflatedSharpe: number;
  walkForwardOosSharpe: number | null;
  medianEfficiency: number | null;
  stability: CellKind | null;
  alphaTStat: number | null;
  maxDrawdown: number;
  trades: number;
}): PromotionGate {
  const checks: PromotionCheck[] = [
    {
      id: "dsr",
      label: "Deflated Sharpe",
      value: input.deflatedSharpe.toFixed(3),
      hurdle: "≥ 0.95",
      passed: input.deflatedSharpe >= 0.95,
      why: "Prices the search itself: the probability the edge is real after paying for how many combinations were tried.",
    },
    {
      id: "oos",
      label: "Walk-forward OOS Sharpe",
      value: input.walkForwardOosSharpe === null ? "—" : input.walkForwardOosSharpe.toFixed(2),
      hurdle: "> 0",
      passed: (input.walkForwardOosSharpe ?? -1) > 0,
      why: "Measured on data the parameters never saw. In-sample results are a fit; this is a test.",
    },
    {
      id: "wfe",
      label: "Walk-forward efficiency",
      value: input.medianEfficiency === null ? "—" : input.medianEfficiency.toFixed(2),
      hurdle: "≥ 0.5",
      passed: (input.medianEfficiency ?? -1) >= 0.5,
      why: "How much of the in-sample edge survives out-of-sample. Below half means the backtest is mostly fitting.",
    },
    {
      id: "stability",
      label: "Parameter neighbourhood",
      value: input.stability ?? "—",
      hurdle: "plateau or slope",
      passed: input.stability === "plateau" || input.stability === "slope",
      why: "A real edge degrades smoothly as parameters move. An isolated spike is a coordinate found in noise.",
    },
    {
      id: "alpha",
      label: "Alpha t-statistic",
      value: input.alphaTStat === null ? "—" : input.alphaTStat.toFixed(2),
      hurdle: "|t| ≥ 2",
      passed: Math.abs(input.alphaTStat ?? 0) >= 2,
      why: "Return not explained by market, trend or volatility exposure — otherwise it is a factor bet in disguise.",
    },
    {
      id: "sample",
      label: "Trade count",
      value: String(input.trades),
      hurdle: "≥ 30",
      passed: input.trades >= 30,
      why: "Below about thirty trades the Sharpe is dominated by a handful of outcomes and its confidence interval spans zero.",
    },
  ];

  const passed = checks.filter((c) => c.passed).length;
  return { checks, passed, total: checks.length, eligible: passed === checks.length };
}
