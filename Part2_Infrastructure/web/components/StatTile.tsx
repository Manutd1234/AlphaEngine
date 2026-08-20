"use client";

import { memo, type ReactNode } from "react";

import QuantEducationalTooltip from "@/components/common/QuantEducationalTooltip";

/** A single number is not a chart. These are stat tiles, not one-bar bar charts. */
function StatTile({
  label,
  value,
  note,
  tone,
  explain,
}: {
  label: string;
  /** ReactNode so a poll-fed figure can count through NumberTicker. */
  value: ReactNode;
  note?: string;
  tone?: "pos" | "neg" | "muted";
  /**
   * An optional definition for the measure this tile reports. A desk metric
   * whose name is only meaningful to someone who already knows it is not a
   * finished metric — and the alternative, a paragraph under every tile, is
   * what the tile format exists to avoid.
   */
  explain?: { definition: string; formula?: string; plainEnglish: string };
}) {
  return (
    <div className="stat-tile">
      <div className="stat-tile__label">
        {label}
        {explain && <QuantEducationalTooltip term={label} {...explain} />}
      </div>
      <div className="num stat-tile__value" data-tone={tone}>
        {value}
      </div>
      {note && <div className="stat-tile__note">{note}</div>}
    </div>
  );
}

/**
 * Memoised, with a caveat worth stating rather than hiding: `value` is a
 * ReactNode, and a caller that inlines `<NumberTicker …/>` hands a new element
 * object on every parent render, which no shallow comparison can see through.
 * The skip therefore lands for the tiles whose value is a string or a number —
 * most of a row, most of the time — and for the rest the memo on NumberTicker
 * itself is what stops the repaint one level down. `explain`, when it is an
 * object literal at the call site, defeats it the same way.
 */
export default memo(StatTile);
