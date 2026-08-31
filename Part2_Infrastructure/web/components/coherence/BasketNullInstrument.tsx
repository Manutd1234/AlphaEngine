"use client";

import { useId, useState, type CSSProperties } from "react";

import { money } from "@/lib/coherence/strike-axis";
import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { fmt } from "@/lib/format";

import Figure from "./Figure";
import type { CoverageState } from "./StateCoverage";
import styles from "./BasketInstruments.module.css";

type LifecycleState = "returned" | "withheld";

interface LifecycleStage {
  label: string;
  value: string;
  centre: string;
  detail: string;
  state: LifecycleState;
}

type ProgressStyle = CSSProperties & { "--dependency-progress": string };
type RailStyle = CSSProperties & { "--dependency-stage-count": number };

const EMPTY_STATES: CoverageState[] = [];

function stagesFor(
  variant: "basket" | "size",
  certificate: CoherenceCertificate,
  states: CoverageState[],
  exact: boolean,
  event: CoherenceEventView | null,
): LifecycleStage[] {
  const legCount = certificate.legs.length;
  if (variant === "basket") {
    const margin = certificate.margin == null ? "not reported by this engine" : certificate.margin;
    return [
      {
        label: "Certificate",
        value: `|L| = ${legCount} returned`,
        centre: `${legCount} ${legCount === 1 ? "leg" : "legs"}`,
        detail: `The programme completed with margin ${margin}. The returned leg count is the solver's factual result, not a loading state.`,
        state: "returned",
      },
      {
        label: "Settlement scan",
        value: exact ? `${states.length} exact state${states.length === 1 ? "" : "s"}; no legs` : "exact state space unavailable",
        centre: exact ? `${states.length} ${states.length === 1 ? "state" : "states"}` : "states —",
        detail: exact
          ? "The family has an exact one-outcome-at-a-time state space, but no returned portfolio touches any state."
          : "The venue does not mark this family mutually exclusive, so the interface does not invent a payoff matrix.",
        state: "withheld",
      },
      {
        label: "Basket payoff",
        value: "withheld",
        centre: "payoff —",
        detail: "No basket exists to evaluate. Its payoff is deliberately withheld: undefined is not a zero-dollar result.",
        state: "withheld",
      },
    ];
  }

  const markets = event?.markets ?? [];
  const reportedOpenInterest = markets.filter((market) => market.open_interest !== null).length;
  const reportedVolume = markets.filter((market) => market.volume !== null).length;
  const reportedLiquidity = markets.filter((market) => market.liquidity !== null).length;
  const comparable = certificate.legs.flatMap((leg) => {
    const market = markets.find((candidate) => candidate.ticker === leg.ticker);
    const requirement = money(leg.size);
    const openInterest = money(market?.open_interest ?? null);
    return market && requirement !== null && requirement > 0 && openInterest !== null
      ? [{ requirement, openInterest }]
      : [];
  });
  const capacityFloor = comparable.length
    ? Math.min(...comparable.map(({ requirement, openInterest }) => openInterest / requirement))
    : null;
  const marketState: LifecycleState = event === null ? "withheld" : "returned";
  const joinedState: LifecycleState = comparable.length ? "returned" : "withheld";

  return [
    {
      label: "Family activity",
      value: event === null
        ? "family read unavailable"
        : `${markets.length} outcomes; OI ${reportedOpenInterest}/${markets.length}`,
      centre: event === null ? "family —" : `${markets.length} outcomes`,
      detail: event === null
        ? "The selected family's activity payload is not available, so no market field is inferred."
        : `${reportedOpenInterest} outcomes report open interest, ${reportedVolume} report volume, and ${reportedLiquidity} report resting liquidity.`,
      state: marketState,
    },
    {
      label: "Certificate legs",
      value: `${legCount} ${legCount === 1 ? "leg" : "legs"} returned`,
      centre: `${legCount} ${legCount === 1 ? "leg" : "legs"}`,
      detail: legCount
        ? "Each returned requirement must join its market by ticker before any capacity context can be read."
        : "The programme completed and returned no portfolio legs, so the capacity path stops at this gate.",
      state: "returned",
    },
    {
      label: "Comparable legs",
      value: comparable.length
        ? `${comparable.length} of ${legCount} joined`
        : "withheld — no requirement to join",
      centre: comparable.length ? `${comparable.length}/${legCount} joined` : "join —",
      detail: comparable.length
        ? `${comparable.length} returned legs have both a positive solver requirement and reported open interest.`
        : "Market activity is still visible, but no returned certificate requirement exists to compare with it.",
      state: joinedState,
    },
    {
      label: "Capacity context",
      value: capacityFloor === null ? "withheld" : `${fmt(capacityFloor, 2)}× OI floor`,
      centre: capacityFloor === null ? "context —" : `${fmt(capacityFloor, 2)}×`,
      detail: capacityFloor === null
        ? "Without a comparable leg requirement, the basket's open-interest multiple is undefined rather than zero."
        : `The narrowest reported open-interest multiple across comparable legs is ${fmt(capacityFloor, 2)}×. Open interest is context, not executable depth.`,
      state: capacityFloor === null ? "withheld" : "returned",
    },
  ];
}

/** An inspectable dependency circuit for the ordinary coherent zero-leg result. */
export default function BasketNullInstrument({
  variant,
  certificate,
  states = EMPTY_STATES,
  exact = false,
  event = null,
}: {
  variant: "basket" | "size";
  certificate: CoherenceCertificate;
  states?: CoverageState[];
  exact?: boolean;
  event?: CoherenceEventView | null;
}) {
  const stages = stagesFor(variant, certificate, states, exact, event);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const circuitId = useId();
  const selected = Math.min(selectedIndex, stages.length - 1);
  const stage = stages[selected];
  const caption = variant === "basket"
    ? "Why a zero-leg certificate has no basket payoff"
    : "Certificate-to-activity capacity gate";
  const visibleStates = states.slice(0, 8);
  const hiddenStates = Math.max(0, states.length - visibleStates.length);
  const progress = ((selected + 1) / stages.length) * 100;

  const selectAndFocus = (next: number, current: HTMLButtonElement) => {
    setSelectedIndex(next);
    current
      .closest<HTMLOListElement>('[role="tablist"]')
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]
      ?.focus({ preventScroll: true });
  };

  return (
    <div className={styles.nullInstrument} data-basket-null-instrument={variant}>
      <Figure
        caption={caption}
        ariaLabel={stages.map((item) => `${item.label}: ${item.value}. ${item.detail}`).join(" ")}
        reading={
          variant === "basket"
            ? "The solver returned a factual zero-leg answer; downstream payoff values are intentionally withheld."
            : event
              ? `${certificate.legs.length} returned legs meet ${event.markets.length} live outcome records at the capacity gate; without a requirement, downstream ratios stay withheld.`
              : `${certificate.legs.length} returned legs reach the capacity gate, but the selected family's activity read is unavailable.`
        }
        missing="Withheld is a dependency decision. Missing transport data would be labelled missing, not shown on this circuit."
        readout={(
          <span className="num">
            {variant === "basket"
              ? `${certificate.legs.length} legs, ${states.length} states`
              : event
                ? `${certificate.legs.length} legs, ${event.markets.length} outcomes`
                : `${certificate.legs.length} legs, family withheld`}
          </span>
        )}
        reserveInteractionRow={false}
      >
        <div className={styles.dependencyInstrument} data-variant={variant}>
          <ol
            className={styles.dependencyRail}
            role="tablist"
            aria-label={caption}
            style={{ "--dependency-stage-count": stages.length } as RailStyle}
          >
            {stages.map((item, index) => (
              <li
                role="presentation"
                data-state={item.state}
                data-active={selected === index ? "true" : "false"}
                key={item.label}
              >
                <button
                  type="button"
                  role="tab"
                  id={`${circuitId}-stage-${index}`}
                  className={styles.dependencyButton}
                  aria-label={`Inspect ${item.label}: ${item.value}`}
                  aria-selected={selected === index}
                  aria-current={selected === index ? "step" : undefined}
                  aria-controls={`${circuitId}-detail`}
                  tabIndex={selected === index ? 0 : -1}
                  onPointerEnter={() => setSelectedIndex(index)}
                  onFocus={() => setSelectedIndex(index)}
                  onClick={(event) => {
                    setSelectedIndex(index);
                    event.currentTarget.focus({ preventScroll: true });
                  }}
                  onKeyDown={(event) => {
                    const moves: Record<string, number> = {
                      ArrowRight: Math.min(stages.length - 1, index + 1),
                      ArrowDown: Math.min(stages.length - 1, index + 1),
                      ArrowLeft: Math.max(0, index - 1),
                      ArrowUp: Math.max(0, index - 1),
                      Home: 0,
                      End: stages.length - 1,
                    };
                    if (!(event.key in moves)) return;
                    event.preventDefault();
                    selectAndFocus(moves[event.key], event.currentTarget);
                  }}
                >
                  <span className={styles.dependencyNode} aria-hidden="true">{index + 1}</span>
                  <span className={styles.dependencyLabel}>
                    <strong>{item.label}</strong>
                    <small>{item.state === "returned" ? "Returned" : "Withheld"}</small>
                  </span>
                  <span className={styles.dependencyValue}>{item.value}</span>
                </button>
              </li>
            ))}
          </ol>

          <div className={styles.dependencyCanvas} data-state={stage.state}>
            <div
              className={styles.dependencyGauge}
              style={{ "--dependency-progress": `${progress}%` } as ProgressStyle}
              aria-hidden="true"
            >
              <span>{`0${selected + 1} / 0${stages.length}`}</span>
              <strong>{stage.centre}</strong>
            </div>

            <section
              id={`${circuitId}-detail`}
              role="tabpanel"
              aria-labelledby={`${circuitId}-stage-${selected}`}
              className={styles.dependencyInspector}
              data-selected-detail=""
              aria-live="polite"
              aria-atomic="true"
              tabIndex={0}
            >
              <span className={styles.dependencyState} data-state={stage.state}>
                {stage.state === "returned" ? "Returned result" : "Withheld by dependency"}
              </span>
              <h3>{stage.label}</h3>
              <strong className="num">{stage.value}</strong>
              <p>{stage.detail}</p>
              <small>Hover, focus, or use arrow keys to inspect the circuit.</small>
            </section>
          </div>

          {variant === "basket" ? (
            <div className={styles.settlementStrip} aria-label="Settlement states carried by the selected family">
              <span className={styles.settlementStripLabel}>Settlement field</span>
              {visibleStates.length ? visibleStates.map((state, index) => (
                <span className={styles.settlementState} key={state.ticker} title={state.ticker}>
                  <b className="num">{String(index + 1).padStart(2, "0")}</b> {state.label}
                </span>
              )) : (
                <span className={styles.settlementState}>No exact state space was supplied</span>
              )}
              {hiddenStates ? <span className={styles.settlementState}>+{hiddenStates} more</span> : null}
            </div>
          ) : null}
        </div>
      </Figure>
    </div>
  );
}
