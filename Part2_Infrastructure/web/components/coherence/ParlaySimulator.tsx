"use client";

import { useId, useState, type CSSProperties } from "react";

import { Button } from "@/components/ui/button";
import { probLabel } from "@/lib/coherence/decimals";
import { DOLLAR_CC, fromCenticents } from "@/lib/coherence/fixed-point";
import { parlayName } from "@/lib/coherence/parlay-name";
import {
  CENT_CC,
  centStepDomain,
  parlaySimulationKey,
  parlaySimulationSource,
  probabilityCc,
  simulateParlay,
  type ParlaySimulationMode,
  type ParlaySimulationSource,
  type SimulationReading,
} from "@/lib/coherence/parlay-simulation";
import type { CoherenceCombo } from "@/lib/coherence/types-lab";
import styles from "./ParlaySimulator.module.css";

type PositionStyle = CSSProperties & { "--position": string };
type BandStyle = CSSProperties & { "--band-start": string; "--band-width": string };

const ccText = (value: number | null) => value == null ? "—" : (fromCenticents(value) as string);
const dollarText = (value: number | null) => value == null ? "unavailable" : "$" + ccText(value);
const productText = (value: number | null) => value == null
  ? "—"
  : `≈${fromCenticents(Math.round(value * DOLLAR_CC))}`;
const positionStyle = (value: number): PositionStyle => ({ "--position": `${(value / DOLLAR_CC) * 100}%` });
const productStyle = (value: number): PositionStyle => ({ "--position": `${value * 100}%` });

function validBand(
  reading: SimulationReading,
): reading is SimulationReading & { lowerCc: number; upperCc: number } {
  return reading.lowerCc != null && reading.upperCc != null && reading.lowerCc <= reading.upperCc;
}

function BandLane({ label, reading, simulated }: {
  label: string;
  reading: SimulationReading;
  simulated: boolean;
}) {
  const bandIsValid = validBand(reading);
  const bandStyle: BandStyle | undefined = bandIsValid ? {
    "--band-start": `${(reading.lowerCc / DOLLAR_CC) * 100}%`,
    "--band-width": `${((reading.upperCc - reading.lowerCc) / DOLLAR_CC) * 100}%`,
  } : undefined;

  return (
    <div className={styles.lane} data-simulated={simulated || undefined}>
      <strong className={styles.laneLabel}>{label}</strong>
      <div className={styles.track} aria-hidden="true">
        <span className={styles.trackLine} />
        {bandStyle ? (
          <span
            className={styles.band}
            style={bandStyle}
            title={`${label} band ${ccText(reading.lowerCc)} to ${ccText(reading.upperCc)}`}
          />
        ) : (
          <span className={styles.bandMissing}>Band unavailable</span>
        )}
        {reading.quoteCc == null ? null : (
          <span
            className={`${styles.marker} ${styles.quoteMarker}`}
            style={positionStyle(reading.quoteCc)}
            title={`${label} quote ${ccText(reading.quoteCc)}`}
          >Q</span>
        )}
        {reading.independence == null ? null : (
          <span
            className={`${styles.marker} ${styles.independenceMarker}`}
            style={productStyle(reading.independence)}
            title={`${label} independence ${productText(reading.independence)}`}
          >Π</span>
        )}
      </div>
    </div>
  );
}

function Fact({ term, live, simulated }: { term: string; live: string; simulated: string }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>
        <span><small>Market</small>{live}</span>
        <span><small>What-if</small>{simulated}</span>
      </dd>
    </div>
  );
}

function RangeControl({ id, label, detail, value, origin, noticeId, onChange }: {
  id: string;
  label: string;
  detail: string;
  value: number;
  origin: number;
  noticeId: string;
  onChange: (value: number) => void;
}) {
  const domain = centStepDomain(origin);
  return (
    <label className={styles.control} htmlFor={id}>
      <span className={styles.controlHead}>
        <strong>{label}</strong>
        <output htmlFor={id}>{ccText(value)}</output>
      </span>
      <small>{detail}</small>
      <input
        id={id}
        type="range"
        min={domain.minCc}
        max={domain.maxCc}
        step={CENT_CC}
        value={value}
        aria-describedby={noticeId}
        aria-valuetext={dollarText(value)}
        onChange={(event) => {
          const next = probabilityCc(Number(event.currentTarget.value));
          if (next != null) onChange(next);
        }}
      />
    </label>
  );
}

function simulationResult(
  mode: ParlaySimulationMode,
  source: ParlaySimulationSource,
  simulated: SimulationReading,
): string {
  if (mode === "quote") {
    if (source.live.quoteCc == null) {
      return "The live parlay quote is unavailable, so no local starting value is invented.";
    }
    if (!validBand(source.live) || simulated.quoteCc == null) {
      return "The local quote can move, but the live band is unavailable and no comparison is claimed.";
    }
    const position = simulated.quoteCc < source.live.lowerCc
      ? "below"
      : simulated.quoteCc > source.live.upperCc ? "above" : "inside";
    return `${dollarText(simulated.quoteCc)} is ${position} the fixed live band.`;
  }

  if (source.legs.length === 0) {
    return "No required legs were returned, so no simulated band is calculated.";
  }
  const missing = source.legs.filter((leg) => leg.probabilityCc == null).length;
  if (missing) {
    return `${missing} unquoted required ${missing === 1 ? "side blocks" : "sides block"} every simulated bound; no zero is substituted.`;
  }
  return `The band and independence marker are recalculated from ${source.legs.length} local required-side probabilities.`;
}

function SimulatorSession({ combo, mode, source }: {
  combo: CoherenceCombo;
  mode: ParlaySimulationMode;
  source: ParlaySimulationSource;
}) {
  const rootId = useId();
  const noticeId = `${rootId}-notice`;
  const [quoteCc, setQuoteCc] = useState(source.live.quoteCc);
  const [legValues, setLegValues] = useState(() => source.legs.map((leg) => leg.probabilityCc));
  const simulated = simulateParlay(source, mode, quoteCc, legValues);
  const changed = mode === "quote"
    ? quoteCc !== source.live.quoteCc
    : legValues.some((value, index) => value !== source.legs[index]?.probabilityCc);
  const reset = () => {
    setQuoteCc(source.live.quoteCc);
    setLegValues(source.legs.map((leg) => leg.probabilityCc));
  };
  const setLeg = (index: number, value: number) => setLegValues((current) =>
    current.map((item, at) => at === index ? value : item));
  const result = simulationResult(mode, source, simulated);
  const ariaSummary = [
    `Live band ${dollarText(source.live.lowerCc)} to ${dollarText(source.live.upperCc)}`,
    `quote ${dollarText(source.live.quoteCc)}, independence ${productText(source.live.independence)}.`,
    `Simulated band ${dollarText(simulated.lowerCc)} to ${dollarText(simulated.upperCc)}`,
    `quote ${dollarText(simulated.quoteCc)}, independence ${productText(simulated.independence)}.`,
  ].join(", ");

  return (
    <figure className={styles.simulator} aria-labelledby={`${rootId}-title`}>
      <header className={styles.head}>
        <span><small>What-if tool</small><strong id={`${rootId}-title`}>{mode === "quote" ? "Try a quote" : "Try leg prices"}</strong></span>
        <Button type="button" variant="outline" size="sm" disabled={!changed} onClick={reset}>Reset</Button>
      </header>
      <p id={noticeId} className={styles.notice}><strong>Local only.</strong> Market data does not change. Each step is $0.01; arrow keys work.</p>

      <div className={styles.diagram} role="img" aria-label={`${parlayName(combo)}. ${ariaSummary}`}>
        <BandLane label="Market" reading={source.live} simulated={false} />
        <BandLane label="What-if" reading={simulated} simulated />
        <div className={styles.axis} aria-hidden="true"><span>$0</span><span>Q quote; Π leg product</span><span>$1</span></div>
      </div>

      <output className={styles.result} aria-live="polite" aria-atomic="true">{result}</output>

      <div className={styles.controls}>
        {mode === "quote" ? (
          quoteCc == null ? <p className={styles.unavailable}>Quote control unavailable. The live parlay has no quoted price.</p> : (
            <RangeControl id={`${rootId}-quote`} label="Parlay quote" detail={combo.price_basis ? `Live basis: ${combo.price_basis}` : "Live basis unavailable"} value={quoteCc} origin={source.live.quoteCc as number} noticeId={noticeId} onChange={setQuoteCc} />
          )
        ) : source.legs.map((leg, index) => leg.probabilityCc == null ? (
          <div className={styles.unavailable} key={leg.key}>
            <strong>{leg.label || leg.ticker}</strong><code>{leg.ticker}</code>
            <span>Required {leg.side.toUpperCase()} side unquoted; no control is drawn.</span>
          </div>
        ) : (
          <RangeControl key={leg.key} id={`${rootId}-leg-${index}`} label={leg.label || leg.ticker} detail={`${leg.ticker}; must land ${leg.side.toUpperCase()}`} value={legValues[index] as number} origin={leg.probabilityCc} noticeId={noticeId} onChange={(value) => setLeg(index, value)} />
        ))}
      </div>

      <dl className={styles.facts}>
        <Fact term="Minimum" live={ccText(source.live.lowerCc)} simulated={ccText(simulated.lowerCc)} />
        <Fact term="Maximum" live={ccText(source.live.upperCc)} simulated={ccText(simulated.upperCc)} />
        <Fact term="Quote" live={ccText(source.live.quoteCc)} simulated={ccText(simulated.quoteCc)} />
        <Fact term="Leg product" live={source.live.independence == null ? "—" : probLabel(combo.independence)} simulated={productText(simulated.independence)} />
      </dl>
    </figure>
  );
}

export function ParlaySimulator({ combo, mode }: { combo: CoherenceCombo; mode: "quote" | "legs" }) {
  const source = parlaySimulationSource(combo);
  return <SimulatorSession key={parlaySimulationKey(combo, mode)} combo={combo} mode={mode} source={source} />;
}
