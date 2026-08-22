"use client";

/**
 * The forward horizon both loss estimates answer over.
 *
 * Rendered by RiskWorkspace above the card on the montecarlo subtab and again
 * above the card on the oraclevar subtab, over one piece of state, so the two
 * estimates can never be read against each other on two different clocks. The
 * state stays in the workspace; only the markup lives here.
 *
 * It is the one control on this tab that sits ABOVE a card rather than in the
 * card's heading beside the title, which is where the other seven tabs and
 * every other Risk panel put the controls that act on a panel. That placement
 * is what the shared horizon costs, so the control carries a visible name to
 * pay for it: a bare row reading "1d 10d 30d 90d" floating above a Monte Carlo
 * card could as easily be the bar interval it resamples or a lookback window.
 * The name is on screen rather than only in the group's aria-label, because a
 * sighted reader has no way to reach the aria-label at all.
 */

/** The montecarlo and oraclevar sections' shared forward horizon, in days.
 *  1 day is here for the GBM panel's original range; the bootstrap converts
 *  it to ≥1 bar. */
export const MC_HORIZON_CHOICES = [1, 10, 30, 90] as const;

export interface HorizonSegProps {
  /**
   * Distinct per call site, and set by the caller for that reason: two
   * controls announcing identically would read to a screen reader as one
   * control rendered twice.
   */
  ariaLabel: string;
  days: number;
  onDays: (days: number) => void;
}

export default function HorizonSeg({ ariaLabel, days, onDays }: HorizonSegProps) {
  return (
    <div className="risk-horizon">
      <span>Forward horizon</span>
      <div className="seg research-seg" role="group" aria-label={ariaLabel}>
        {MC_HORIZON_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            aria-pressed={days === choice}
            title={`Run both estimates over a ${choice}-day forward horizon`}
            onClick={() => onDays(choice)}
          >
            {choice}d
          </button>
        ))}
      </div>
    </div>
  );
}
