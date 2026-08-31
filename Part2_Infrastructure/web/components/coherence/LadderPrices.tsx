"use client";

/** A compact bid/ask curve over the selected family's ordered outcomes. */

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { money, placeStrikes } from "@/lib/coherence/strike-axis";
import type { CoherenceEventView, CoherenceMarketView } from "@/lib/coherence/types";
import { groupDigits } from "@/lib/coherence/universe-metrics";

import Figure, { FigureEmpty, Plot } from "./Figure";
import styles from "./CertificatePrices.module.css";

const CAPTION = "YES bid and ask curves across the outcome ladder";
const PRICE_TICKS = [1, 0.75, 0.5, 0.25, 0] as const;
const CHART_HEIGHT = 278;
const MARGIN = { top: 18, right: 18, bottom: 42, left: 48 } as const;

interface PriceRow {
  market: CoherenceMarketView;
  strike: number | null;
  bid: number | null;
  ask: number | null;
}

const labelOf = (row: PriceRow): string => row.market.yes_sub_title || row.market.ticker;
const fmtStrike = (value: number | null): string => value === null ? "No strike" : groupDigits(String(value));
const fmtSize = (value: string | null): string => value === null ? "Not reported" : groupDigits(value);

/** Only a valid probability can sit on the fixed rail; the exact wire value still prints in the ledger. */
function pricePosition(raw: string | null): number | null {
  const value = money(raw);
  return value !== null && value >= 0 && value <= 1 ? value : null;
}

function quoteText(raw: string | null, position: number | null): string {
  if (raw === null) return "Unquoted";
  return position === null ? `${raw}; outside $0–$1` : raw;
}

/** Strike-bearing legs lead in strike order; custom outcomes follow in venue order. */
function priceRows(event: CoherenceEventView): { rows: PriceRow[]; unplaced: number } {
  const { placed, unplaced } = placeStrikes(event.markets);
  const placedMarkets = new Set(placed.map((leg) => leg.market));
  const ordered = [
    ...placed.map((leg) => ({ market: leg.market, strike: leg.strike })),
    ...event.markets
      .filter((market) => !placedMarkets.has(market))
      .map((market) => ({ market, strike: null })),
  ];
  return {
    unplaced,
    rows: ordered.map((row) => ({
      ...row,
      bid: pricePosition(row.market.yes_bid),
      ask: pricePosition(row.market.yes_ask),
    })),
  };
}

function xAt(index: number, count: number, width: number): number {
  const span = width - MARGIN.left - MARGIN.right;
  return count < 2 ? MARGIN.left + span / 2 : MARGIN.left + (index / (count - 1)) * span;
}

function yAt(value: number): number {
  const span = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;
  return MARGIN.top + (1 - value) * span;
}

function linePath(rows: readonly PriceRow[], pick: (row: PriceRow) => number | null, width: number): string {
  let drawing = false;
  const commands: string[] = [];
  rows.forEach((row, index) => {
    const value = pick(row);
    if (value === null) {
      drawing = false;
      return;
    }
    commands.push(`${drawing ? "L" : "M"}${xAt(index, rows.length, width).toFixed(2)},${yAt(value).toFixed(2)}`);
    drawing = true;
  });
  return commands.join(" ");
}

function labelledIndexes(count: number): number[] {
  if (count <= 6) return Array.from({ length: count }, (_, index) => index);
  return [...new Set(Array.from({ length: 6 }, (_, index) => Math.round((index / 5) * (count - 1))))];
}

export default function LadderPrices({ event }: { event: CoherenceEventView }) {
  const { rows, unplaced } = priceRows(event);

  if (!rows.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="This family has no outcomes"
        missing="The venue returned no outcome legs, so there are no quotes to show."
        reserveInteractionRow={false}
      >
        <FigureEmpty reason="No outcome legs returned." />
      </Figure>
    );
  }

  const noBid = rows.filter((row) => row.market.yes_bid === null).length;
  const noAsk = rows.filter((row) => row.market.yes_ask === null).length;
  const both = rows.filter((row) => row.bid !== null && row.ask !== null).length;
  const offTrack = rows.reduce(
    (count, row) => count
      + (row.market.yes_bid !== null && row.bid === null ? 1 : 0)
      + (row.market.yes_ask !== null && row.ask === null ? 1 : 0),
    0,
  );
  const reasons = [...new Set(
    rows.map((row) => row.market.unquoted_reason).filter((reason): reason is string => Boolean(reason)),
  )];
  const exactLegLabel = `Exact leg quotes, ${rows.length} rows`;
  const missingSides = noBid + noAsk;

  return (
    <>
      <Figure
        caption={CAPTION}
        ariaLabel={`${rows.length} ordered outcomes for ${event.event_ticker}; bid and ask are plotted on a fixed zero-to-one dollar axis`}
        reading={
          `${rows.length} outcomes: ${both} two-sided and ${missingSides} missing quote sides.`
          + (event.mutually_exclusive
            ? event.yes_ask_total !== null
              ? ` Buying every outcome at its YES ask totals ${event.yes_ask_total} for a guaranteed $1 payoff.`
              : " The all-outcome ask total is unavailable because the basket is not fully priceable."
            : " An all-outcome basket total does not apply because the family is not mutually exclusive.")
        }
        notes={[
          missingSides
            ? `${noBid} bids and ${noAsk} asks are unquoted. Gaps are protocol absences, never zero-price marks.`
            : "Every outcome reports both quote sides; each vertical stem is the executable spread.",
          reasons.length ? `Venue note${reasons.length === 1 ? "" : "s"}: ${reasons.join("; ")}.` : "",
          "Hover, focus, or use the arrow keys on the curve to inspect one exact outcome. Enter or click pins it for comparison.",
          unplaced ? `${unplaced} outcomes have no numeric strike and remain at the end in venue order.` : "",
          offTrack ? `${offTrack} non-null quote sides fall outside $0–$1 and stay in the ledger without a misleading mark.` : "",
        ].filter(Boolean)}
        readout={<span className="num">{`${rows.length} legs, ${both} two-sided`}</span>}
      >
        <div className={styles.chartKey} role="list" aria-label="Quote curve key">
          <span role="listitem"><i className={styles.bidKey} aria-hidden="true" /> YES bid</span>
          <span role="listitem"><i className={styles.askKey} aria-hidden="true" /> YES ask</span>
          <span role="listitem"><i className={styles.spreadKey} aria-hidden="true" /> Quoted spread</span>
          <span className={styles.chartHint}>Move across outcomes; arrows inspect; Enter pins</span>
        </div>

        <Plot
          height={CHART_HEIGHT}
          sharedX={(width) => ({
            count: rows.length,
            x0: MARGIN.left,
            x1: width - MARGIN.right,
            positions: rows.map((_, index) => xAt(index, rows.length, width)),
            width: 282,
            arriveAt: "first",
            pin: true,
            read: (index) => {
              const row = rows[index];
              return {
                title: `${String(index + 1).padStart(2, "0")} — ${labelOf(row)}`,
                rows: [
                  { label: "YES bid", value: quoteText(row.market.yes_bid, row.bid), raw: row.bid },
                  { label: "YES ask", value: quoteText(row.market.yes_ask, row.ask), raw: row.ask },
                  { label: "Spread", value: row.market.spread ?? "Not measurable" },
                  { label: "Strike", value: fmtStrike(row.strike) },
                  { label: "Open interest", value: fmtSize(row.market.open_interest) },
                ],
              };
            },
          })}
        >
          {(width) => {
            const bidPath = linePath(rows, (row) => row.bid, width);
            const askPath = linePath(rows, (row) => row.ask, width);
            return (
              <>
                {PRICE_TICKS.map((tick) => (
                  <g key={tick}>
                    <line
                      x1={MARGIN.left}
                      x2={width - MARGIN.right}
                      y1={yAt(tick)}
                      y2={yAt(tick)}
                      className={styles.gridLine}
                    />
                    <text x={MARGIN.left - 8} y={yAt(tick) + 4} textAnchor="end" className={styles.axisText}>
                      ${tick.toFixed(2)}
                    </text>
                  </g>
                ))}

                {rows.map((row, index) => row.bid !== null && row.ask !== null ? (
                  <line
                    key={`spread-${row.market.ticker}`}
                    x1={xAt(index, rows.length, width)}
                    x2={xAt(index, rows.length, width)}
                    y1={yAt(row.bid)}
                    y2={yAt(row.ask)}
                    className={styles.spreadStem}
                  />
                ) : null)}

                {bidPath ? <path d={bidPath} className={styles.bidLine} /> : null}
                {askPath ? <path d={askPath} className={styles.askLine} /> : null}

                {rows.map((row, index) => (
                  <g key={row.market.ticker}>
                    {row.bid !== null ? (
                      <circle cx={xAt(index, rows.length, width)} cy={yAt(row.bid)} r={4.5} className={styles.bidPoint}>
                        <title>{`${labelOf(row)} YES bid ${row.market.yes_bid}`}</title>
                      </circle>
                    ) : null}
                    {row.ask !== null ? (
                      <circle cx={xAt(index, rows.length, width)} cy={yAt(row.ask)} r={4.5} className={styles.askPoint}>
                        <title>{`${labelOf(row)} YES ask ${row.market.yes_ask}`}</title>
                      </circle>
                    ) : null}
                  </g>
                ))}

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
        <summary>{`Exact quote ledger, ${rows.length} rows`}</summary>
        <Table scrollLabel={exactLegLabel}>
          <TableHeader>
            <TableRow>
              <TableHead>Outcome</TableHead>
              <TableHead>Strike</TableHead>
              <TableHead>YES bid</TableHead>
              <TableHead>YES ask</TableHead>
              <TableHead>Spread</TableHead>
              <TableHead>Open interest (contracts)</TableHead>
              <TableHead>Volume (contracts)</TableHead>
              <TableHead>Liquidity (dollars)</TableHead>
              <TableHead>Venue note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.market.ticker}>
                <TableCell>
                  <strong>{labelOf(row)}</strong>
                  {row.market.yes_sub_title ? <span className={styles.tableTicker}>{row.market.ticker}</span> : null}
                </TableCell>
                <TableCell className="num">{fmtStrike(row.strike)}</TableCell>
                <TableCell className="num">{row.market.yes_bid ?? "Unquoted"}</TableCell>
                <TableCell className="num">{row.market.yes_ask ?? "Unquoted"}</TableCell>
                <TableCell className="num">{row.market.spread ?? "Not measurable"}</TableCell>
                <TableCell className="num">{row.market.open_interest ?? "Not reported"}</TableCell>
                <TableCell className="num">{row.market.volume ?? "Not reported"}</TableCell>
                <TableCell className="num">{row.market.liquidity ?? "Not reported"}</TableCell>
                <TableCell>{row.market.unquoted_reason ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </>
  );
}
