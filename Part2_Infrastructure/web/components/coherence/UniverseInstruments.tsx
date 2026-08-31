"use client";

import { useState, type CSSProperties } from "react";

import { DOLLAR_CC } from "@/lib/coherence/fixed-point";
import type { CoherenceUniverse } from "@/lib/coherence/types";
import { dollarsLabel } from "@/lib/coherence/universe-metrics";
import { useRovingListbox } from "./use-stable-selection-key";

import basketLayoutStyles from "./UniverseBasketLayout.module.css";
import sharedStyles from "./UniverseInstruments.module.css";
import parityStyles from "./UniverseParity.module.css";
import watchlistStyles from "./UniverseWatchlist.module.css";

const styles = {
  ...sharedStyles,
  ...basketLayoutStyles,
  ...watchlistStyles,
  ...parityStyles,
};

export { default as OutcomePriceConstellation } from "./UniverseOutcomeDistribution";
export { UniverseLiquidityCabinet } from "./UniverseLiquidityCabinet";

interface BasketRow {
  ticker: string;
  label: string;
  mutuallyExclusive: boolean;
  askTotalCc: number | null;
  bidTotalCc: number | null;
}

interface FamilySelectionProps {
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
}

type ChartStyle = CSSProperties & {
  "--ask-position"?: string;
  "--bid-position"?: string;
  "--probe-position"?: string;
  "--slider-fill"?: string;
};

const AXIS_MAX_CC = 13_000;
function basketState(row: BasketRow): "two-sided" | "buy-only" | "sell-only" | "unquoted" | "non-exclusive" {
  if (!row.mutuallyExclusive) return "non-exclusive";
  if (row.askTotalCc == null && row.bidTotalCc == null) return "unquoted";
  if (row.askTotalCc == null) return "sell-only";
  if (row.bidTotalCc == null) return "buy-only";
  return "two-sided";
}

function stateLabel(row: BasketRow): string {
  const state = basketState(row);
  if (state === "two-sided") return "Two-sided";
  if (state === "buy-only") return "Buy only";
  if (state === "sell-only") return "Sell only";
  if (state === "unquoted") return "Missing quote";
  return "Non-exclusive";
}

function axisPosition(value: number | null): string | undefined {
  if (value == null) return undefined;
  const clamped = Math.min(AXIS_MAX_CC, Math.max(0, value));
  return `${(clamped / AXIS_MAX_CC) * 100}%`;
}

function deltaLabel(value: number | null): string {
  if (value == null) return "Withheld";
  if (value === 0) return "At payoff";
  const formatted = dollarsLabel(Math.abs(value));
  return formatted === "—" ? "Withheld" : `${value > 0 ? "+" : "−"}${formatted}`;
}

export function UniverseWatchlistAtlas({
  universe,
  rows,
  selectedTicker,
  onSelect,
  onExplore,
}: {
  universe: CoherenceUniverse;
  rows: BasketRow[];
  selectedTicker?: string | null;
  onSelect?: (ticker: string) => void;
  onExplore?: (ticker: string) => void;
}) {
  const familyKeys = universe.events.map((event) => event.event_ticker);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(
    familyKeys,
    selectedTicker,
    selectedTicker,
    onSelect,
  );
  const active = universe.events.find((event) => event.event_ticker === selectedKey) ?? universe.events[0];
  const rowByTicker = new Map(rows.map((row) => [row.ticker, row]));
  const row = active ? rowByTicker.get(active.event_ticker) : undefined;
  const complete = rows.filter((item) => item.askTotalCc != null).length;

  return (
    <figure
      className={`${styles.instrument} ${styles.watchlistPanel} ${styles.flowSource}`}
      aria-label="Watched family selector linked row by row to the dollar test"
    >
      <figcaption className={styles.head}>
        <span><small>Watchlist</small>Choose a family</span>
        <strong>{complete}/{rows.length} priceable</strong>
      </figcaption>

      <div className={styles.watchlistGuide} aria-hidden="true">
        <span>Y axis: Watched family</span>
        <span>Quote status</span>
        <span>Buy whole</span>
      </div>

      <div
        className={styles.familyList}
        role="listbox"
        aria-label="Watched families linked to their matching Dollar Test rows"
      >
        {universe.events.map((event, index) => {
          const item = rowByTicker.get(event.event_ticker);
          if (!item) return null;
          return (
            <button
              type="button"
              role="option"
              aria-selected={selectedKey === event.event_ticker}
              aria-controls={`dollar-test-row-${event.event_ticker}`}
              aria-label={`${event.title || event.event_ticker}. ${stateLabel(item)}. Buy whole ${dollarsLabel(item.askTotalCc)}. Linked to the matching Dollar Test row.`}
              key={event.event_ticker}
              className={styles.familyRow}
              data-state={basketState(item)}
              {...optionProps(event.event_ticker, index)}
              onClick={() => setSelectedKey(event.event_ticker)}
            >
              <span className={styles.familyIdentity}>
                <small>{universe.categories[event.series_ticker] || "Uncategorised"}</small>
                <strong>{event.event_ticker}</strong>
              </span>
              <span className={styles.familyState}>{stateLabel(item)}</span>
              <span className={`${styles.familyPrice} num`}>{dollarsLabel(item.askTotalCc)}</span>
              <span className={styles.rowConnector} aria-hidden="true" />
            </button>
          );
        })}
      </div>

      {active && row ? (
        <div className={styles.selectionFooter}>
          <output className={styles.selectionReadout} aria-live="polite" aria-atomic="true">
            <small>Selected</small>
            <strong>{active.title || active.event_ticker}</strong>
            <span aria-label={row.mutuallyExclusive
              ? row.askTotalCc == null
                ? "A total from quoted legs only would understate it by exactly the legs it skipped."
                : undefined
              : "The exchange's own mutually-exclusive flag decides that, not our arithmetic."}>
              {row.mutuallyExclusive
                ? row.askTotalCc == null
                  ? "Missing quotes prevent a whole-family total."
                  : `${active.markets.length} outcomes, ${stateLabel(row).toLowerCase()}.`
                : "Not a basket: the exchange does not mark this family mutually exclusive."}
            </span>
          </output>
          {onExplore ? (
            <button type="button" className={styles.exploreButton} onClick={() => onExplore(active.event_ticker)}>
              Inspect outcomes <span aria-hidden="true">→</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}

export function UniverseBasketPassports({
  rows,
  caption,
  selectedTicker,
  onSelect,
}: {
  rows: BasketRow[];
  caption: string;
} & FamilySelectionProps) {
  const rowKeys = rows.map((row) => row.ticker);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(
    rowKeys,
    selectedTicker,
    selectedTicker,
    onSelect,
  );
  const active = rows.find((row) => row.ticker === selectedKey) ?? rows[0];
  const [probeCc, setProbeCc] = useState(DOLLAR_CC);
  if (!active) return null;

  const buyDelta = active.askTotalCc == null ? null : active.askTotalCc - DOLLAR_CC;
  const sellDelta = active.bidTotalCc == null ? null : active.bidTotalCc - DOLLAR_CC;

  return (
    <figure
      className={`${styles.instrument} ${styles.parityPanel}`}
      aria-label={`${caption}. ${rows.length} family basket comparisons`}
      style={{ "--probe-position": axisPosition(probeCc), "--slider-fill": axisPosition(probeCc) } as ChartStyle}
    >
      <figcaption className={styles.head}>
        <span><small>Dollar test</small>Whole-family cost</span>
        <strong>$0–$1.30</strong>
      </figcaption>

      <div className={styles.parityAxis} aria-hidden="true">
        <span className={styles.parityYAxis}>Y axis: Watched family</span>
        <span className={styles.axisTrack}>
          <i data-at="zero">$0</i>
          <i data-at="payoff">$1 payoff</i>
          <i data-at="ceiling">$1.30</i>
        </span>
        <span className={styles.parityValueAxis}>Buy whole</span>
      </div>

      <div className={styles.parityRows} role="listbox" aria-label="Compare whole-family prices">
        {rows.map((row, index) => {
          const style: ChartStyle = {
            "--ask-position": axisPosition(row.askTotalCc),
            "--bid-position": axisPosition(row.bidTotalCc),
          };
          return (
            <button
              type="button"
              role="option"
              id={`dollar-test-row-${row.ticker}`}
              aria-selected={selectedKey === row.ticker}
              aria-label={`${row.label}. Buy whole ${dollarsLabel(row.askTotalCc)}. Sell whole ${dollarsLabel(row.bidTotalCc)}. ${stateLabel(row)}.`}
              key={row.ticker}
              className={styles.parityRow}
              data-state={basketState(row)}
              style={style}
              {...optionProps(row.ticker, index)}
              onClick={() => setSelectedKey(row.ticker)}
            >
              <span className={styles.parityIdentity}><strong>{row.ticker}</strong><small>{stateLabel(row)}</small></span>
              <span className={styles.priceTrack} aria-hidden="true">
                <i className={styles.payoffLine} />
                <i className={styles.probeLine} />
                {row.bidTotalCc == null ? null : <i className={styles.bidMark} />}
                {row.askTotalCc == null ? null : <i className={styles.askMark} />}
                {row.askTotalCc == null && row.bidTotalCc == null ? <em>Not measurable</em> : null}
              </span>
              <span className={`${styles.parityPrice} num`}>{dollarsLabel(row.askTotalCc)}</span>
            </button>
          );
        })}
      </div>

      <label className={styles.paritySlider}>
        <span>X axis: Whole-family price; reference</span>
        <input
          type="range"
          min={0}
          max={AXIS_MAX_CC}
          step={100}
          value={probeCc}
          aria-label="Reference price on the whole-family axis"
          aria-valuetext={`Reference ${dollarsLabel(probeCc)}`}
          onChange={(event) => setProbeCc(Number(event.currentTarget.value))}
        />
        <output>{dollarsLabel(probeCc)}</output>
      </label>

      <div className={styles.legend} aria-label="Chart legend">
        <span><i data-mark="ask" /> Buy whole</span>
        <span><i data-mark="bid" /> Sell whole</span>
        <span><i data-mark="payoff" /> $1 payoff</span>
      </div>

      <output className={styles.parityReadout} aria-live="polite" aria-atomic="true">
        <span className={styles.activeFamily}><small>Selected</small><strong>{active.label}</strong><p>{stateLabel(active)}</p></span>
        <span><small>Buy whole</small><strong className="num">{dollarsLabel(active.askTotalCc)}</strong><p>{deltaLabel(buyDelta)} vs payoff</p></span>
        <span><small>Sell whole</small><strong className="num">{dollarsLabel(active.bidTotalCc)}</strong><p>{deltaLabel(sellDelta)} vs payoff</p></span>
      </output>
    </figure>
  );
}
