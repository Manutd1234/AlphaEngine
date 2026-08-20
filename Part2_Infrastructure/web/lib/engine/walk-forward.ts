/**
 * Walk-forward: choose parameters on one slice, score them on the next.
 *
 * The only part of the engine that is allowed to pick a winner, which is why
 * it lives apart from the sweep that reports one. Mirrors `walk_forward` in
 * `modules/backtester/engines.py`, embargo included.
 */

import type { Bar, SweepRequest, WalkForwardFold } from "../types";
import { runCombo } from "./combo";
import { columns, isoDay } from "./frame";
import { annualisedSharpe, barsPerYear } from "./metrics";

export function walkForward(
  bars: Bar[],
  combos: Array<[number, number]>,
  req: SweepRequest,
  adv = 0,
): { folds: WalkForwardFold[]; oosSharpe: number | null } {
  const folds = Math.max(2, Math.min(req.folds, 10));
  const seg = Math.floor(bars.length / (folds + 1));
  if (seg < 100) return { folds: [], oosSharpe: null };

  const out: WalkForwardFold[] = [];
  const oosReturns: number[] = [];
  // Taken out of the training window's tail rather than by shifting the test
  // window: shifting would walk the last fold off the end of the data and
  // quietly drop it. Mirrors `walk_forward` in the Python reference.
  const embargo = Math.max(0, Math.min(Math.trunc(req.embargoBars ?? 0), Math.max(0, seg - 50)));

  for (let i = 0; i < folds; i++) {
    const train = bars.slice(i * seg, (i + 1) * seg - embargo);
    const test = bars.slice((i + 1) * seg, (i + 2) * seg);
    if (test.length < 50 || train.length < 50) break;

    const tr = columns(train);
    let bestIs = combos[0];
    let bestSharpe = -Infinity;
    for (const [f, s] of combos) {
      const { result } = runCombo(train, tr.close, tr.high, tr.low, tr.volume, tr.pxRet, req, f, s, adv);
      if (result.sharpe > bestSharpe) {
        bestSharpe = result.sharpe;
        bestIs = [f, s];
      }
    }

    // Score the whole grid out-of-sample, not just the winner: one OOS Sharpe
    // cannot separate "this choice was right" from "this fold was easy for
    // everything". The winner's rank among its peers can.
    const te = columns(test);
    const oos = runCombo(test, te.close, te.high, te.low, te.volume, te.pxRet, req, bestIs[0], bestIs[1], adv);
    for (let k = 0; k < oos.returns.length; k++) oosReturns.push(oos.returns[k]);

    const oosSharpes = combos.map(([f, s2]) => ({
      combo: [f, s2] as [number, number],
      sharpe: runCombo(test, te.close, te.high, te.low, te.volume, te.pxRet, req, f, s2, adv).result.sharpe,
    }));
    oosSharpes.sort((a, b) => b.sharpe - a.sharpe);
    const rankIndex = oosSharpes.findIndex((e) => e.combo[0] === bestIs[0] && e.combo[1] === bestIs[1]);

    out.push({
      fold: i + 1,
      trainStart: isoDay(train[0].t),
      trainEnd: isoDay(train[train.length - 1].t),
      testStart: isoDay(test[0].t),
      testEnd: isoDay(test[test.length - 1].t),
      chosenFast: bestIs[0],
      chosenSlow: bestIs[1],
      isSharpe: bestSharpe,
      oosSharpe: oos.result.sharpe,
      oosReturn: oos.result.totalReturn,
      oosRank: rankIndex >= 0 ? rankIndex + 1 : undefined,
      combosRanked: oosSharpes.length,
      embargoBars: embargo,
    });
  }

  const agg = oosReturns.length
    ? annualisedSharpe(Float64Array.from(oosReturns), barsPerYear(req.interval))
    : null;
  return { folds: out, oosSharpe: agg };
}
