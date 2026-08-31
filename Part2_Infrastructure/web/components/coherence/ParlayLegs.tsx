"use client";

/**
 * What each parlay is built from, on the exact dollar axis its bounds use.
 *
 * The overview keeps one selectable mark per parlay so pointer, touch and
 * arrow-key selection remain linked to the rest of the view. The exact inputs
 * are a sibling below the paired diagrams rather than part of this figure;
 * that keeps its heading aligned and stops the other diagram stretching to a
 * table's height.
 */

import { DOLLAR_CC, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { parlayName } from "@/lib/coherence/parlay-name";
import { parlayLegBandRole } from "@/lib/coherence/parlay-leg-role";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import Figure, { Plot } from "./Figure";
import styles from "./ParlayLegs.module.css";

const ROW_H = 46;
const TOP = 5;
const AXIS_GAP = 8;
const MIN_PLOT_WIDTH = 640;

function displayRows(combos: CoherenceCombo[]) {
  return combos.map((combo) => {
    const legs = combo.legs.map((leg) => ({
      ticker: leg.ticker,
      side: leg.side,
      p: toCenticents(leg.probability),
      text: priceLabel(leg.probability),
    }));
    return {
      ticker: combo.ticker,
      name: parlayName(combo),
      legs,
      quoted: legs.filter((leg) => leg.p != null),
      unquoted: legs.filter((leg) => leg.p == null).length,
    };
  });
}

export default function ParlayLegs({
  combos,
  selectedTicker,
}: {
  combos: CoherenceCombo[];
  selectedTicker: string | null;
}) {
  const allRows = displayRows(combos);
  const selected = allRows.find((row) => row.ticker === selectedTicker)
    ?? allRows[0]
    ?? null;
  const rows = selected?.legs ?? [];
  const axisY = TOP + rows.length * ROW_H + AXIS_GAP;
  const height = axisY + 18;
  const unquoted = rows.filter((row) => row.p == null).length;

  return (
    <Figure
      caption={selected ? `Leg prices for ${selected.name}` : "Leg prices"}
      ariaLabel={selected
        ? `${selected.name}: ${rows.map((leg, index) => `leg ${index + 1}, ${leg.ticker}, must land ${leg.side}, ${leg.text}`).join("; ")}`
        : "No parlay is loaded"}
      reading={!rows.length
        ? "No required legs were returned."
        : unquoted
          ? "A missing dot makes both range limits unavailable."
          : "The lowest dot sets the maximum; all dots together set the minimum."}
      missing={unquoted
        ? `${unquoted} required ${unquoted === 1 ? "side has" : "sides have"} no quote and stays off the axis.`
        : null}
      notes={[
        "These leg prices limit the parlay range; they do not establish one fair parlay price.",
      ]}
    >
      <Plot
        height={height}
        minWidth={MIN_PLOT_WIDTH}
        scrollLabel="Selected parlay leg prices"
      >
        {(width) => {
          const labelW = gutterFor(rows.map((row) => row.ticker), width, DIAGRAM_LABEL_PX, {
            min: 210, maxFraction: 0.42, max: 350,
          });
          const trackW = Math.max(220, width - labelW);
          const x = (cc: number) => labelW + (Math.min(cc, DOLLAR_CC) / DOLLAR_CC) * trackW;
          return (
            <>
              {rows.map((row, index) => {
                const y = TOP + index * ROW_H;
                const pinX = row.p == null ? null : x(row.p);
                const nearEnd = row.p != null && row.p > DOLLAR_CC * 0.82;
                return (
                  <g key={`${row.ticker}-${row.side}-${index}`}>
                    <title>{`Leg ${index + 1}: ${row.ticker} must land ${row.side}; price ${row.text}`}</title>
                    <rect x={labelW} y={y + 12} width={trackW} height={16} className="coh-combo__track" />
                    {pinX == null ? (
                      <text x={labelW + 8} y={y + 28} className={styles.unquoted}>
                        ◌ unquoted
                      </text>
                    ) : (
                      <>
                        <line x1={pinX} x2={pinX} y1={y + 7} y2={y + 33} className="coh-combo__leg" />
                        <circle cx={pinX} cy={y + 20} r={5} className={styles.legDot} />
                        <text
                          x={pinX + (nearEnd ? -9 : 9)}
                          y={y + 10}
                          textAnchor={nearEnd ? "end" : "start"}
                          className={styles.pinValue}
                        >
                          {row.text}
                        </text>
                      </>
                    )}
                    <text x={0} y={y + 16} className={styles.rowName}>
                      {`${index + 1}. MUST ${row.side.toUpperCase()}`}
                    </text>
                    <text x={0} y={y + 34} className={styles.rowTicker}>
                      {truncateMiddle(row.ticker, labelW - 14, DIAGRAM_LABEL_PX)}
                    </text>
                  </g>
                );
              })}
              <line x1={labelW} x2={width} y1={axisY} y2={axisY} className="coh-ladder__axis" />
              <text x={labelW} y={axisY + 14} className="coh-combo__axis">$0</text>
              <text x={width} y={axisY + 14} textAnchor="end" className="coh-combo__axis">$1</text>
              <text x={(labelW + width) / 2} y={axisY + 14} textAnchor="middle" className={styles.axisKey}>
                ● leg price
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

/** Exact inputs for the row selected in the linked overview. */
export function ParlayLegInputs({
  combos,
  selectedTicker,
}: {
  combos: CoherenceCombo[];
  selectedTicker: string | null;
}) {
  const rows = displayRows(combos);
  const selected = rows.find((row) => row.ticker === selectedTicker) ?? rows[0] ?? null;
  const selectedMinimum = selected?.quoted.length
    ? Math.min(...selected.quoted.map((leg) => leg.p as number))
    : null;

  return (
    <section className={styles.inspector} aria-label="Selected parlay leg inputs">
      <p className="sr-only" role="status" aria-live="polite">
        {selected
          ? `${selected.name}. ${selected.ticker}. ${selected.legs.length} required legs; ${selected.unquoted} unquoted.`
          : "No parlay loaded."}
      </p>
      <header className={styles.inspectorHead}>
        <span>
          <small>Selected leg details</small>
          <strong>{selected?.name ?? "No parlay loaded"}</strong>
        </span>
        <code>{selected?.ticker ?? "—"}</code>
      </header>
      <div className={`table-wrap ${styles.tableWrap}`} role="region" aria-label="Exact selected parlay leg table" tabIndex={0}>
        <table className={`coh-table ${styles.legTable}`}>
          <caption className="coh-table__caption sr-only">Selected parlay leg details</caption>
          <thead>
            <tr>
              <th scope="col" className="num">#</th>
              <th scope="col">Required leg</th>
              <th scope="col">Must land</th>
              <th scope="col" className="num">Price</th>
              <th scope="col">Effect on range</th>
            </tr>
          </thead>
          <tbody>
            {selected?.legs.map((leg, index) => (
              <tr key={`${leg.ticker}-${leg.side}-${index}`}>
                <td className="num">{index + 1}</td>
                <th scope="row"><code>{leg.ticker}</code></th>
                <td><strong>{leg.side.toUpperCase()}</strong></td>
                <td className="num">{leg.text}</td>
                <td>{parlayLegBandRole(leg.p, selectedMinimum)}</td>
              </tr>
            )) ?? null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
