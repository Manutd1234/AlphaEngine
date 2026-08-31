"use client";

import { useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { probLabel, toUnit } from "@/lib/coherence/decimals";
import { priceLabel } from "@/lib/coherence/fixed-point";
import { parlayName } from "@/lib/coherence/parlay-name";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import styles from "./CombosTables.module.css";

type MarkerKind = "lower" | "upper" | "quote" | "independence";

interface MarkerReading {
  kind: MarkerKind;
  value: number;
  symbol: string;
  detail: string;
}

type MarkerStyle = CSSProperties & { "--range-position": string };
type BandStyle = CSSProperties & { "--range-start": string; "--range-width": string };

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function marker(
  kind: MarkerKind,
  value: number | null,
  symbol: string,
  detail: string,
): MarkerReading | null {
  return value == null ? null : { kind, value, symbol, detail };
}

function markerStyle(value: number): MarkerStyle {
  return { "--range-position": `${clamp(value) * 100}%` };
}

function edge(value: number): "start" | "middle" | "end" {
  if (value <= 0.08) return "start";
  if (value >= 0.92) return "end";
  return "middle";
}

/** One selected parlay, inspectable on the same [0,1] domain as its bounds. */
export default function FrechetInstrument({ combo }: { combo: CoherenceCombo | null }) {
  const [inspected, setInspected] = useState<MarkerKind>("quote");

  if (combo == null) {
    return <p className={styles.empty}>No loaded parlay matches the local controls.</p>;
  }

  const lower = toUnit(combo.lower_bound);
  const upper = toUnit(combo.upper_bound);
  const quote = toUnit(combo.price);
  const independence = toUnit(combo.independence);
  const lowerText = probLabel(combo.lower_bound);
  const upperText = probLabel(combo.upper_bound);
  const quoteText = priceLabel(combo.price);
  const independenceText = probLabel(combo.independence);
  const validBand = lower != null && upper != null && lower <= upper;
  const readings = [
    marker("lower", lower, "L", `Lower bound: ${lowerText}`),
    marker("upper", upper, "U", `Upper bound: ${upperText}`),
    marker("quote", quote, "Q", `Quoted price: ${quoteText} on ${combo.price_basis || "an unspecified basis"}`),
    marker("independence", independence, "Π", `Leg-product reference: ${independenceText}`),
  ].filter((reading): reading is MarkerReading => reading != null);
  const active = readings.find((reading) => reading.kind === inspected) || readings[0] || null;
  const bandStyle: BandStyle | null = validBand
    ? {
        "--range-start": `${clamp(lower) * 100}%`,
        "--range-width": `${Math.max(0, clamp(upper) - clamp(lower)) * 100}%`,
      }
    : null;

  return (
    <figure className={styles.instrument}>
      <figcaption className={styles.instrumentCaption}>
        <span>
          Selected range: <strong>{parlayName(combo)}</strong>{" "}
          <code className="coh-combo__ticker">{combo.ticker}</code>
        </span>
        <span className={styles.instrumentState}>
          {combo.inside_band == null ? "◌ range unavailable" : combo.inside_band ? "● quote inside range" : "▲ quote outside range"}
        </span>
      </figcaption>

      <div
        className={styles.range}
        role="group"
        aria-label={`Allowed price range from zero to one for ${parlayName(combo)}. Focus a marker to inspect it.`}
      >
        <div className={styles.rangeTrack} aria-hidden="true" />
        {bandStyle ? <div className={styles.rangeBand} style={bandStyle} aria-hidden="true" /> : null}
        {readings.map((reading) => (
          <Button
            key={reading.kind}
            type="button"
            variant="outline"
            size="icon-xs"
            className={`${styles.marker} ${styles[`${reading.kind}Marker`]}`}
            style={markerStyle(reading.value)}
            data-edge={edge(reading.value)}
            aria-label={reading.detail}
            aria-pressed={active?.kind === reading.kind}
            onPointerEnter={() => setInspected(reading.kind)}
            onClick={() => setInspected(reading.kind)}
            onFocus={() => setInspected(reading.kind)}
          >
            <span aria-hidden="true">{reading.symbol}</span>
          </Button>
        ))}
        <span className={styles.rangeZero}>0</span>
        <span className={styles.rangeOne}>1</span>
      </div>

      <output className={styles.rangeReadout} aria-live="polite" aria-atomic="true">
        {active?.detail || "No lower bound, upper bound, quote or independence product was returned."}
      </output>
      {/* Preserve the constant sentence's wrapped footprint across selections. */}
      <p
        className={styles.rangeMissing}
        data-active={validBand ? "false" : "true"}
        aria-hidden={validBand ? true : undefined}
        style={{ visibility: validBand ? "hidden" : "visible" }}
      >
        Range unavailable because a bound is missing or invalid.
      </p>

      <dl className={styles.rangeFacts}>
        <div><dt>Lower</dt><dd>{lowerText}</dd></div>
        <div><dt>Upper</dt><dd>{upperText}</dd></div>
        <div><dt>Quote</dt><dd>{quoteText}</dd></div>
        <div><dt>Leg product Πpᵢ</dt><dd>{independenceText}</dd></div>
      </dl>
    </figure>
  );
}
