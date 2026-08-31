"use client";

/** One selectable size curve at a time, with exact values preserved in a compact ledger. */

import { useState } from "react";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, placeStrikes } from "@/lib/coherence/strike-axis";
import type { CoherenceEventView, CoherenceMarketView } from "@/lib/coherence/types";
import { groupDigits } from "@/lib/coherence/universe-metrics";

import Figure, { FigureEmpty, Plot } from "./Figure";
import styles from "./CertificateSizes.module.css";

type MetricKey = "open-interest" | "volume" | "liquidity";

interface SizeMetric {
  key: MetricKey;
  name: string;
  plainName: string;
  description: string;
  unit: string;
  prefix: string;
  of: (market: CoherenceMarketView) => string | null;
}

interface OrderedLeg {
  market: CoherenceMarketView;
  strike: number | null;
}

interface SizeScale {
  metric: SizeMetric;
  rawValues: Array<string | null>;
  values: Array<number | null>;
  peak: number | null;
  peakRaw: string | null;
  unreported: number;
  unscaled: number;
}

const METRICS: readonly SizeMetric[] = [
  {
    key: "open-interest",
    name: "Open interest",
    plainName: "open interest",
    description: "Held",
    unit: "contracts outstanding",
    prefix: "",
    of: (market) => market.open_interest,
  },
  {
    key: "volume",
    name: "Volume",
    plainName: "traded volume",
    description: "Traded",
    unit: "contracts traded",
    prefix: "",
    of: (market) => market.volume,
  },
  {
    key: "liquidity",
    name: "Liquidity",
    plainName: "resting liquidity",
    description: "Resting",
    unit: "dollars resting now",
    prefix: "$",
    of: (market) => market.liquidity,
  },
] as const;

const CAPTION = "Size profile by outcome — held, traded, or resting";
const CHART_HEIGHT = 278;
const MARGIN = { top: 20, right: 18, bottom: 42, left: 62 } as const;

const labelOf = (leg: OrderedLeg): string => leg.market.yes_sub_title || leg.market.ticker;
const fmtStrike = (value: number | null): string => value === null ? "No strike" : groupDigits(String(value));

function exactMetricValue(metric: SizeMetric, raw: string | null): string {
  return raw === null ? "Not reported" : `${metric.prefix}${groupDigits(raw)}`;
}

function scaleMaximum(scale: SizeScale, rowCount: number): string {
  if (scale.peakRaw !== null) return exactMetricValue(scale.metric, scale.peakRaw);
  return scale.unreported === rowCount ? "Not reported" : "Not scalable";
}

/** Match the quote view: strike order first, then custom outcomes in venue order. */
function orderedLegs(event: CoherenceEventView): { rows: OrderedLeg[]; unplaced: number } {
  const { placed, unplaced } = placeStrikes(event.markets);
  const placedMarkets = new Set(placed.map((leg) => leg.market));
  return {
    unplaced,
    rows: [
      ...placed.map((leg) => ({ market: leg.market, strike: leg.strike })),
      ...event.markets
        .filter((market) => !placedMarkets.has(market))
        .map((market) => ({ market, strike: null })),
    ],
  };
}

function scaleFor(metric: SizeMetric, rows: readonly OrderedLeg[]): SizeScale {
  const rawValues = rows.map((leg) => metric.of(leg.market));
  const values = rawValues.map((raw) => {
    const value = money(raw);
    return value !== null && value >= 0 ? value : null;
  });
  let peak: number | null = null;
  let peakRaw: string | null = null;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value !== null && (peak === null || value > peak)) {
      peak = value;
      peakRaw = rawValues[index];
    }
  }
  return {
    metric,
    rawValues,
    values,
    peak,
    peakRaw,
    unreported: rawValues.filter((raw) => raw === null).length,
    unscaled: rawValues.filter((raw, index) => raw !== null && values[index] === null).length,
  };
}

function xAt(index: number, count: number, width: number): number {
  const span = width - MARGIN.left - MARGIN.right;
  return count < 2 ? MARGIN.left + span / 2 : MARGIN.left + (index / (count - 1)) * span;
}

function yAt(value: number, peak: number): number {
  const span = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  return MARGIN.top + (1 - Math.min(1, value / Math.max(peak, 1))) * span;
}

function linePath(values: readonly (number | null)[], width: number, peak: number): string {
  let drawing = false;
  const commands: string[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      drawing = false;
      return;
    }
    commands.push(`${drawing ? "L" : "M"}${xAt(index, values.length, width).toFixed(2)},${yAt(value, peak).toFixed(2)}`);
    drawing = true;
  });
  return commands.join(" ");
}

function areaPaths(values: readonly (number | null)[], width: number, peak: number): string[] {
  const baseline = yAt(0, peak);
  const paths: string[] = [];
  let points: Array<[number, number]> = [];
  const flush = () => {
    if (!points.length) return;
    const first = points[0];
    const last = points[points.length - 1];
    paths.push(
      `M${first[0].toFixed(2)},${baseline.toFixed(2)} `
      + points.map(([x, y]) => `L${x.toFixed(2)},${y.toFixed(2)}`).join(" ")
      + ` L${last[0].toFixed(2)},${baseline.toFixed(2)} Z`,
    );
    points = [];
  };
  values.forEach((value, index) => {
    if (value === null) {
      flush();
      return;
    }
    points.push([xAt(index, values.length, width), yAt(value, peak)]);
  });
  flush();
  return paths;
}

function labelledIndexes(count: number): number[] {
  if (count <= 6) return Array.from({ length: count }, (_, index) => index);
  return [...new Set(Array.from({ length: 6 }, (_, index) => Math.round((index / 5) * (count - 1))))];
}

function shortAxisValue(metric: SizeMetric, value: number): string {
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  const compact = rounded.includes(".")
    ? rounded.replace(/0+$/, "").replace(/\.$/, "")
    : rounded;
  return `${metric.prefix}${groupDigits(compact)}`;
}

export default function LegSizes({
  event,
  caption = CAPTION,
  context,
}: {
  event: CoherenceEventView;
  caption?: string;
  context?: string;
}) {
  const { rows, unplaced } = orderedLegs(event);
  const [metricKey, setMetricKey] = useState<MetricKey>("open-interest");

  if (!rows.length) {
    return (
      <Figure
        caption={caption}
        ariaLabel="This family has no outcomes"
        missing="The venue returned no outcome legs, so there are no size readings to show."
        reserveInteractionRow={false}
      >
        <FigureEmpty reason="No outcome legs returned." />
      </Figure>
    );
  }

  const scales = METRICS.map((metric) => scaleFor(metric, rows));
  const selected = scales.find((scale) => scale.metric.key === metricKey) ?? scales[0];
  const peak = selected.peak ?? 1;
  const blind = scales.filter((scale) => scale.unreported === rows.length);
  const partiallyMissing = scales.filter((scale) => scale.unreported > 0 && scale.unreported < rows.length);
  const unscaled = scales.filter((scale) => scale.unscaled > 0);
  const exactSizeLabel = `Exact size readings, ${rows.length} outcomes`;
  const totals = [
    event.open_interest_total === null
      ? "open-interest total withheld"
      : `${groupDigits(event.open_interest_total)} contracts outstanding`,
    event.liquidity_total === null
      ? "liquidity total withheld"
      : "$" + groupDigits(event.liquidity_total) + " resting liquidity",
  ].join(", ");

  return (
    <>
      <Figure
        caption={caption}
        ariaLabel={`${rows.length} outcomes for ${event.event_ticker}; choose open interest, volume, or liquidity and inspect the curve by outcome`}
        reading={`${rows.length} outcomes in the same order as Prices. ${totals}. Only one unit is plotted at a time.`}
        missing={
          blind.length
            ? `${blind.map((scale) => scale.metric.name).join(" and ")} ${blind.length === 1 ? "is" : "are"} not reported for any outcome.`
            : null
        }
        notes={[
          context ?? "",
          "The selector changes the whole y-axis, so contracts held, contracts traded, and dollars resting are never overlaid or compared as if they shared a unit.",
          "A reported zero sits on the baseline with a visible point. A protocol absence breaks the curve; the two states never share a mark.",
          partiallyMissing.length
            ? partiallyMissing.map((scale) => `${scale.unreported} legs report no ${scale.metric.plainName}`).join("; ") + "."
            : "Every outcome reports all three size fields.",
          unscaled.length
            ? unscaled.map((scale) => `${scale.unscaled} ${scale.metric.name} values cannot be scaled`).join("; ") + "."
            : "",
          unplaced ? `${unplaced} outcomes have no numeric strike and remain at the end in venue order.` : "",
        ].filter(Boolean)}
        readout={<span className="num">{`${selected.metric.name}, peak ${scaleMaximum(selected, rows.length)}`}</span>}
      >
        <div className={styles.metricSwitch} role="group" aria-label="Size measure">
          {scales.map((scale) => (
            <button
              key={scale.metric.key}
              type="button"
              aria-pressed={scale.metric.key === metricKey}
              onClick={() => setMetricKey(scale.metric.key)}
            >
              <span>{scale.metric.description}</span>
              <strong>{scale.metric.name}</strong>
              <small className="num">Peak {scaleMaximum(scale, rows.length)}</small>
            </button>
          ))}
        </div>

        <Plot
          height={CHART_HEIGHT}
          sharedX={(width) => ({
            count: rows.length,
            x0: MARGIN.left,
            x1: width - MARGIN.right,
            positions: rows.map((_, index) => xAt(index, rows.length, width)),
            width: 300,
            arriveAt: "first",
            pin: true,
            read: (index) => ({
              title: `${String(index + 1).padStart(2, "0")} — ${labelOf(rows[index])}`,
              rows: [
                ...scales.map((scale) => ({
                  label: scale.metric.name,
                  value: exactMetricValue(scale.metric, scale.rawValues[index]),
                  raw: scale.values[index],
                })),
                { label: "Strike", value: fmtStrike(rows[index].strike) },
              ],
            }),
          })}
        >
          {(width) => {
            const path = linePath(selected.values, width, peak);
            const areas = areaPaths(selected.values, width, peak);
            return (
              <>
                {[1, 0.5, 0].map((fraction) => (
                  <g key={fraction}>
                    <line
                      x1={MARGIN.left}
                      x2={width - MARGIN.right}
                      y1={yAt(peak * fraction, peak)}
                      y2={yAt(peak * fraction, peak)}
                      className={styles.gridLine}
                    />
                    <text
                      x={MARGIN.left - 8}
                      y={yAt(peak * fraction, peak) + 4}
                      textAnchor="end"
                      className={styles.axisText}
                    >
                      {shortAxisValue(selected.metric, peak * fraction)}
                    </text>
                  </g>
                ))}

                {areas.map((area, index) => <path d={area} className={styles.area} key={index} />)}
                {path ? <path d={path} className={styles.line} /> : null}

                {selected.values.map((value, index) => value !== null ? (
                  <circle
                    key={rows[index].market.ticker}
                    cx={xAt(index, rows.length, width)}
                    cy={yAt(value, peak)}
                    r={value === 0 ? 5 : 4.5}
                    className={styles.point}
                    data-zero={value === 0 ? "true" : undefined}
                  >
                    <title>{`${labelOf(rows[index])}: ${exactMetricValue(selected.metric, selected.rawValues[index])}`}</title>
                  </circle>
                ) : null)}

                {!path ? (
                  <text x={(MARGIN.left + width - MARGIN.right) / 2} y={CHART_HEIGHT / 2} textAnchor="middle" className={styles.emptyLabel}>
                    {selected.metric.name} is not reported for this family
                  </text>
                ) : null}

                {labelledIndexes(rows.length).map((index) => (
                  <text
                    key={`label-${rows[index].market.ticker}`}
                    x={xAt(index, rows.length, width)}
                    y={CHART_HEIGHT - 14}
                    textAnchor="middle"
                    className={styles.outcomeTick}
                  >
                    {String(index + 1).padStart(2, "0")}
                  </text>
                ))}
                <text x={width - MARGIN.right} y={CHART_HEIGHT - 2} textAnchor="end" className={styles.axisCaption}>
                  outcome order
                </text>
              </>
            );
          }}
        </Plot>
      </Figure>

      <details className={`quant-inspection__table ${styles.exactTable}`}>
        <summary>{`Exact size ledger, ${rows.length} rows`}</summary>
        <Table scrollLabel={exactSizeLabel}>
          <TableHeader>
            <TableRow>
              <TableHead>Outcome</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>Open interest (contracts)</TableHead>
              <TableHead>Volume (contracts)</TableHead>
              <TableHead>Liquidity (dollars)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((leg, index) => (
              <TableRow key={leg.market.ticker}>
                <TableCell>
                  <strong>{labelOf(leg)}</strong>
                  {leg.market.yes_sub_title ? <span className={styles.tableTicker}>{leg.market.ticker}</span> : null}
                </TableCell>
                <TableCell className="num">{fmtStrike(leg.strike)}</TableCell>
                {scales.map((scale) => (
                  <TableCell className="num" key={scale.metric.key}>
                    {exactMetricValue(scale.metric, scale.rawValues[index])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </>
  );
}
