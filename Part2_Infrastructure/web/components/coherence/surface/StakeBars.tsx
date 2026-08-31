"use client";

import { useMemo, useState, type CSSProperties } from "react";

import { decimalLabel } from "@/lib/coherence/decimals";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import { fmt } from "@/lib/format";
import { useRovingListbox } from "../use-stable-selection-key";
import baseStyles from "../MarketStructures.module.css";
import stakeStyles from "../StakeInstrument.module.css";
import KellyGrowthSimulator from "./KellyGrowthSimulator";

const styles = { ...baseStyles, ...stakeStyles };

type OutcomeStyle = CSSProperties & {
  "--outcome-x": string;
  "--outcome-size": string;
  "--reserve-x": string;
};

/** A wire decimal converted only for derived geometry and sensitivity replay. */
export function toRatio(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function shockedPrice(raw: number, percent: number): number {
  return Math.max(0.0001, Math.min(0.9999, raw * (1 + percent / 100)));
}

/**
 * The returned admission decision as a threshold plot. Moving the quote shock
 * keeps the server's cash-reserve rate fixed and exposes where each q/price
 * point would cross it; it does not pretend to rerun the joint solver.
 */
export default function StakeBars({
  stakes,
  caption,
  reserveRate = null,
  hot = null,
  onHot,
}: {
  stakes: CoherenceKelly["stakes"];
  caption: string;
  reserveRate?: string | null;
  hot?: number | null;
  onHot?: (index: number | null) => void;
}) {
  const stakeKeys = stakes.map((stake) => stake.ticker);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(stakeKeys);
  const [shock, setShock] = useState(0);
  const reserve = toRatio(reserveRate);

  const points = useMemo(() => stakes.map((stake) => {
    const probability = toRatio(stake.probability);
    const price = toRatio(stake.price);
    const shiftedPrice = price == null ? null : shockedPrice(price, shock);
    const ratio = probability == null || shiftedPrice == null ? null : probability / shiftedPrice;
    const simulatedFull = probability == null || shiftedPrice == null || reserve == null
      ? null
      : Math.max(0, probability - reserve * shiftedPrice);
    return { shiftedPrice, ratio, simulatedFull };
  }), [reserve, shock, stakes]);

  if (!stakes.length) {
    return (
      <figure className={styles.instrument} aria-label="No outcome to draw">
        <figcaption className={styles.head}><span>{caption}</span><strong>empty</strong></figcaption>
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span>
          <span>The solver ranked no outcome.</span>
        </p>
      </figure>
    );
  }

  const selected = Math.max(0, stakeKeys.indexOf(selectedKey ?? ""));
  const resolved = hot ?? selected;
  const active = stakes[resolved] ?? stakes[0];
  const activePoint = points[resolved] ?? points[0];
  const ratios = points.flatMap((point) => point.ratio == null ? [] : [point.ratio]);
  const domainMax = Math.max(1, reserve ?? 0, ...ratios) * 1.12;
  const reserveX = reserve == null ? 0 : Math.min(100, (reserve / domainMax) * 100);
  const reserveEdge = reserveX <= 12 ? "start" : reserveX >= 88 ? "end" : "middle";
  const simulatedAdmitted = activePoint.ratio == null || reserve == null ? null : activePoint.ratio > reserve;
  const returned = stakes.filter((stake) => stake.admitted).length;
  const ariaLabel = `Outcome admission against the returned cash rate: ${stakes.length} outcomes, ${returned} returned.`;
  const reserveLabel = reserve == null
    ? "Cash-rate threshold not returned."
    : `Cash-rate threshold ${fmt(reserve, 4)} on the measure-over-price axis.`;

  return (
    <figure className={styles.instrument} aria-label={ariaLabel}>
      <figcaption className={styles.head}>
        <span><small>Admission field</small>{caption}</span>
        <strong>{returned}/{stakes.length} returned</strong>
      </figcaption>

      <div className={styles.admissionControl}>
        <span><small>Quote shock</small><strong>Move every price; hold the returned cash rate</strong></span>
        <label>
          <span>Price shift</span>
          <input type="range" min={-20} max={20} step={1} value={shock}
                 onChange={(event) => setShock(Number(event.target.value))} />
        </label>
        <output className="num">{shock > 0 ? "+" : ""}{shock}%</output>
      </div>

      <div className={styles.admissionAxis} role="img" aria-label={reserveLabel} data-reserve-edge={reserveEdge}
           style={{ "--reserve-x": `${reserveX}%` } as CSSProperties}>
        <span>lower q / price</span><i /><b>{reserve == null ? "cash rate withheld" : `cash rate ${fmt(reserve, 4)}`}</b><span>higher q / price</span>
      </div>

      <div className={styles.outcomeField} role="listbox" aria-label="Inspect outcome admission against the cash rate">
        {stakes.map((stake, index) => {
          const point = points[index];
          const x = point.ratio == null ? 0 : Math.min(100, (point.ratio / domainMax) * 100);
          const fraction = Math.max(0, point.simulatedFull ?? toRatio(stake.fraction) ?? 0);
          const size = 12 + Math.min(12, Math.sqrt(fraction) * 32);
          const props = optionProps(stake.ticker, index);
          const crosses = point.ratio != null && reserve != null ? point.ratio > reserve : null;
          return (
            <button
              type="button"
              role="option"
              aria-selected={selectedKey === stake.ticker}
              key={stake.ticker}
              className={`${styles.outcomeToken}${resolved === index ? " is-hot" : ""}`}
              data-admitted={crosses ?? stake.admitted}
              style={{ "--outcome-x": `${x}%`, "--outcome-size": `${size}px`, "--reserve-x": `${reserveX}%` } as OutcomeStyle}
              {...props}
              onFocus={() => { props.onFocus(); onHot?.(index); }}
              onPointerEnter={() => onHot?.(index)}
              onPointerLeave={() => onHot?.(null)}
              onBlur={() => onHot?.(null)}
              onClick={() => setSelectedKey(stake.ticker)}
            >
              <span className={styles.outcomeName}>
                <small>{crosses == null
                  ? stake.admitted ? "● returned" : "○ passed"
                  : crosses ? "● clears held R" : "○ at/below held R"}</small>
                <strong>{stake.label}</strong>
              </span>
              <span className={styles.outcomeTrack} aria-hidden="true"><i /><b /></span>
              <span className={styles.outcomeRatio}><small>q / price</small><strong className="num">{point.ratio == null ? "—" : fmt(point.ratio, 4)}</strong></span>
            </button>
          );
        })}
      </div>

      <output className={styles.familyReadout} aria-live="polite" aria-atomic="true">
        <span><small>Selected</small><strong>{active.label}</strong><span className={styles.familyDetail}>{simulatedAdmitted == null ? "No simulated crossing can be stated." : simulatedAdmitted ? "Above the held cash rate." : "At or below the held cash rate."}</span></span>
        <span><small>Measure</small><strong className="num">{decimalLabel(active.probability, 4)}</strong></span>
        <span><small>Shifted price</small><strong className="num">{activePoint.shiftedPrice == null ? "—" : fmt(activePoint.shiftedPrice, 4)}</strong></span>
        <span><small>q / price</small><strong className="num">{activePoint.ratio == null ? "—" : fmt(activePoint.ratio, 4)}</strong></span>
        <span><small>Full stake at held R</small><strong className="num">{activePoint.simulatedFull == null ? "—" : fmt(activePoint.simulatedFull, 4)}</strong></span>
      </output>
    </figure>
  );
}

/** The Method view's equation-backed growth and terminal-wealth frontier. */
export function GrowthBars({ kelly }: { kelly: CoherenceKelly }) {
  return <KellyGrowthSimulator kelly={kelly} eyebrow="Decision chamber" />;
}
