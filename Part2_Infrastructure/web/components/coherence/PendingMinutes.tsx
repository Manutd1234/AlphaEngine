"use client";

/**
 * The minutes the stations have reported and the exchange has not published.
 *
 * The index arrives in two stages, so inside the receipt deadline the next
 * published value is arithmetic on data already handed over rather than a
 * forecast. That is the one genuinely tradeable fact on the Formation view and
 * it was a four-column table — which shows the numbers and hides the thing that
 * decides whether to believe them: how far the stations DISAGREE about each
 * minute. A provisional index of 80.6 built from readings 3.6 apart is a
 * different object from the same figure built from readings that agree.
 *
 * So the spread is drawn as the bar and the provisional value labels it. A
 * reader scanning the figure sees the disagreement first, which is the correct
 * order of alarm.
 *
 * A minute with no spread published gets a row, a dash and no bar — never a
 * zero-length bar, which reads as "the stations agreed exactly" and is the one
 * reading the data does not support.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";

export interface PendingMinute {
  ts_ms: number;
  provisional: string | null;
  spread: string | null;
  stations: number;
}

const CAPTION = "Minutes reported by the stations and not yet published by the exchange";

const ROW_H = 24;
const TOP = 18;
const BOTTOM = 22;
/** "HH:MM" is five tabular glyphs; at the 13px series-label rung each sets
 *  under 7.6px, so 38px of text leaves 38px of clearance before the bars.
 *  Held at 76 through the 2026-08-24 lift: the arithmetic still clears. */
const LABEL_W = 76;
/** The right-hand column: "80.6125 from 12" is fifteen glyphs ≈ 114px at the
 *  13px rung, so 120px keeps the longest live value clear of the bars. The
 *  old 96px was sized for the same string at 10px. */
const VALUE_W = 120;

export default function PendingMinutes({ rows, units }: { rows: PendingMinute[]; units: string }) {
  const spreads = rows.map((row) => (row.spread == null ? null : Number(row.spread)));
  const known = spreads.filter((value): value is number => value != null && Number.isFinite(value));
  const widest = known.length ? Math.max(...known) : 0;
  const height = TOP + rows.length * ROW_H + BOTTOM;
  const unmeasured = rows.length - known.length;

  if (!rows.length) {
    return (
      <Figure caption={CAPTION} ariaLabel="No minute is inside the receipt deadline">
        <FigureEmpty reason="Nothing reported is still unpublished." />
      </Figure>
    );
  }

  const ariaLabel = rows
    .map((row) => `${new Date(row.ts_ms).toISOString().slice(11, 16)} UTC: provisional ${row.provisional ?? "not published"}, `
      + `stations ${row.spread == null ? "spread not published" : `${row.spread} apart`}, ${row.stations} reporting`)
    .join(". ");

  return (
    <Figure
      caption={CAPTION}
      /* The legend along the foot of the plot already names the three columns,
         so this says the one thing it cannot: what a long bar MEANS. */
      reading={
        known.length
          ? `Widest disagreement ${widest} ${units} — a long bar's provisional mean averages stations that disagree.`
          : null
      }
      missing={unmeasured ? `${unmeasured} of ${rows.length} minutes published no spread, so they carry a dash rather than a zero-length bar.` : null}
      ariaLabel={ariaLabel}
    >
      <Plot height={height}>
        {(width) => {
          const plotLeft = LABEL_W;
          const plotWidth = Math.max(40, width - LABEL_W - VALUE_W);
          const scale = widest > 0 ? plotWidth / widest : 0;
          return (
            <>
              {rows.map((row, index) => {
                const y = TOP + index * ROW_H;
                const value = spreads[index];
                return (
                  <g key={row.ts_ms}>
                    <text x={0} y={y + 13} className="coh-axis__label">
                      {new Date(row.ts_ms).toISOString().slice(11, 16)}
                    </text>
                    {value != null && scale > 0 ? (
                      <rect
                        x={plotLeft} y={y + 4} width={Math.max(1, value * scale)} height={ROW_H - 12}
                        className="coh-pending__spread"
                      >
                        <title>{`stations ${row.spread} ${units} apart, ${row.stations} reporting`}</title>
                      </rect>
                    ) : (
                      <text x={plotLeft} y={y + 13} className="coh-axis__label">— no spread published</text>
                    )}
                    <text x={width - 4} y={y + 13} textAnchor="end" className="coh-axis__label">
                      {row.provisional ?? "—"} from {row.stations}
                    </text>
                  </g>
                );
              })}
              <text x={0} y={height - 6} className="coh-figure__key">
                UTC minute, station disagreement, provisional index, and how many reported
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
