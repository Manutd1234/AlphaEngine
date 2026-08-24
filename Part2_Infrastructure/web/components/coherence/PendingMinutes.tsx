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

const ROW_H = 24;
const TOP = 18;
const BOTTOM = 20;
const LABEL_W = 76;

export default function PendingMinutes({ rows, units }: { rows: PendingMinute[]; units: string }) {
  const spreads = rows.map((row) => (row.spread == null ? null : Number(row.spread)));
  const known = spreads.filter((value): value is number => value != null && Number.isFinite(value));
  const widest = known.length ? Math.max(...known) : 0;
  const height = TOP + rows.length * ROW_H + BOTTOM;
  const unmeasured = rows.length - known.length;

  if (!rows.length) {
    return (
      <Figure
        caption="Minutes reported by the stations and not yet published by the exchange"
        ariaLabel="No minute is inside the receipt deadline"
      >
        <FigureEmpty reason="No minute is inside the receipt deadline, so there is nothing the stations have reported that the exchange has not already published." />
      </Figure>
    );
  }

  const ariaLabel = rows
    .map((row) => `${new Date(row.ts_ms).toISOString().slice(11, 16)} UTC: provisional ${row.provisional ?? "not published"}, `
      + `stations ${row.spread == null ? "spread not published" : `${row.spread} apart`}, ${row.stations} reporting`)
    .join(". ");

  return (
    <Figure
      caption="Minutes reported by the stations and not yet published by the exchange"
      reading={
        known.length
          ? `Bar length is how far the stations disagree, widest ${widest} ${units}. A wide bar means the mean beside `
            + "it averages readings that do not agree."
          : null
      }
      missing={unmeasured ? `${unmeasured} of ${rows.length} minutes published no spread, so they carry a dash rather than a zero-length bar.` : null}
      ariaLabel={ariaLabel}
    >
      <Plot height={height}>
        {(width) => {
          const plotLeft = LABEL_W;
          const plotWidth = Math.max(40, width - LABEL_W - 96);
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
                      />
                    ) : (
                      <text x={plotLeft} y={y + 13} className="coh-axis__label">— no spread published</text>
                    )}
                    <text x={width - 4} y={y + 13} textAnchor="end" className="coh-axis__label">
                      {row.provisional ?? "—"} from {row.stations}
                    </text>
                  </g>
                );
              })}
              <text x={0} y={height - 6} className="coh-axis__label">
                Left, the UTC minute; the bar is how far the stations disagree; right, the provisional index and how many reported it
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
