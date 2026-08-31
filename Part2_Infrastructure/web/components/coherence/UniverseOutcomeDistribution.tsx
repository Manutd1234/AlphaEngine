"use client";

import type { CSSProperties } from "react";

import { toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceMarketView } from "@/lib/coherence/types";
import { pct } from "@/lib/format";
import { useRovingListbox } from "./use-stable-selection-key";

import distributionStyles from "./UniverseDistribution.module.css";
import sharedStyles from "./UniverseInstruments.module.css";

const styles = { ...sharedStyles, ...distributionStyles };
type ChartStyle = CSSProperties & { "--bar-height"?: string; "--slider-fill"?: string };
const PRICE_AXIS_TICKS = [0, 20, 40, 60, 80, 100] as const;

export default function OutcomePriceConstellation({ markets, caption }: { markets: CoherenceMarketView[]; caption: string }) {
  const members = Array.from({ length: 20 }, () => [] as CoherenceMarketView[]);
  const missingMarkets: CoherenceMarketView[] = [];
  for (const market of markets) {
    const ask = toCenticents(market.yes_ask);
    if (ask == null) missingMarkets.push(market);
    else members[Math.min(19, Math.max(0, Math.floor(ask / 500)))].push(market);
  }
  const counts = members.map((bucket) => bucket.length);
  const cellKeys = counts.map((_, index) => String(index));
  const maxCount = Math.max(1, ...counts);
  const yTicks = maxCount === 1 ? [1, 0] : [maxCount, Math.ceil(maxCount / 2), 0];
  const densestKey = String(counts.indexOf(Math.max(...counts)));
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(cellKeys, densestKey);
  const selected = Math.max(0, cellKeys.indexOf(selectedKey ?? ""));
  const count = counts[selected];
  const total = markets.length - missingMarkets.length;
  const examples = members[selected].slice(0, 3).map((market) => market.yes_sub_title || market.ticker).join(", ");
  const missingReasons = [...new Set(missingMarkets.map((market) => market.unquoted_reason).filter(Boolean))];

  if (total === 0) {
    return (
      <figure className={`${styles.instrument} ${styles.distributionPanel}`} aria-label="No quoted YES asks to distribute">
        <figcaption className={styles.head}>
          <span><small>Price distribution</small>{caption}</span>
          <strong>0/{markets.length} quoted</strong>
        </figcaption>
        <div className={styles.emptyDistribution}>
          <span aria-hidden="true">○</span>
          <strong>No executable asks to plot</strong>
          <p>Unquoted outcomes stay outside the price axis because zero is a valid price.</p>
        </div>
        <output className={styles.distributionReadout} aria-live="polite" aria-atomic="true">
          <span><small>Quoted asks</small><strong>0/{markets.length}</strong></span>
          <p>{missingReasons.join("; ") || "The exchange returned no executable YES ask."}</p>
        </output>
      </figure>
    );
  }

  return (
    <figure className={`${styles.instrument} ${styles.distributionPanel}`} aria-label="Outcome YES-ask distribution">
      <figcaption className={styles.head}>
        <span><small>Price distribution</small>{caption}</span>
        <strong>{total}/{markets.length} quoted</strong>
      </figcaption>
      <div className={styles.histogramShell}>
        <div className={styles.yGuide} aria-hidden="true">
          <span className={styles.yAxisTitle}>Y axis: Outcomes</span>
          <span className={styles.histogramYTicks}>
            {yTicks.map((tick) => <i key={tick}>{tick}</i>)}
          </span>
        </div>
        <div className={styles.histogram} role="listbox" aria-label="Inspect one of 20 five-cent price bands">
          {counts.map((value, index) => {
            const height = value === 0 ? 0 : Math.max(5, (value / maxCount) * 100);
            const style: ChartStyle = { "--bar-height": `${height}%` };
            return (
              <button type="button" role="option" aria-selected={selectedKey === cellKeys[index]}
                aria-label={`${index * 5} to ${(index + 1) * 5} cents: ${value} outcome${value === 1 ? "" : "s"}`}
                key={index} className={styles.histogramBar} data-empty={value === 0 ? "true" : undefined}
                style={style} {...optionProps(cellKeys[index], index)}
                onClick={() => setSelectedKey(cellKeys[index])}>
                <span aria-hidden="true">
                  <i />
                  {value > 0 ? <strong className="num">{value}</strong> : null}
                </span>
              </button>
            );
          })}
        </div>
        <span className={styles.histogramAxisRange} aria-hidden="true">
          {PRICE_AXIS_TICKS.map((tick) => <i key={tick}>{tick}c</i>)}
        </span>
        <label
          className={styles.histogramXAxis}
          style={{ "--slider-fill": `${(selected / 19) * 100}%` } as ChartStyle}
        >
          <span className={styles.histogramXAxisHead}>
            <b>X axis: YES ask price</b>
            <output>Selected {selected * 5}–{(selected + 1) * 5}c</output>
          </span>
          <input
            type="range"
            min={0}
            max={19}
            step={1}
            value={selected}
            aria-label="Inspect a YES-ask price band"
            aria-valuetext={`${selected * 5} to ${(selected + 1) * 5} cents`}
            onChange={(event) => setSelectedKey(event.currentTarget.value)}
          />
        </label>
      </div>
      <output className={styles.distributionReadout} aria-live="polite" aria-atomic="true">
        <span><small>Selected {selected * 5}–{(selected + 1) * 5}c</small><strong>{count} outcome{count === 1 ? "" : "s"}; {pct(count / total, 1)}</strong></span>
        <p>
          {examples ? `${examples}${members[selected].length > 3 ? `, +${members[selected].length - 3} more` : ""}.` : "No outcomes in this band."}
          {missingMarkets.length ? ` ${missingMarkets.length} unquoted.` : ""}
        </p>
      </output>
      <details className={styles.distributionMethod}>
        <summary>How executable YES offers are derived</summary>
        <p>Each YES offer is the NO ladder read from the other side; paired with its NO ask, it is never below a dollar.</p>
      </details>
    </figure>
  );
}
