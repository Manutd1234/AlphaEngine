"use client";

/**
 * The makers' answers drawn on the dollar, one strip per market.
 *
 * Added 2026-08-24 on the reported complaint that some sections carry no
 * diagram at all. Dispersion was the one view on the engine that was tables end
 * to end, and its subject is the most drawable thing on the tab: several
 * professionals pricing one event independently, and the distance between
 * their answers. A twelve-column table states that distance; this shows it,
 * on the same $0-to-$1 axis every strip shares, so the market the makers
 * disagree about most is the widest thing on screen rather than the largest
 * number in column six.
 *
 * What it draws is only what the table's Lowest-to-highest and Median columns
 * already state — deliberately. The figure ranks, the table proves, and a
 * reader checks one against the other without either claiming a quantity the
 * read did not produce. Everything else the table alone carries: usable
 * counts, crossed quotes, one maker's own width, the combo band columns.
 *
 * Drawn only when at least one market has both ends of a range. A market with
 * fewer than two usable quotes has no strip, is counted in the figure's
 * `missing` line, and keeps its row in the table below — dashes and all —
 * because an absent range is a fact about the panel, not a reason to hide the
 * market.
 *
 * The classes are the band figure's own (`coh-combo__track/band/price/label/
 * axis`), borrowed the way ShellTree borrows `coh-ablation__value`: same
 * drawing role — a dollar track, a range on it, a marker — so the same rung
 * and the same ink, with no second declaration for `rung-single-declaration`
 * to fail. Nothing here says anything in colour alone: the band is a shape
 * with its ends labelled by the strip's own text row, and the median is a
 * mark, not a hue.
 */

import { useState } from "react";

import { Card } from "@/components/ui/card";
import { DOLLAR_CC, fromCenticents, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { hasDrawableMakerRange } from "@/lib/coherence/maker-dispersion";
import type { CoherenceDispersion } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";
import styles from "./DispersionStrips.module.css";

/** One strip: label line, track, band, median mark. */
const ROW_H = 46;
const TRACK_H = 12;
const TOP = 4;
const AXIS_GAP = 10;
const AXIS_LABEL_DROP = 14;

interface Strip {
  ticker: string;
  lo: number;
  hi: number;
  median: number | null;
  spread: string | null;
  row: CoherenceDispersion;
}

const READINESS_ROW_H = 48;
const PLOT_MIN_WIDTH = 620;
const PLOT_MAX_HEIGHT = 680;

function NoRangePanels({ rows, selectedTicker, onSelect }: {
  rows: CoherenceDispersion[];
  selectedTicker: string | null;
  onSelect: (ticker: string) => void;
}) {
  const selected = rows.find((row) => row.market_ticker === selectedTicker) ?? rows[0];
  const height = rows.length * READINESS_ROW_H + 42;
  const scrollable = height > PLOT_MAX_HEIGHT;
  const maximum = Math.max(1, ...rows.flatMap((row) => [row.quotes, row.usable, row.crossed]));

  return (
    <div className={`coh-dispersion-instrument ${styles.instrument}`}>
      <Figure
        caption="Panel readiness: replies received, usable and crossed"
        ariaLabel={`${rows.length} maker panels returned without a measurable maker-to-maker range.`}
        readout={<span className="num">{selected.market_ticker}</span>}
        reading="The channel returned panel rows, but none has two usable answers and both range endpoints. Counts remain measurable; maker disagreement does not."
        missing="No band is drawn from one usable quote or a missing endpoint; neither means the makers agreed."
      >
        <div
          className={styles.plotViewport}
          data-scrollable={scrollable}
          role={scrollable ? "region" : undefined}
          aria-label={scrollable ? "Scroll maker-panel readiness rows vertically" : undefined}
          tabIndex={scrollable ? 0 : undefined}
        >
        <Plot
          height={height}
          minWidth={PLOT_MIN_WIDTH}
          scrollLabel="Scroll maker-panel readiness horizontally"
          onSelect={(index) => onSelect(rows[index]?.market_ticker ?? selected.market_ticker)}
        >
          {(width) => {
            const gutter = gutterFor(rows.map((row) => row.market_ticker), width, DIAGRAM_LABEL_PX, { min: 120, maxFraction: 0.32 });
            const track = Math.max(80, width - gutter - 12);
            const x = (value: number) => gutter + (value / maximum) * track;
            return (
              <>
                {rows.map((row, index) => {
                  const y = 8 + index * READINESS_ROW_H;
                  const chosen = row.market_ticker === selected.market_ticker;
                  return (
                    <g key={row.market_ticker} className={chosen ? styles.readinessSelected : undefined}>
                      <rect x={0} y={y - 4} width={width} height={READINESS_ROW_H - 4} rx={6} className={styles.readinessRow} />
                      <text x={0} y={y + 16} className={styles.readinessLabel}>
                        {truncateMiddle(row.market_ticker, gutter - 12, DIAGRAM_LABEL_PX)}
                      </text>
                      <line x1={gutter} x2={gutter + track} y1={y + 17} y2={y + 17} className={styles.readinessTrack} />
                      <line x1={gutter} x2={x(row.usable)} y1={y + 17} y2={y + 17} className={styles.readinessUsable} />
                      <circle cx={x(row.quotes)} cy={y + 17} r={6} className={styles.readinessQuotes} />
                      {row.crossed ? <path d={`M${x(row.crossed) - 5},${y + 11} l10,12 M${x(row.crossed) + 5},${y + 11} l-10,12`} className={styles.readinessCrossed} /> : null}
                      <text x={gutter} y={y + 37} className={styles.readinessLegend}>{row.usable} usable</text>
                      <text x={gutter + track} y={y + 37} textAnchor="end" className={styles.readinessLegend}>{row.quotes} replies, {row.crossed} crossed</text>
                      <rect x={0} y={y - 4} width={width} height={READINESS_ROW_H - 4} fill="transparent" className={styles.readinessHit}>
                        <title>{`${row.market_ticker}: ${row.quotes} replies, ${row.usable} usable, ${row.crossed} crossed; quote range unavailable.`}</title>
                      </rect>
                    </g>
                  );
                })}
                <text x={gutter} y={height - 6} className={styles.readinessLegend}>0</text>
                <text x={gutter + track} y={height - 6} textAnchor="end" className={styles.readinessLegend}>{maximum} replies</text>
              </>
            );
          }}
        </Plot>
        </div>
      </Figure>
      <Card className={styles.inspector} role="region" aria-label={`Selected maker panel: ${selected.market_ticker}`}>
        <header><span>Selected panel</span><strong>{selected.market_ticker}</strong></header>
        <dl>
          <div><dt>Replies</dt><dd>{selected.quotes}</dd></div>
          <div><dt>Usable</dt><dd>{selected.usable}</dd></div>
          <div><dt>Crossed</dt><dd>{selected.crossed}</dd></div>
          <div><dt>Range</dt><dd>withheld</dd></div>
        </dl>
      </Card>
    </div>
  );
}

function shown(value: string | number | null): string {
  return value == null ? "—" : String(value);
}

function selectionLabel(strip: Strip): string {
  const { row } = strip;
  return `${strip.ticker}: ${row.quotes} maker quotes, ${row.usable} usable; median ${shown(row.median)}; `
    + `range ${shown(row.lowest)} to ${shown(row.highest)}; maker dispersion ${shown(row.spread)}; `
    + `median maker width ${shown(row.median_width)}; crossed ${row.crossed}; `
    + `combo band used ${shown(row.band_fraction)}`;
}

export default function DispersionStrips({ rows }: { rows: CoherenceDispersion[] }) {
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const strips: Strip[] = [];
  let undrawn = 0;
  for (const row of rows) {
    if (!hasDrawableMakerRange(row)) {
      undrawn += 1;
      continue;
    }
    const lo = toCenticents(row.lowest);
    const hi = toCenticents(row.highest);
    if (lo == null || hi == null) {
      undrawn += 1;
      continue;
    }
    strips.push({
      ticker: row.market_ticker,
      lo,
      hi,
      median: toCenticents(row.median),
      spread: row.spread,
      row,
    });
  }

  if (!rows.length) return null;

  if (!strips.length) {
    return <NoRangePanels rows={rows} selectedTicker={selectedTicker} onSelect={setSelectedTicker} />;
  }

  const selected = strips.find((strip) => strip.ticker === selectedTicker) ?? strips[0];
  const widest = strips.reduce((best, strip) => (strip.hi - strip.lo > best.hi - best.lo ? strip : best), strips[0]);
  const axisY = TOP + strips.length * ROW_H + AXIS_GAP;
  const height = axisY + AXIS_LABEL_DROP + 4;
  const scrollable = height > PLOT_MAX_HEIGHT;

  return (
    <div className={`coh-dispersion-instrument ${styles.instrument}`}>
    <Figure
      caption="Where the makers' answers sit on the dollar"
      ariaLabel={`${strips.length} market${strips.length === 1 ? "" : "s"}: lowest-to-highest maker quotes on a $0-to-$1 axis, median marked`}
      readout={<span className="num">{selected.ticker}</span>}
      reading={
        // THE TERNARY WAS INVERTED UNTIL 2026-08-25, so this figure was silent
        // in exactly the case it exists for. `widest.hi > widest.lo` is true
        // when there IS a range to describe, and that branch returned null; the
        // sentence about panels agreeing to the tick — the DEGENERATE case —
        // was the only reading ever drawn. A reader saw a figure of ranked
        // ranges with no reading, or a reading claiming unanimity underneath
        // strips that were plainly not unanimous, depending on the read.
        widest.hi > widest.lo
          // The distinction between this spread and one maker's own bid-offer
          // is made ONCE, in the table's caption below, and `prices-claims`
          // pins it at one site. Restating it here would be the same claim
          // twice on one view — which is the reading this tab was reported for.
          ? `The widest disagreement is on ${widest.ticker}, ${fromCenticents(widest.lo)} to `
            + `${fromCenticents(widest.hi)}: that is how far apart independent makers priced one `
            + "event, before any of them is called right."
          : "Every panel here agrees to the tick, so each strip collapses to a single mark."
      }
      missing={
        undrawn
          ? `${undrawn} of ${rows.length} markets have no strip: fewer than two usable quotes leaves no range; they stay in the table.`
          : null
      }
    >
      <div
        className={styles.plotViewport}
        data-scrollable={scrollable}
        role={scrollable ? "region" : undefined}
        aria-label={scrollable ? "Scroll maker-dispersion rows vertically" : undefined}
        tabIndex={scrollable ? 0 : undefined}
      >
      <Plot
        height={height}
        minWidth={PLOT_MIN_WIDTH}
        scrollLabel="Scroll maker-dispersion bands horizontally"
        onSelect={(index) => setSelectedTicker(strips[index]?.ticker ?? null)}
      >
        {(width) => {
          const x = (cc: number) => (cc / DOLLAR_CC) * width;
          return (
            <>
              {strips.map((strip, index) => {
                const y = TOP + index * ROW_H;
                return (
                  <g
                    key={strip.ticker}
                    className={`coh-dispersion__row${selected.ticker === strip.ticker ? " is-selected" : ""}`}
                  >
                    <text x={0} y={y + 10} className="coh-combo__label">
                      {strip.ticker}
                    </text>
                    {strip.spread != null ? (
                      <text x={width} y={y + 10} textAnchor="end" className="coh-combo__label">
                        {`spread ${priceLabel(strip.spread)}`}
                      </text>
                    ) : null}
                    <rect x={0} y={y + 16} width={width} height={TRACK_H} className="coh-combo__track" />
                    <rect
                      x={x(strip.lo)}
                      y={y + 16}
                      width={Math.max(1, x(strip.hi) - x(strip.lo))}
                      height={TRACK_H}
                      className="coh-combo__band"
                    />
                    {strip.median != null ? (
                      <line
                        x1={x(strip.median)}
                        x2={x(strip.median)}
                        y1={y + 13}
                        y2={y + 16 + TRACK_H + 3}
                        className="coh-combo__price"
                      />
                    ) : null}
                    <rect
                      x={0}
                      y={y}
                      width={width}
                      height={ROW_H - 6}
                      fill="transparent"
                      className="coh-dispersion__hit"
                    >
                      <title>{selectionLabel(strip)}</title>
                    </rect>
                  </g>
                );
              })}
              <line x1={0} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={0} y={axisY + AXIS_LABEL_DROP} textAnchor="start" className="coh-combo__axis">
                $0
              </text>
              <text x={width} y={axisY + AXIS_LABEL_DROP} textAnchor="end" className="coh-combo__axis">
                $1
              </text>
            </>
          );
        }}
      </Plot>
      </div>
    </Figure>
    <Card
      className={`markets-dispersion-inspector ${styles.inspector}`}
      role="region"
      aria-label={`Selected maker panel: ${selected.ticker}`}
      aria-live="polite"
      aria-atomic="true"
      data-selected-ticker={selected.ticker}
    >
      <header>
        <span>Selected maker panel</span>
        <strong>{selected.ticker}</strong>
      </header>
      <dl>
        <div><dt>Makers</dt><dd>{selected.row.quotes}</dd></div>
        <div><dt>Usable</dt><dd>{selected.row.usable}</dd></div>
        <div><dt>Median</dt><dd>{shown(selected.row.median)}</dd></div>
        <div><dt>Range</dt><dd>{shown(selected.row.lowest)} to {shown(selected.row.highest)}</dd></div>
        <div><dt>Maker dispersion</dt><dd>{shown(selected.row.spread)}</dd></div>
        <div><dt>Median maker width</dt><dd>{shown(selected.row.median_width)}</dd></div>
        <div><dt>Crossed</dt><dd>{selected.row.crossed}</dd></div>
        <div><dt>Combo band</dt><dd>{shown(selected.row.band_width)}</dd></div>
        <div><dt>Band used</dt><dd>{shown(selected.row.band_fraction)}</dd></div>
      </dl>
    </Card>
    </div>
  );
}
