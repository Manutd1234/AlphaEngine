"use client";

import type { ReactNode } from "react";

import QuantEducationalTooltip from "@/components/common/QuantEducationalTooltip";

/** A single number is not a chart. These are stat tiles, not one-bar bar charts. */
export default function StatTile({
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
