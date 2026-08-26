/**
 * The corpus composition as ONE sorted array, for the figure and the table.
 *
 * `CorpusShares` sorted its rows heaviest first and drew one mark each; the
 * table beside it iterated `data.composition` in wire order. Two orders of
 * the same four series, which is fine to look at and wrong to LINK: a mark's
 * index and a row's index would name different series. So the sort lives
 * here, once, and both callers map it.
 */

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";

export interface CorpusRow {
  ticker: string;
  count: number;
  /** Share of the composition's total; null when the composition is empty. */
  share: number | null;
  /** The series' own bias slope as a number, null when none was reported or it is not finite. */
  slope: number | null;
  /** The wire's own string for that slope, null when none was reported. */
  slopeRaw: string | null;
  /** "no slope reported", or the first six characters of the wire string. */
  slopeText: string;
}

export function corpusRows(data: CoherenceCalibration): { rows: CorpusRow[]; corpus: number } {
  const corpus = data.composition.reduce((sum, row) => sum + row.count, 0);
  const slopes = new Map((data.bias_by_series ?? []).map((row) => [row.series_ticker, row.slope]));
  const rows = [...data.composition]
    .sort((a, b) => b.count - a.count)
    .map((row) => {
      const raw = slopes.get(row.series_ticker) ?? null;
      const slope = raw == null ? null : Number(raw);
      return {
        ticker: row.series_ticker,
        count: row.count,
        share: corpus > 0 ? row.count / corpus : null,
        // NOT `|| null`: a slope of exactly zero is a real reading — prices that
        // did not move with the outcome at all — and would be erased by it.
        slope: slope != null && Number.isFinite(slope) ? slope : null,
        slopeRaw: raw,
        slopeText: raw == null ? "no slope reported" : raw.slice(0, 6),
      };
    });
  return { rows, corpus };
}
