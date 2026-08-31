"use client";

import { useMemo, useState, type CSSProperties } from "react";

import {
  bookIdentityScenario,
  contractsLabel,
  mirrorBookLevels,
  percentOf,
  type IdentityShockSide,
} from "@/lib/coherence/book-instrument-model";
import {
  DOLLAR_CC,
  fromCenticents,
  signedCenticents,
  toCenticents,
} from "@/lib/coherence/fixed-point";
import type { LadderLevel } from "./LadderChart";
import { InstrumentHead } from "./BooksInstruments";
import bookStyles from "./BooksInstruments.module.css";
import styles from "./BookIdentityLab.module.css";
import { useRovingListbox } from "./use-stable-selection-key";

type TermKey = "yes" | "no" | "payout" | "spread";
type VisualStyle = CSSProperties & Record<`--${string}`, string>;
const PAYOUT_LABEL_EDGE_RATIO = 0.84;

interface IdentityTerm {
  key: TermKey;
  label: string;
  value: number | null;
  meaning: string;
}

function price(value: number | null): string {
  return fromCenticents(value) ?? "—";
}

/** Missing terms paint no segment; the dashed lane still carries the absence. */
function visualTermWidth(value: number | null): number {
  return value == null ? 0 : value;
}

function RouteLane({ label, total, first, second, ceiling, selected, onSelect }: {
  label: string;
  total: number | null;
  first: IdentityTerm;
  second: IdentityTerm;
  ceiling: number;
  selected: TermKey;
  onSelect: (key: TermKey) => void;
}) {
  const complete = first.value != null && second.value != null && total != null;
  return (
    <section className={styles.routeLane} data-complete={complete ? true : undefined}>
      <header><strong>{label}</strong><span className="num">{price(total)}</span></header>
      <div className={styles.routeTrack} aria-hidden="true" style={{ "--payout-x": percentOf(DOLLAR_CC, ceiling) } as VisualStyle}>
        <i data-term={first.key} style={{ "--term-width": percentOf(visualTermWidth(first.value), ceiling) } as VisualStyle} />
        <i data-term={second.key} style={{ "--term-width": percentOf(visualTermWidth(second.value), ceiling) } as VisualStyle} />
      </div>
      <div className={styles.routeTerms} role="group" aria-label={`${label} terms`}>
        {[first, second].map((term) => (
          <button key={term.key} type="button" data-term={term.key} aria-pressed={selected === term.key} onClick={() => onSelect(term.key)}>
            <span>{term.label}</span><strong className="num">{price(term.value)}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

function stateLabel(state: ReturnType<typeof bookIdentityScenario>["state"]): string {
  if (state === "matched") return "Identity matched";
  if (state === "above") return "Above reference";
  if (state === "below") return "Below reference";
  return "Needs both sides";
}

export interface BookIdentityLabProps {
  yesAsk: string | null;
  noAsk: string | null;
  bestYesBid?: string | null;
  bestNoBid?: string | null;
  spread: string | null;
  identitySum: string | null;
  identityOnePlusSpread: string | null;
  yesBids: LadderLevel[];
  noBids: LadderLevel[];
  unquotedReason?: string | null;
}

/** Two exact parity routes, a local quote shock, and the selected book's depth fingerprint. */
export function BookIdentityLab({
  yesAsk,
  noAsk,
  bestYesBid,
  bestNoBid,
  spread,
  identitySum,
  identityOnePlusSpread,
  yesBids,
  noBids,
  unquotedReason,
}: BookIdentityLabProps) {
  const initialSide: IdentityShockSide = toCenticents(yesAsk) != null ? "yes" : "no";
  const [shockSide, setShockSide] = useState<IdentityShockSide>(initialSide);
  const [shockPp, setShockPp] = useState(0);
  const [selectedTerm, setSelectedTerm] = useState<TermKey>(initialSide);
  const scenario = bookIdentityScenario(yesAsk, noAsk, identityOnePlusSpread, shockSide, shockPp * 100);
  const spreadCc = toCenticents(spread);
  const observedSumCc = toCenticents(identitySum);
  const referenceSpread = scenario.referenceTotal == null ? null : scenario.referenceTotal - DOLLAR_CC;
  const measuredTotals = [scenario.quoteTotal, scenario.referenceTotal]
    .filter((value): value is number => value != null);
  const ceiling = Math.max(DOLLAR_CC, ...measuredTotals);
  const payoutLabelAtEdge = DOLLAR_CC / ceiling >= PAYOUT_LABEL_EDGE_RATIO;
  const shockBase = shockSide === "yes" ? toCenticents(yesAsk) : toCenticents(noAsk);
  const minShockPp = shockBase == null ? 0 : Math.ceil(-shockBase / 100);
  const maxShockPp = shockBase == null ? 0 : Math.floor((DOLLAR_CC - shockBase) / 100);
  const depth = useMemo(() => mirrorBookLevels(yesBids, noBids).ordered, [yesBids, noBids]);
  const depthKeys = useMemo(() => depth.map((level) => level.key), [depth]);
  const [selectedLevel, setSelectedLevel, levelProps] = useRovingListbox(depthKeys, depthKeys[0]);
  const activeLevel = depth.find((level) => level.key === selectedLevel) ?? depth[0] ?? null;
  const maxSize = depth.length ? Math.max(...depth.map((level) => level.size)) : null;
  const depthCeiling = maxSize && maxSize > 0 ? maxSize : 1;

  const terms: Record<TermKey, IdentityTerm> = {
    yes: { key: "yes", label: "YES ask", value: scenario.yesAsk, meaning: bestNoBid ? `Mirrored from NO bid ${bestNoBid}` : "Waiting for a native NO bid" },
    no: { key: "no", label: "NO ask", value: scenario.noAsk, meaning: bestYesBid ? `Mirrored from YES bid ${bestYesBid}` : "Waiting for a native YES bid" },
    payout: { key: "payout", label: "$1 payout", value: DOLLAR_CC, meaning: "Certain resolution value for one YES and one NO contract" },
    spread: { key: "spread", label: "Spread", value: referenceSpread, meaning: spreadCc == null ? "Not measurable from this book" : `Gateway spread ${spread}` },
  };
  const activeTerm = terms[selectedTerm];
  const chooseTerm = (key: TermKey) => {
    setSelectedTerm(key);
    if ((key === "yes" || key === "no") && key !== shockSide) {
      setShockSide(key);
      setShockPp(0);
    }
  };
  const differenceText = scenario.difference == null ? "Not measurable" : signedCenticents(scenario.difference);
  const sourceAligned = observedSumCc != null && scenario.appliedShock === 0 && scenario.quoteTotal === observedSumCc;
  const insight = scenario.state === "incomplete"
    ? unquotedReason ?? "Both mirrored asks are required before the two routes can be compared."
    : scenario.state === "matched"
      ? "The ask pair and payout-plus-spread route land on the same exact tick."
      : `The local ask pair lands ${differenceText} ${scenario.state === "above" ? "above" : "below"} the recorded reference route.`;
  return (
    <figure className={bookStyles.instrument} aria-label="Interactive order-book parity route simulator and depth histogram">
      <InstrumentHead eyebrow="Parity route lab" title="Two routes, one executable identity" status={stateLabel(scenario.state)} />
      <div className={styles.workbench} data-state={scenario.state}>
        <section className={styles.routeMap} aria-label="Parity route comparison">
          <div className={styles.axis} aria-hidden="true">
            <span>$0</span>
            <span data-at-end={payoutLabelAtEdge ? true : undefined} style={{ "--payout-x": percentOf(DOLLAR_CC, ceiling) } as VisualStyle}>$1 payout</span>
            <span>{payoutLabelAtEdge ? null : price(ceiling)}</span>
          </div>
          <RouteLane label="Ask pair" total={scenario.quoteTotal} first={terms.yes} second={terms.no} ceiling={ceiling} selected={selectedTerm} onSelect={chooseTerm} />
          <div className={styles.routeRelation} aria-hidden="true"><span>compare exact totals</span></div>
          <RouteLane label="Payout + spread" total={scenario.referenceTotal} first={terms.payout} second={terms.spread} ceiling={ceiling} selected={selectedTerm} onSelect={chooseTerm} />
        </section>
        <section className={styles.simulator} aria-label="Local ask shock simulator">
          <header><small>Local quote simulator</small><strong>Stress one mirrored ask</strong></header>
          <div className={styles.sideChoice} role="group" aria-label="Ask to stress">
            {(["yes", "no"] as const).map((side) => (
              <button key={side} type="button" aria-pressed={shockSide === side} disabled={toCenticents(side === "yes" ? yesAsk : noAsk) == null}
                onClick={() => { setShockSide(side); setSelectedTerm(side); setShockPp(0); }}>{side.toUpperCase()} ask</button>
            ))}
          </div>
          <label className={styles.shockControl}>
            <span><small>Quote shock</small><strong className="num">{shockPp > 0 ? "+" : ""}{shockPp}pp</strong></span>
            <input type="range" min={minShockPp} max={maxShockPp} step={1} value={shockPp} disabled={shockBase == null}
              aria-label={`${shockSide.toUpperCase()} ask shock in percentage points`}
              aria-valuetext={`${shockPp} percentage points; ask pair ${price(scenario.quoteTotal)}; difference ${differenceText}`}
              onChange={(event) => setShockPp(Number(event.target.value))} />
          </label>
          <output className={styles.scenarioReadout} aria-live="polite" aria-atomic="true">
            <small>Route difference</small><strong className="num">{differenceText}</strong><span>{stateLabel(scenario.state)}</span>
          </output>
          <button type="button" className={styles.reset} disabled={shockPp === 0} onClick={() => setShockPp(0)}>Reset recorded quote</button>
        </section>
      </div>
      <section className={styles.depthPanel} aria-label="Live order-book depth fingerprint">
        <header><span><small>Live depth fingerprint</small><strong>Resting size by YES-axis price</strong></span><b className="num">Peak {maxSize == null ? "—" : contractsLabel(maxSize)}</b></header>
        {depth.length ? (
          <div className={styles.depthPlot} role="listbox" aria-label={`${depth.length} live bid levels by price and size`}>
            <span className={`${styles.depthCeiling} num`} aria-hidden="true">{contractsLabel(depthCeiling)}</span>
            {depth.map((level, index) => (
              <button key={level.key} type="button" role="option" aria-selected={selectedLevel === level.key}
                aria-label={`${level.side.toUpperCase()} bid ${price(level.nativePrice)}, ${contractsLabel(level.size)} contracts, YES-axis price ${price(level.yesPrice)}`}
                data-side={level.side} style={{ "--bar-x": percentOf(level.yesPrice, DOLLAR_CC), "--bar-height": percentOf(level.size, depthCeiling) } as VisualStyle}
                {...levelProps(level.key, index)} onClick={() => setSelectedLevel(level.key)}><span /></button>
            ))}
            <div className={styles.depthAxis} aria-hidden="true"><span>$0</span><span>YES-axis price</span><span>$1</span></div>
          </div>
        ) : <p className={styles.noDepth}>No resting level was returned for either native bid rail.</p>}
      </section>
      <output className={styles.inspector} aria-live="polite" aria-atomic="true">
        <span><small>Selected term</small><strong>{activeTerm.label}</strong><i className="num">{price(activeTerm.value)}</i></span>
        <p>{activeTerm.meaning}. {insight}</p>
        <span><small>Depth mark</small><strong>{activeLevel ? `${activeLevel.side.toUpperCase()} ${price(activeLevel.nativePrice)}` : "No level"}</strong><i>{activeLevel ? `${contractsLabel(activeLevel.size)} at level; ${contractsLabel(activeLevel.depth)} at or better` : "No size measured"}</i></span>
      </output>
      <p className={bookStyles.reading}>
        {scenario.appliedShock !== 0 ? "Scenario only; the recorded book is unchanged." : sourceAligned ? "The gateway ask sum matches the two rendered asks exactly." : "The displayed routes retain every available gateway field; an absent side remains unknown."}{" "}
        When both mirrored offers are present, buying both sides below a dollar is unreachable, not merely rare.
      </p>
    </figure>
  );
}
