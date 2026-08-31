"use client";

import { type CSSProperties } from "react";

import { toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceUniverse } from "@/lib/coherence/types";
import {
  contractsLabel,
  dollarsLabel,
  exposureBands,
} from "@/lib/coherence/universe-metrics";
import { pct } from "@/lib/format";
import { useRovingListbox } from "./use-stable-selection-key";

import sharedStyles from "./UniverseInstruments.module.css";
import liquidityStyles from "./UniverseLiquidity.module.css";

const styles = {
  ...sharedStyles,
  ...liquidityStyles,
};

interface FamilySelectionProps {
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
}

type ChartStyle = CSSProperties & {
  "--bar-height"?: string;
  "--slider-fill"?: string;
};

const PRICE_AXIS_TICKS = [0, 20, 40, 60, 80, 100] as const;
const SHARE_AXIS_TICKS = [100, 75, 50, 25, 0] as const;

export function UniverseLiquidityCabinet({
  universe,
  selectedTicker,
}: { universe: CoherenceUniverse } & FamilySelectionProps) {
  const active = universe.events.find((event) => event.event_ticker === selectedTicker) ?? universe.events[0];
  const bands = active ? exposureBands(active) : [];
  const bandKeys = bands.map((band) => String(band.lowCc));
  const densest = bands.length
    ? bands.reduce((best, band, index) => band.contractsCc > bands[best].contractsCc ? index : best, 0)
    : 0;
  const [selectedBandKey, setSelectedBandKey, optionProps] = useRovingListbox(bandKeys, bandKeys[densest]);
  if (!active || !bands.length) {
    return (
      <figure className={`${styles.instrument} ${styles.liquidityPanel}`} aria-label="No family position map is available">
        <figcaption className={styles.head}>
          <span><small>Position map</small>No watched family is available to inspect</span>
          <strong>0 families</strong>
        </figcaption>
        <p className={styles.empty}>◌ The universe endpoint returned no family from which to derive open-interest bands.</p>
      </figure>
    );
  }

  const valueCc = toCenticents(active.yes_ask_total);
  const contractsCc = toCenticents(active.open_interest_total);
  const depthCc = toCenticents(active.liquidity_total);
  const selectedIndex = Math.max(0, bandKeys.indexOf(selectedBandKey ?? ""));
  const selectedBand = bands[selectedIndex] ?? bands[0];
  return (
    <figure className={`${styles.instrument} ${styles.liquidityPanel}`} aria-label="Open interest by price band">
      <figcaption className={styles.head}>
        <span><small>Position map</small>Where open contracts sit</span>
        <strong>{active.event_ticker}</strong>
      </figcaption>

      <div className={styles.bandChartShell}>
        <div className={styles.bandYAxis} aria-hidden="true">
          <span className={styles.bandYAxisTitle}>Y axis: Open-interest share</span>
          <span className={styles.bandYTicks}>
            {SHARE_AXIS_TICKS.map((tick) => <i key={tick}>{tick}%</i>)}
          </span>
        </div>
        <div className={styles.bandChart} role="listbox" aria-label={`Open-interest bands for ${active.event_ticker}`}>
          {bands.map((band, index) => {
            const share = band.share;
            const absoluteHeight = share == null ? 0 : Math.min(100, Math.max(share === 0 ? 0 : 4, share * 100));
            const style: ChartStyle = { "--bar-height": `${absoluteHeight}%` };
            return (
              <button
                type="button"
                role="option"
                aria-selected={selectedBandKey === bandKeys[index]}
                aria-label={`${band.lowCc / 100} to ${band.highCc / 100} cents: ${contractsLabel(band.contractsCc)} contracts, ${pct(share, 0)}`}
                key={band.lowCc}
                className={styles.bandColumn}
                data-empty={share == null || share === 0 ? "true" : undefined}
                style={style}
                {...optionProps(bandKeys[index], index)}
                onClick={() => setSelectedBandKey(bandKeys[index])}
              >
                <span className={styles.bandPlot} aria-hidden="true">
                  <i />
                  {share != null && share > 0 ? <strong className="num">{pct(share, 0)}</strong> : null}
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.bandAxisTicks} aria-hidden="true">
          {PRICE_AXIS_TICKS.map((tick) => <span key={tick}>{tick}c</span>)}
        </div>
        <label
          className={styles.bandXAxis}
          style={{ "--slider-fill": `${bands.length <= 1 ? 0 : (selectedIndex / (bands.length - 1)) * 100}%` } as ChartStyle}
        >
          <span className={styles.bandXAxisHead}>
            <b>X axis: YES ask price band</b>
            <output>Selected {selectedBand.lowCc / 100}–{selectedBand.highCc / 100}c</output>
          </span>
          <input
            type="range"
            min={0}
            max={Math.max(0, bands.length - 1)}
            step={1}
            value={selectedIndex}
            aria-label="Inspect an open-interest price band"
            aria-valuetext={`${selectedBand.lowCc / 100} to ${selectedBand.highCc / 100} cents`}
            onChange={(event) => setSelectedBandKey(bandKeys[Number(event.currentTarget.value)] ?? bandKeys[0])}
          />
        </label>
      </div>

      <output className={styles.bandReadout} aria-live="polite" aria-atomic="true">
        <span><small>{selectedBand.lowCc / 100}–{selectedBand.highCc / 100}c</small><strong className="num">{contractsLabel(selectedBand.contractsCc)} contracts</strong></span>
        <p>{selectedBand.share == null
          ? "No open interest to distribute."
          : `${pct(selectedBand.share, 1)} of this family.`}</p>
      </output>

      <dl className={`${styles.metricGrid} ${styles.liquidityMetrics}`}>
        <div>
          <dt>Family basket value</dt><dd className="num">{dollarsLabel(valueCc)}</dd>
          {valueCc == null ? <dd className={styles.metricReason}>{active.basket_note || "A complete family ask was not reported."}</dd> : null}
        </div>
        <div>
          <dt>Family open interest</dt><dd className="num">{contractsLabel(contractsCc)}</dd>
          {contractsCc == null ? <dd className={styles.metricReason}>The selected family carries no open-interest figure.</dd> : null}
        </div>
        <div>
          <dt>Family liquidity</dt><dd className="num">{dollarsLabel(depthCc)}</dd>
          {depthCc == null ? <dd className={styles.metricReason}>The selected family carries no resting-liquidity figure.</dd> : null}
        </div>
      </dl>
    </figure>
  );
}
