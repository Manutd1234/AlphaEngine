/**
 * The VaR backtest as a calendar of breaches, one cell per bar.
 *
 * `VarBacktestChart` draws the forecast band against realised P&L over time —
 * the right figure for "was the model tight". This is the derivation for the
 * OTHER question the same series answers, and the one a model is actually
 * judged on: did breaches happen at the rate the confidence promised, and did
 * they cluster. A 95% VaR that breaches on 5% of days is working; one that
 * breaches on 5% of days all in the same week is not, and the two look
 * identical on a band chart and nothing alike on a calendar.
 *
 * A PURE MODULE, NEVER JSX — grammar rule 4. `npm test` has no DOM, so a
 * figure computed inline is a figure no suite can check; here the ratio, the
 * breach flag and the run lengths are numbers a test can assert on before any
 * SVG exists.
 *
 * NULL HONESTY. A bar whose forecast is zero has no ratio — dividing by it
 * would print Infinity as a magnitude — so the cell is withheld with that
 * reason, and a withheld cell is never counted as a breach OR as a clear day.
 */

import type { VarSeriesPoint } from "./var-validation";

export interface ExceedanceCell {
  index: number;
  /** Bar open time in ms, or null when the series' times were not aligned. */
  t: number | null;
  /** Realised loss over forecast loss: 1.0 is exactly on the forecast, above it is a breach. Null when withheld. */
  ratio: number | null;
  breach: boolean;
  /** Why `ratio` is null, when it is. */
  withheld: string | null;
}

export interface ExceedanceSummary {
  cells: ExceedanceCell[];
  /** Bars with a ratio, i.e. the denominator the breach rate is over. */
  scored: number;
  breaches: number;
  withheld: number;
  /** The longest run of consecutive breaches — clustering, which the band chart cannot show. */
  longestRun: number;
  /** Where that run starts, as an index into `cells`, or null if no breach. */
  longestRunAt: number | null;
}

/**
 * Loss over forecast, per bar. `pnl` is signed P&L; the forecast is a loss
 * magnitude; a breach is a realised loss that exceeded it. A profitable bar
 * has ratio 0 rather than a negative number, because "how far into the
 * forecast did the loss reach" has no meaning below zero and a negative cell
 * would read as a credit against the model.
 */
export function exceedanceCells(points: readonly VarSeriesPoint[]): ExceedanceSummary {
  const cells: ExceedanceCell[] = [];
  let scored = 0;
  let breaches = 0;
  let withheld = 0;
  let run = 0;
  let longestRun = 0;
  let longestRunAt: number | null = null;

  points.forEach((p, index) => {
    if (!(p.var95 > 0)) {
      withheld += 1;
      run = 0;
      cells.push({ index, t: p.t, ratio: null, breach: false, withheld: "no forecast for this bar, so there is nothing to measure the loss against" });
      return;
    }
    const loss = Math.max(0, -p.pnl);
    const ratio = loss / p.var95;
    // The series' own flag is the authority; the ratio is the magnitude. They
    // agree by construction, and if they ever did not, the flag wins because
    // it is what the Kupiec count was scored on.
    const breach = p.exception95;
    scored += 1;
    if (breach) {
      breaches += 1;
      run += 1;
      if (run > longestRun) {
        longestRun = run;
        longestRunAt = index - run + 1;
      }
    } else {
      run = 0;
    }
    cells.push({ index, t: p.t, ratio, breach, withheld: null });
  });

  return { cells, scored, breaches, withheld, longestRun, longestRunAt };
}

/**
 * What the calendar says about clustering, in one sentence, with the numbers.
 *
 * Kupiec tests unconditional coverage only — the COUNT of breaches against the
 * expected count — and says nothing about their spacing. Three breaches in one
 * week and three across a quarter score identically. This is the sentence the
 * band chart cannot write.
 */
export function clusteringReading(summary: ExceedanceSummary): string {
  if (summary.scored === 0) return "No bar carried a forecast, so nothing here is scored.";
  if (summary.breaches === 0) return `No breach in ${summary.scored} scored bars.`;
  if (summary.longestRun <= 1) {
    return `${summary.breaches} breach${summary.breaches === 1 ? "" : "es"} in ${summary.scored} bars, none consecutive — spread rather than clustered.`;
  }
  return `${summary.breaches} breaches in ${summary.scored} bars, and ${summary.longestRun} of them in a row — clustered, which the breach count alone cannot show.`;
}
