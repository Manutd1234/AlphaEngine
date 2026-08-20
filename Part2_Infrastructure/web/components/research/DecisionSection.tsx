"use client";

/**
 * Research ▸ Decision: is this candidate good enough to leave the lab.
 *
 * The score ranks and the gate vetoes, so the score is ABOVE the gate rather
 * than beside it — side by side they read as two rival verdicts on one run.
 *
 * This is also the research/execution boundary. Nothing here submits, prices
 * or routes anything: the hand-off stages the sleeve Execution will carry and
 * opens the ticket, and `tests/promotion-boundary.test.ts` reads this callback
 * statement by statement to keep it that way.
 */

import PromotionPanel from "@/components/research/PromotionPanel";
import QualityScorePanel from "@/components/research/QualityScorePanel";
import SizingPanel from "@/components/research/SizingPanel";
import StaleGate from "@/components/research/StaleGate";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import { REFERENCE_EQUITY } from "@/lib/portfolio";
import { STRATEGY_LABELS, type ParamResult, type Strategy, type SweepResponse } from "@/lib/types";

export interface DecisionSectionProps {
  data: SweepResponse;
  researchStale: boolean;
  sweepIncoming: boolean;
  running: boolean;
  researchDirty: boolean;
  inspect: ParamResult | null;
  targetSymbol: string;
  targetInterval: string;
  onRerun: () => void;
  /** Promotion stages the sleeve Execution will carry. Research never sends it. */
  onStageSleeve: (strategy: Strategy) => void;
  /** The shell's section-aware cross-link, so the hand-off names the ticket. */
  onOpenSection: (view: WorkspaceView, section?: string) => void;
}

export default function DecisionSection({
  data,
  researchStale,
  sweepIncoming,
  running,
  researchDirty,
  inspect,
  targetSymbol,
  targetInterval,
  onRerun,
  onStageSleeve,
  onOpenSection,
}: DecisionSectionProps) {
  return (
    <StaleGate
      active={researchStale}
      mode={sweepIncoming ? "recomputing" : "stale"}
      running={running}
      targetSymbol={targetSymbol}
      targetInterval={targetInterval}
      onRerun={onRerun}
    >
      {/* Above the gate, not beside it. The score ranks and
          the gate vetoes; side by side they read as two
          rival verdicts on the same run. */}
      <QualityScorePanel data={data} />
      <div className="compact-grid-2col">
        <PromotionPanel
          gate={data.promotion}
          symbol={data.request.symbol}
          fast={data.best.fast}
          slow={data.best.slow}
          dataHash={data.dataHash ?? null}
          strategyLabel={STRATEGY_LABELS[data.request.strategy]}
          slippageBps={data.request.slippageBps}
          blocked={researchDirty || running || Boolean(inspect)}
          blockedReason={researchDirty
            ? "Refresh this candidate for the current desk context before promotion."
            : inspect
              ? "Return to the full parameter sweep before promotion."
              : "Wait for the active research run to finish."}
          /* The sleeve is staged, so the reader is one step
             from sending it: land on the ticket that carries
             it. A bare tab switch handed a promoted candidate
             to whichever execution section was last read — the
             routing table or the blotter — which is the one
             handoff on the desk where the next action is
             unambiguous. */
          onHandOff={() => {
            onStageSleeve(data.request.strategy);
            onOpenSection("live", "trade");
          }}
        />
        <SizingPanel
          best={data.best}
          gate={data.promotion}
          equity={REFERENCE_EQUITY}
        />
      </div>
      {/* The "trace market data" handoff that stood here as an
          inline card now rides the NextStepFooter's measured
          continuation for research/decision — one exit per
          section, not a card stack of three navigation
          furnishings pointing three ways at once. */}
    </StaleGate>
  );
}
