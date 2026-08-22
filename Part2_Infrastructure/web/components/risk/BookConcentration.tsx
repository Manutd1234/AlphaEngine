"use client";

/**
 * The book's two concentration figures, counting.
 *
 * WHY THEY COUNT RATHER THAN CUT
 * ------------------------------------------------------------------------
 * The Risk tab was reported as showing "no live feed for any" panel while its
 * own chrome read "Live book — Authoritative risk gateway live; last refresh
 * 14:32:53, live-pushed". Both statements were true. `useBook` memoises the
 * view on the payload, `RiskWorkspace` is memoised on that identity, and every
 * figure here therefore re-renders on the poll — but it re-rendered as an
 * instant substitution, indistinguishable from a value that had not changed.
 * Every other book-fed tab already counts its live figures through
 * `NumberTicker` (Portfolio's overview and performance sections, Execution's
 * P&L strip, the Overview KPI deck); Risk was the one tab that wired none, so
 * it was the one tab that looked disconnected.
 *
 * These two are the right pair to count on the limits subtab: both are
 * measured directly from the polled book, neither is nullable — the payload's
 * `concentration` block is always present, so nothing is being coerced on the
 * way into a ticker — and both move whenever a position does. The utilisation
 * cells in the table above are deliberately left alone: nine numbers counting
 * at once is a slot machine, not an instrument.
 *
 * Split into its own file rather than inlined because `RiskWorkspace.tsx` sits
 * two lines under the 400-line ceiling. The `<details>` that derives effective
 * positions stays there: `summarised-risk.test.ts` and `copy-audit.test.ts`
 * both read that prose at that path, and prose that moves out from under its
 * own guard is prose that stops being guarded.
 */

import NumberTicker from "@/components/common/NumberTicker";
import { fmt } from "@/lib/format";

export default function BookConcentration({
  largestShare,
  effectivePositions,
}: {
  /** Fraction, 0–1, as the payload carries it. */
  largestShare: number;
  effectivePositions: number;
}) {
  return (
    <div className="portfolio-concentration">
      <div>
        <span>Largest share</span>
        <strong className="num">
          <NumberTicker value={largestShare * 100} format={(value) => `${fmt(value, 1)}%`} />
        </strong>
      </div>
      <div>
        <span>Effective positions</span>
        <strong className="num">
          <NumberTicker value={effectivePositions} format={(value) => fmt(value, 1)} />
        </strong>
      </div>
    </div>
  );
}
