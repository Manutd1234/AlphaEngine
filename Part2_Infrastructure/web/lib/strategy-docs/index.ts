/**
 * What each strategy is, and — the half that usually goes unwritten — when it
 * does not work.
 *
 * The picker grew from three strategies to forty-six. A
 * dropdown of forty-six names with no explanation is not more capability, it
 * is a longer list of things to try at random until one of them scores well,
 * which is precisely the search process the Deflated Sharpe Ratio exists to
 * punish. A reader who knows that Donchian breakout loses money in a range and
 * that RSI reversion loses money in a trend can rule out half the catalogue
 * before running anything.
 *
 * `formula` is the rule as implemented — matching `longState` in `lib/strategies/` and
 * `build_signals` in `backtester.py`, including the detail both engines share
 * and neither advertises: EXIT DOMINATES ENTRY on a bar where both fire.
 *
 * Parameter names are NOT repeated here. `PARAM_MEANING` already owns them and
 * the card renders from that, so a renamed axis cannot end up described one way
 * beside a slider labelled another.
 *
 * Four files since 2026-08-21, one per family group, because a 537-line literal
 * is read by scrolling rather than by looking. The exhaustiveness that a single
 * literal gave for free is kept here rather than lost: each family module is
 * `satisfies Partial<Record<Strategy, StrategyDoc>>` with its keys inferred,
 * and the annotation on `STRATEGY_DOCS` below is what fails to compile the day
 * a strategy is added to `STRATEGY_LABELS` and documented nowhere.
 */

import { BREAKOUT_DOCS } from "@/lib/strategy-docs/breakout";
import { MOMENTUM_DOCS } from "@/lib/strategy-docs/momentum";
import { REVERSION_DOCS } from "@/lib/strategy-docs/reversion";
import { TREND_DOCS } from "@/lib/strategy-docs/trend";
import type { Strategy } from "@/lib/types";
import type { StrategyDoc } from "@/lib/strategy-docs/model";

export type { StrategyDoc };

export const STRATEGY_DOCS: Record<Strategy, StrategyDoc> = {
  ...TREND_DOCS,
  ...BREAKOUT_DOCS,
  ...REVERSION_DOCS,
  ...MOMENTUM_DOCS,
};
