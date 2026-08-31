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

import { PendingBoard, type PendingBoardContext } from "./SettlementInstruments";

export interface PendingMinute {
  ts_ms: number;
  provisional: string | null;
  spread: string | null;
  stations: number;
}

export default function PendingMinutes({ rows, units, context }: {
  rows: PendingMinute[];
  units: string;
  context: PendingBoardContext;
}) {
  return <PendingBoard rows={rows} units={units} context={context} />;
}
