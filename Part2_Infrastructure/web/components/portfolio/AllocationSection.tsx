"use client";

/**
 * The Allocation section: what the book is, what it should be, and what it is
 * made of.
 *
 * The cleanest one-source-per-pane split in the app. Mix and Composition read
 * the positions payload alone; only Targets needs a covariance. So on a book
 * with too little shared history to build one — a new symbol, a short session —
 * a single pane goes quiet and says why, instead of a dead grey slab wedged
 * between two charts that are working perfectly well.
 *
 * Conditional renders rather than `hidden`: every chart in here carries a
 * ResizeObserver, and a switched-away pane should not keep one running behind
 * the pane on screen.
 *
 * The pane state is the first thing this component does and nothing returns
 * before it: a selector declared after an early return is the "rendered more
 * hooks than during the previous render" crash on the first snapshot that
 * arrives.
 */

import { useState } from "react";

import AllocationDonut from "@/components/portfolio/AllocationDonut";
import AllocationMixes from "@/components/portfolio/AllocationMixes";
import AllocationPanel from "@/components/portfolio/AllocationPanel";
import type { PortfolioPayload } from "@/lib/portfolio";
import type { AllocationLimits, CovarianceModel, RiskPosition } from "@/lib/portfolio-risk";

type AllocationPane = "mix" | "targets" | "composition";

/**
 * Three panes, never four: `.seg button` is `flex: 1`, so a fourth forces
 * abbreviated labels, and it is also the point at which a picker stops being a
 * split and becomes a second navigation the reader has to learn.
 */
const ALLOCATION_PANES: Array<{ id: AllocationPane; label: string; hint: string }> = [
  { id: "mix", label: "Mix", hint: "What the book is concentrated in right now, measured from notional alone" },
  { id: "targets", label: "Targets", hint: "What the book should be under a risk model, and the trades that close the gap — needs a covariance" },
  { id: "composition", label: "Composition", hint: "Asset class, settlement currency and sleeve: three cuts of one book, three different claims" },
];

export interface AllocationSectionProps {
  book: PortfolioPayload;
  /** The same book, in the shape the risk model consumes. */
  riskPositions: RiskPosition[];
  /** Null when the instruments share too little history to build one. */
  covarianceModel: CovarianceModel | null;
  allocationLimits: AllocationLimits;
}

export default function AllocationSection({
  book,
  riskPositions,
  covarianceModel,
  allocationLimits,
}: AllocationSectionProps) {
  const [allocationPane, setAllocationPane] = useState<AllocationPane>("mix");
  const positions = book.exposure.positions;
  const strategies = book.attribution.by_strategy ?? [];

  return (
    <>
      <div className="seg" role="group" aria-label="Allocation view">
        {ALLOCATION_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={allocationPane === option.id}
            title={option.hint}
            onClick={() => setAllocationPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/* What the book IS. Notional only — no covariance, so this pane draws
          on any book with an open position. */}
      {allocationPane === "mix" && (
        <AllocationDonut
          positions={positions}
          gross={book.exposure.gross}
          effectivePositions={book.concentration.effective_positions}
          largestShare={book.concentration.largest_share}
          hhi={book.concentration.hhi}
        />
      )}

      {/* What it SHOULD be. The only pane that needs a covariance, and the
          only one that goes quiet when there is not enough history for one. */}
      {allocationPane === "targets" && (
        <AllocationPanel
          positions={riskPositions}
          model={covarianceModel}
          limits={allocationLimits}
        />
      )}

      {/* Three cuts of the same book, and three DIFFERENT claims — measured,
          inferred and flow. Each says which it is rather than presenting them
          as equivalent. */}
      {allocationPane === "composition" && (
        <AllocationMixes positions={positions} attribution={strategies} generated={Boolean(book.sandbox)} />
      )}
    </>
  );
}
