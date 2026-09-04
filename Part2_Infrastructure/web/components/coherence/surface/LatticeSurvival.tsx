"use client";

import { useId, useState, type CSSProperties } from "react";

import { DOLLAR_CC, fromCenticents, priceLabel, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { useRovingListbox } from "../use-stable-selection-key";
import CategoricalProbabilityBars from "./CategoricalProbabilityBars";

import styles from "./LatticeInstruments.module.css";

interface SurvivalVisualPoint {
  key: string;
  x: number;
  y: number;
  valueCc: number | null;
}

/** A quoted survival surface is a step function: never smooth the gaps. */
function survivalStepPath(points: readonly SurvivalVisualPoint[]): string {
  if (!points.length) return "";
  let path = `M${points[0].x.toFixed(2)},${points[0].y.toFixed(2)}`;
  for (let index = 1; index < points.length; index += 1) {
    path += `H${points[index].x.toFixed(2)}V${points[index].y.toFixed(2)}`;
  }
  return path;
}

function survivalAreaPath(points: readonly SurvivalVisualPoint[], floor: number): string {
  if (!points.length) return "";
  return `${survivalStepPath(points)}V${floor}H${points[0].x.toFixed(2)}Z`;
}

function contiguousSurvivalRuns(points: readonly SurvivalVisualPoint[]): SurvivalVisualPoint[][] {
  const runs: SurvivalVisualPoint[][] = [];
  let run: SurvivalVisualPoint[] | null = null;
  for (const point of points) {
    if (point.valueCc == null) {
      run = null;
      continue;
    }
    if (!run) {
      run = [];
      runs.push(run);
    }
    run.push(point);
  }
  return runs;
}

export function LatticeSurvival({ surface }: { surface: CoherenceSurface }) {
  const probes = surface.probes
    .map((probe, sourceIndex) => ({
      ...probe,
      sourceIndex,
      strikeCc: toCenticents(probe.strike),
      survivalCc: toCenticents(probe.survival),
    }))
    .sort((a, b) => a.strikeCc == null
      ? b.strikeCc == null ? a.sourceIndex - b.sourceIndex : 1
      : b.strikeCc == null ? -1 : a.strikeCc - b.strikeCc);
  const probeKeys = probes.map((probe) => JSON.stringify([probe.ticker, probe.strike]));
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(probeKeys);
  const [shockScenario, setShockScenario] = useState<{ key: string | null; pp: number }>({ key: null, pp: 0 });
  const areaGradientId = useId().replaceAll(":", "");
  const selected = Math.max(0, probeKeys.indexOf(selectedKey ?? ""));
  const active = probes[selected] ?? probes[0];
  const chooseProbe = (key: string) => {
    if (key !== selectedKey) setShockScenario({ key, pp: 0 });
    setSelectedKey(key);
  };
  if (!active) {
    if ((surface.engine === "named" || surface.engine === "independent") && surface.bins.length) {
      return <CategoricalProbabilityBars surface={surface} mode="probability" />;
    }
    return (
      <figure className={styles.instrument} data-state="unavailable" aria-label="No survival curve for this family">
        <figcaption className={styles.head}><span><small>Survival ladder</small>No threshold curve is available for this family</span><strong>{surface.engine}</strong></figcaption>
        <p className={styles.empty}>◌ {surface.detail || "No strike ladder was returned."}</p>
      </figure>
    );
  }
  const previous = selected > 0 ? probes[selected - 1] : null;
  const next = selected < probes.length - 1 ? probes[selected + 1] : null;
  const rose = active.survivalCc != null && previous?.survivalCc != null && active.survivalCc > previous.survivalCc;
  const shockMin = active.survivalCc == null
    ? 0
    : Math.max(-20, Math.min(0, Math.ceil(-active.survivalCc / 100)));
  const shockMax = active.survivalCc == null
    ? 0
    : Math.min(20, Math.max(0, Math.floor((DOLLAR_CC - active.survivalCc) / 100)));
  const storedShock = shockScenario.key === selectedKey ? shockScenario.pp : 0;
  const quoteShock = Math.max(shockMin, Math.min(shockMax, storedShock));
  const stressedCc = active.survivalCc == null
    ? null
    : Math.max(0, Math.min(DOLLAR_CC, active.survivalCc + quoteShock * 100));
  const stressHolds = stressedCc == null
    ? null
    : (previous?.survivalCc == null || stressedCc <= previous.survivalCc)
      && (next?.survivalCc == null || stressedCc >= next.survivalCc);
  const plot = { left: 70, right: 976, top: 26, floor: 286, height: 330 } as const;
  const strikes = probes.flatMap((probe) => probe.strikeCc == null ? [] : [probe.strikeCc]);
  const strikeLow = strikes.length ? Math.min(...strikes) : 0;
  const strikeHigh = strikes.length ? Math.max(...strikes) : 0;
  const strikeSpan = Math.max(1, strikeHigh - strikeLow);
  const xAt = (strikeCc: number | null, index: number) => strikeCc == null || strikeHigh === strikeLow
    ? plot.left + (index / Math.max(1, probes.length - 1)) * (plot.right - plot.left)
    : plot.left + ((strikeCc - strikeLow) / strikeSpan) * (plot.right - plot.left);
  const yAt = (valueCc: number | null) => valueCc == null
    ? plot.floor
    : plot.floor - (valueCc / DOLLAR_CC) * (plot.floor - plot.top);
  const visualPoints: SurvivalVisualPoint[] = probes.map((probe, index) => {
    const valueCc = index === selected && stressedCc != null ? stressedCc : probe.survivalCc;
    return {
      key: probeKeys[index],
      x: xAt(probe.strikeCc, index),
      y: yAt(valueCc),
      valueCc,
    };
  });
  const runs = contiguousSurvivalRuns(visualPoints);
  const scenarioViolations = visualPoints.map((point, index) => (
    index > 0
    && point.valueCc != null
    && visualPoints[index - 1].valueCc != null
    && point.valueCc > (visualPoints[index - 1].valueCc as number)
  ));
  const selectedPoint = visualPoints[selected];
  const axisLevels = [DOLLAR_CC, DOLLAR_CC * 0.75, DOLLAR_CC * 0.5, DOLLAR_CC * 0.25, 0];
  // Keep the axis as a stable domain reference. The selected strike is already
  // printed in the live readout below; repeating it here lets a near-edge
  // selection collide with the domain label.
  const labelIndexes = probes.length > 1 ? [0, probes.length - 1] : [0];
  const halfCc = DOLLAR_CC / 2;
  let halfUpperIndex = -1;
  let halfLowerIndex = -1;
  let lastReadableIndex = -1;
  for (let index = 0; index < visualPoints.length; index += 1) {
    const value = visualPoints[index].valueCc;
    if (value == null) continue;
    if (value >= halfCc) halfUpperIndex = index;
    else {
      halfLowerIndex = index;
      break;
    }
    lastReadableIndex = index;
  }
  const halfIsBracketed = halfUpperIndex >= 0 && halfLowerIndex > halfUpperIndex;
  const firstReadableIndex = visualPoints.findIndex((point) => point.valueCc != null);
  if (lastReadableIndex < 0 && firstReadableIndex >= 0) lastReadableIndex = firstReadableIndex;
  const halfReading = halfIsBracketed
    ? `The 50% crossing is bracketed by ${probes[halfUpperIndex].strike} and ${probes[halfLowerIndex].strike}; no value is invented inside that unquoted gap.`
    : halfLowerIndex >= 0
      ? `The first readable threshold, ${probes[halfLowerIndex].strike}, is already below 50%; the earlier unreadable region is not guessed.`
      : lastReadableIndex >= 0
        ? `The surface stays at or above 50% through the last readable strike, ${probes[lastReadableIndex].strike}; no out-of-range median is invented.`
        : "No readable survival quote reaches the 50% test, so the crossing is withheld.";
  return (
    <figure className={styles.instrument} aria-label={`Survival sampled at ${probes.length} strikes`}>
      <figcaption className={styles.head}>
        <span><small>Probability current</small>Follow the quoted step surface; select any node to stress its two neighbour constraints</span>
        <strong>{probes.length} live strikes</strong>
      </figcaption>
      <div className={styles.currentViewport} role="region" aria-label="Interactive quoted survival surface" tabIndex={0}>
        <div className={styles.currentCanvas}>
          <svg viewBox={`0 0 1000 ${plot.height}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={areaGradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="var(--series-1)" stopOpacity="0.24" />
                <stop offset="1" stopColor="var(--series-1)" stopOpacity="0.015" />
              </linearGradient>
            </defs>
            {axisLevels.map((level) => (
              <g key={level}>
                <line x1={plot.left} x2={plot.right} y1={yAt(level)} y2={yAt(level)} className={styles.currentGrid} data-half={level === halfCc || undefined} />
                <text x={plot.left - 12} y={yAt(level) + 4} textAnchor="end" className={styles.currentAxisLabel}>
                  {fromCenticents(level)}
                </text>
              </g>
            ))}
            {runs.map((run, index) => (
              <path key={`area-${run[0]?.key ?? index}`} d={survivalAreaPath(run, plot.floor)} fill={`url(#${areaGradientId})`} className={styles.currentArea} />
            ))}
            {runs.map((run, index) => (
              <path key={`line-${run[0]?.key ?? index}`} d={survivalStepPath(run)} className={styles.currentLine} />
            ))}
            {halfIsBracketed ? (
              <g>
                <rect
                  x={visualPoints[halfUpperIndex].x}
                  y={yAt(halfCc) - 6}
                  width={Math.max(2, visualPoints[halfLowerIndex].x - visualPoints[halfUpperIndex].x)}
                  height="12"
                  className={styles.halfBracket}
                />
                <text
                  x={(visualPoints[halfUpperIndex].x + visualPoints[halfLowerIndex].x) / 2}
                  y={yAt(halfCc) - 11}
                  textAnchor="middle"
                  className={styles.halfLabel}
                >
                  50% crossing
                </text>
              </g>
            ) : null}
            {scenarioViolations.map((violation, index) => {
              if (!violation) return null;
              const prior = visualPoints[index - 1];
              const point = visualPoints[index];
              const middle = (prior.x + point.x) / 2;
              const lift = Math.max(plot.top + 8, Math.min(prior.y, point.y) - 24);
              return (
                <path
                  key={`violation-${point.key}`}
                  d={`M${prior.x},${prior.y} Q${middle},${lift} ${point.x},${point.y}`}
                  className={styles.violationArc}
                />
              );
            })}
            {selectedPoint?.valueCc != null ? (
              <>
                <line x1={selectedPoint.x} x2={selectedPoint.x} y1={plot.top} y2={plot.floor} className={styles.selectedBeam} />
                <circle cx={selectedPoint.x} cy={selectedPoint.y} r="13" className={styles.selectedHalo} />
              </>
            ) : null}
            {labelIndexes.map((index) => (
              <g key={`strike-${probeKeys[index]}`}>
                <line x1={visualPoints[index].x} x2={visualPoints[index].x} y1={plot.floor} y2={plot.floor + 6} className={styles.currentTick} />
                <text
                  x={visualPoints[index].x}
                  y={plot.floor + 24}
                  textAnchor={index === 0 ? "start" : index === probes.length - 1 ? "end" : "middle"}
                  className={styles.currentAxisLabel}
                >
                  {probes[index].strike}
                </text>
              </g>
            ))}
          </svg>
          <div className={styles.probeLayer} role="listbox" aria-label="Quoted survival thresholds">
            {probes.map((probe, index) => {
              const props = optionProps(probeKeys[index], index);
              const point = visualPoints[index];
              const violation = scenarioViolations[index];
              return (
                <button
                  key={probeKeys[index]}
                  type="button"
                  role="option"
                  aria-selected={selectedKey === probeKeys[index]}
                  aria-label={`${probe.label}; strike ${probe.strike}; probability ${priceLabel(probe.survival)}${violation ? "; rises above its lower neighbour" : ""}`}
                  title={`${probe.strike}, ${priceLabel(probe.survival)}${violation ? ", monotonicity violation" : ""}`}
                  className={styles.probeNode}
                  data-violation={violation || undefined}
                  data-unreadable={point.valueCc == null || undefined}
                  style={{
                    "--probe-x": `${(point.x / 10).toFixed(4)}%`,
                    "--probe-y": `${((point.y / plot.height) * 100).toFixed(4)}%`,
                  } as CSSProperties}
                  tabIndex={props.tabIndex}
                  onKeyDown={props.onKeyDown}
                  onPointerEnter={() => chooseProbe(probeKeys[index])}
                  onFocus={() => chooseProbe(probeKeys[index])}
                  onClick={() => chooseProbe(probeKeys[index])}
                >
                  <span className="sr-only">{probe.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <section className={styles.stressLab} aria-label="Local quote-shock simulator">
        <div><small>Local shock simulator</small><strong>Pull the illuminated node</strong><p>The current redraws immediately while the recorded quote remains unchanged.</p></div>
        <label><span>Quote shock, {shockMin} to +{shockMax}pp</span><input type="range" min={shockMin} max={shockMax} step={1} value={quoteShock} disabled={active.survivalCc == null}
          onChange={(event) => setShockScenario({ key: selectedKey, pp: Number(event.target.value) })} aria-label="Selected survival quote shock in percentage points" /></label>
        <output aria-live="polite" aria-atomic="true" data-holds={stressHolds == null ? "unknown" : stressHolds ? "yes" : "no"}>
          <strong className="num">{quoteShock > 0 ? "+" : ""}{quoteShock}pp → {fromCenticents(stressedCc) ?? "—"}</strong>
          <span>{stressHolds == null ? "withheld" : stressHolds ? "✓ locally coherent" : "▲ breaks a neighbour constraint"}</span>
        </output>
      </section>
      <output className={styles.readout} aria-live="polite" aria-atomic="true">
        <span><small>Selected strike</small><strong className="num">{active.strike}</strong><span className={styles.readoutNote}>{active.label}</span></span>
        <span><small>Recorded → scenario</small><strong className="num">{priceLabel(active.survival)} → {fromCenticents(stressedCc) ?? "—"}</strong><span className={styles.readoutNote}>{active.origin === "ceiling" ? "Recorded by inverting the quoted ceiling market." : "Recorded directly from the quoted threshold market."}</span></span>
        <span><small>Local test</small><strong>{stressHolds === false ? "▲ contradiction" : selected === 0 ? "first quote" : "✓ non-increasing"}</strong><span className={styles.readoutNote}>{stressHolds === false ? "The scenario crosses at least one quoted neighbour." : rose ? "The recorded quote rises, but this scenario no longer does." : "The selected probability stays between its quoted neighbours."}</span></span>
      </output>
      <p className={`${styles.curveReading} coh-figure__reading`}>{halfReading} The terraces are quoted thresholds, never interpolated points.</p>
      {surface.detail ? (
        <p className={`${styles.samplingNote} coh-figure__missing`}>
          <span className={styles.noteMark} aria-hidden="true">i</span>
          <span>{surface.detail}</span>
        </p>
      ) : null}
    </figure>
  );
}
