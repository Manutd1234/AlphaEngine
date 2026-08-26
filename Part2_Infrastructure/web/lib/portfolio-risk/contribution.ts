/**
 * Each position's share of the book's gross against its share of the day's P&L.
 *
 * THE DIAGONAL IS THE REFERENCE. A position whose P&L share equals its gross
 * share earned exactly its size; above the line it earned more than its size,
 * below, less. That is the one question a positions table cannot answer — the
 * table lists notional and P&L as two columns, and a reader has to divide them
 * in their head to know whether the largest position is also the one doing
 * the work. Same grammar as `EdgeScatter` on Stake, so a reader who has met
 * one has met both.
 *
 * A PURE MODULE — grammar rule 4 — because "share of P&L" is a derivation with
 * a trap in it. P&L is signed and the book's total can be near zero or
 * negative, so a share of it is not a share of a whole the way gross is. The
 * rule here: contribution is the position's P&L over the book's TOTAL
 * ABSOLUTE P&L, so every share is in [-1, 1], sums to the book's sign, and a
 * position that lost while the book gained is drawn below zero rather than
 * as a negative fraction of a positive number nobody can read.
 *
 * NULL HONESTY. A book with zero gross has no shares; a book whose positions
 * all report zero P&L has nothing to attribute. Both are withheld with the
 * reason, never drawn at the origin as if every position had earned its size.
 */

export interface ContributionInput {
  symbol: string;
  share_of_gross: number;
  realized_pnl: number;
  unrealized_pnl: number;
}

export interface ContributionPoint {
  symbol: string;
  /** Share of gross notional, in [0, 1]. */
  weight: number;
  /** This position's P&L over the book's total absolute P&L, in [-1, 1]. */
  contribution: number;
  pnl: number;
  /** Above the diagonal: earned more than its size. Below: less. Null when on it within tolerance. */
  earnedMoreThanSize: boolean | null;
}

export interface ContributionSummary {
  points: ContributionPoint[];
  /** Why there are no points, when there are none. */
  withheld: string | null;
  /** The position furthest above the line, and furthest below — the two a reader wants named. */
  best: ContributionPoint | null;
  worst: ContributionPoint | null;
  totalAbsPnl: number;
}

const ON_THE_LINE = 0.02;

export function contributionPoints(positions: readonly ContributionInput[]): ContributionSummary {
  if (!positions.length) {
    return { points: [], withheld: "no positions in the book", best: null, worst: null, totalAbsPnl: 0 };
  }
  const pnls = positions.map((p) => p.realized_pnl + p.unrealized_pnl);
  const totalAbs = pnls.reduce((sum, v) => sum + Math.abs(v), 0);
  if (!(totalAbs > 0)) {
    return { points: [], withheld: "every position reports zero P&L, so there is nothing to attribute", best: null, worst: null, totalAbsPnl: 0 };
  }
  if (!positions.some((p) => p.share_of_gross > 0)) {
    return { points: [], withheld: "the book has no gross notional, so no position has a size to earn against", best: null, worst: null, totalAbsPnl: totalAbs };
  }

  const points: ContributionPoint[] = positions.map((p, i) => {
    const contribution = pnls[i] / totalAbs;
    const gap = contribution - p.share_of_gross;
    return {
      symbol: p.symbol,
      weight: p.share_of_gross,
      contribution,
      pnl: pnls[i],
      earnedMoreThanSize: Math.abs(gap) <= ON_THE_LINE ? null : gap > 0,
    };
  });

  const byGap = [...points].sort((a, b) => (b.contribution - b.weight) - (a.contribution - a.weight));
  return {
    points,
    withheld: null,
    best: byGap[0] ?? null,
    worst: byGap[byGap.length - 1] ?? null,
    totalAbsPnl: totalAbs,
  };
}

/** One sentence: which position is doing the work, and which is not. */
export function contributionReading(summary: ContributionSummary): string {
  if (summary.withheld) return `Withheld: ${summary.withheld}.`;
  const { best, worst } = summary;
  if (!best || !worst || best === worst) {
    return "One position, so it earned exactly its size by definition.";
  }
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  return `${best.symbol} is ${pct(best.weight)} of gross and ${pct(best.contribution)} of the P&L; `
    + `${worst.symbol} is ${pct(worst.weight)} of gross and ${pct(worst.contribution)} of the P&L.`;
}
