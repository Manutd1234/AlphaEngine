"use client";

import { useState, type CSSProperties } from "react";

import { DOLLAR_CC, fromCenticents, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { fmt } from "@/lib/format";

import styles from "./LatticeInstruments.module.css";

/**
 * A categorical family has useful live probabilities but no numeric x-axis.
 * Draw every quote as a probability bar instead of manufacturing coordinates
 * so the Survival and Moment-shape views still carry data without claiming a
 * mean, skew, or ordering the venue never published.
 */
export default function CategoricalProbabilityBars({
  surface,
  mode,
}: {
  surface: CoherenceSurface;
  mode: "probability" | "concentration";
}) {
  const rows = surface.bins.map((bin) => ({
    ...bin,
    key: JSON.stringify([bin.label, bin.mass]),
    cc: toCenticents(bin.mass),
  }));
  const [selectedKey, setSelectedKey] = useState(rows[0]?.key ?? "");
  const active = rows.find((row) => row.key === selectedKey) ?? rows[0];
  const readable = rows.filter((row) => row.cc != null && row.cc >= 0);
  const leader = readable.reduce<typeof readable[number] | null>(
    (best, row) => best == null || (row.cc as number) > (best.cc as number) ? row : best,
    null,
  );
  const totalCc = surface.engine === "named" && readable.length === rows.length
    ? readable.reduce((sum, row) => sum + (row.cc as number), 0)
    : null;
  const concentration = totalCc != null && totalCc > 0
    ? readable.reduce((sum, row) => sum + ((row.cc as number) / totalCc) ** 2, 0)
    : null;
  const effectiveOutcomes = concentration ? 1 / concentration : null;
  const activeShare = totalCc != null && totalCc > 0 && active?.cc != null
    ? active.cc / totalCc * 100
    : null;
  const isIndependent = surface.engine === "independent";
  const title = mode === "concentration"
    ? "Categorical probability shape — numeric moments do not apply"
    : isIndependent
      ? "Separate YES probabilities — no joint distribution is asserted"
      : "Quoted probability by named outcome";

  if (!active) return <p className={styles.empty}>◌ No quoted probability was returned.</p>;

  return (
    <figure className={styles.instrument} aria-label={`${rows.length} categorical probability bars`}>
      <figcaption className={styles.head}>
        <span><small>{mode === "concentration" ? "Categorical concentration" : "Probability bars"}</small>{title}</span>
        <strong>{rows.length} live {rows.length === 1 ? "market" : "markets"}</strong>
      </figcaption>
      <div className={styles.categoryPlot} role="listbox" aria-label="Select a quoted outcome probability">
        {rows.map((row, index) => {
          const width = row.cc == null ? 0 : Math.max(0, Math.min(100, row.cc / DOLLAR_CC * 100));
          return (
            <button
              key={row.key}
              type="button"
              role="option"
              aria-selected={row.key === active.key}
              aria-label={`${row.label}: ${priceLabel(row.mass)}`}
              onClick={() => setSelectedKey(row.key)}
              className={styles.categoryRow}
              style={{ "--category-width": `${width}%` } as CSSProperties}
            >
              <span className={styles.categoryIndex}>{index + 1}</span>
              <span className={styles.categoryLabel}>{row.label}</span>
              <span className={styles.categoryTrack} aria-hidden="true"><i /></span>
              <strong className="num">{priceLabel(row.mass)}</strong>
            </button>
          );
        })}
      </div>
      <div className={styles.readout}>
        <span><small>Selected outcome</small><strong>{active.label}</strong><span className={styles.readoutNote}>{activeShare == null ? "One market's YES contract." : `${fmt(activeShare, 2)}% of the quoted family total.`}</span></span>
        <span><small>Quoted YES probability</small><strong className="num">{priceLabel(active.mass)}</strong><span className={styles.readoutNote}>Read from the {surface.basis ?? "available"} of the live book.</span></span>
        <span><small>{isIndependent ? "Joint total" : "Concentration"}</small><strong>{isIndependent ? "not additive" : effectiveOutcomes == null ? "withheld" : `${fmt(effectiveOutcomes, 2)} effective outcomes`}</strong><span className={styles.readoutNote}>{isIndependent ? "The venue publishes no mutual-exclusivity relation, so these bars must not be summed." : `Leader: ${leader?.label ?? "unreadable"} at ${fromCenticents(leader?.cc ?? null) ?? "—"}.`}</span></span>
      </div>
      <p className={`${styles.curveReading} coh-figure__reading`}>
        {mode === "concentration"
          ? "Names have no numeric distance, so mean, standard deviation, skewness and kurtosis are undefined. The live categorical shape is shown instead."
          : isIndependent
            ? "Each bar is a live standalone YES probability. No ordering, interpolation, or common probability mass is invented."
            : "These bars are live named-outcome probabilities; their order is the venue's listing order, not a numeric axis."}
      </p>
      {surface.detail ? <p className={styles.samplingNote}><span className={styles.noteMark} aria-hidden="true">i</span><span>{surface.detail}</span></p> : null}
    </figure>
  );
}
