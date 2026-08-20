"use client";

/**
 * Research ▸ Attribution, as two panes rather than one four-card stack.
 *
 * The split the section's own four cards already implied: Factors and Benchmark
 * are the same question asked two ways — what explains these returns — while
 * Regimes and the tear sheet ask whether that explanation survives outside the
 * window it was measured in.
 */

import { useState } from "react";

import BenchmarkPanel from "@/components/research/BenchmarkPanel";
import FactorPanel from "@/components/research/FactorPanel";
import RegimePanel from "@/components/research/RegimePanel";
import StaleGate from "@/components/research/StaleGate";
import TearSheet from "@/components/research/TearSheet";
import type { SweepResponse } from "@/lib/types";

/** The two Attribution panes. */
type AttributionPane = "explain" | "robustness";

const ATTRIBUTION_PANES: { id: AttributionPane; label: string; hint: string }[] = [
  {
    id: "explain",
    label: "Explain",
    hint: "What the returns decompose into — this symbol's own factors, and the same question asked against another instrument",
  },
  {
    id: "robustness",
    label: "Robustness",
    hint: "Whether that decomposition holds across regimes, and what the tail and the turnover cost",
  },
];

export interface AttributionSectionProps {
  data: SweepResponse;
  researchStale: boolean;
  sweepIncoming: boolean;
  running: boolean;
  targetSymbol: string;
  targetInterval: string;
  onRerun: () => void;
}

export default function AttributionSection({
  data,
  researchStale,
  sweepIncoming,
  running,
  targetSymbol,
  targetInterval,
  onRerun,
}: AttributionSectionProps) {
  // A pane inside Attribution, not a section: it is not a deep link. A fixed
  // default, never a tier-derived one; both panes exist at every level.
  const [attributionPane, setAttributionPane] = useState<AttributionPane>("explain");

  return (
    <>
      {/* Above the gate, not inside it: `StaleGate` marks its
          content `inert`, so a switcher within it would take
          the section's other half out of reach entirely rather
          than merely showing it as stale. */}
      <div className="seg" role="group" aria-label="Attribution view">
        {ATTRIBUTION_PANES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={attributionPane === option.id}
            title={option.hint}
            onClick={() => setAttributionPane(option.id)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <StaleGate
        active={researchStale}
        mode={sweepIncoming ? "recomputing" : "stale"}
        running={running}
        targetSymbol={targetSymbol}
        targetInterval={targetInterval}
        onRerun={onRerun}
      >
        {/* Next to the factor decomposition because they are
            the same question asked two ways: what explains
            these returns. FactorPanel builds its factors from
            this symbol's own series; this one uses another
            instrument entirely. They were a screen apart under
            one heading with the regime and tail cards wedged
            between them; now the comparison is the pane. */}
        {attributionPane === "explain" && (
          <div className="compact-grid-2col">
            <FactorPanel report={data.factors} />
            <BenchmarkPanel
              comparison={data.benchmarkComparison}
              requested={data.request.benchmarkSymbol}
            />
          </div>
        )}
        {/* The other question: not what explains the returns
            but whether that explanation survives a change of
            regime, and what the tail and the turnover cost. */}
        {attributionPane === "robustness" && (
          <div className="compact-grid-2col">
            <RegimePanel regimes={data.regimes} />
            <TearSheet
              tail={data.tail}
              interval={data.request.interval}
              turnoverPerYear={data.tail.annualisedTurnover}
            />
          </div>
        )}
      </StaleGate>
    </>
  );
}
