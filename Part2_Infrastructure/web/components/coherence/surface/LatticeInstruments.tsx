"use client";

import { useId, useState } from "react";

import { decimalLabel } from "@/lib/coherence/decimals";
import { fromCenticents, priceLabel, sumPrices, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceSurface } from "@/lib/coherence/types-lab";
import { fmt } from "@/lib/format";
import { useRovingListbox } from "../use-stable-selection-key";

import styles from "./LatticeInstruments.module.css";

export { LatticeSurvival } from "./LatticeSurvival";

function number(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function LatticeMass({ surface }: { surface: CoherenceSurface }) {
  const bins = surface.bins.map((bin) => ({
    ...bin,
    key: JSON.stringify([bin.label, bin.low, bin.high]),
    cc: toCenticents(bin.mass),
  }));
  const binKeys = bins.map((bin) => bin.key);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(binKeys);
  const [shiftScenario, setShiftScenario] = useState<{ key: string | null; cc: number }>({ key: null, cc: 0 });
  const titleId = useId();
  const selected = Math.max(0, binKeys.indexOf(selectedKey ?? ""));
  const active = bins[selected] ?? bins[0];
  const chooseBin = (key: string) => {
    if (key !== selectedKey) setShiftScenario({ key, cc: 0 });
    setSelectedKey(key);
  };
  if (!active) return <p className={styles.empty}>◌ No implied mass was returned.</p>;
  const neighbourIndex = selected < bins.length - 1 ? selected + 1 : Math.max(0, selected - 1);
  const neighbour = bins[neighbourIndex];
  const maxShiftCc = active.cc == null || active.cc <= 0 || neighbour?.cc == null || neighbourIndex === selected ? 0 : Math.floor(active.cc * 0.25);
  const shiftCc = shiftScenario.key === selectedKey ? shiftScenario.cc : 0;
  const setShiftCc = (cc: number) => setShiftScenario({ key: selectedKey, cc });
  const movedCc = Math.min(shiftCc, maxShiftCc);
  const scenario = bins.map((bin, index) => ({ ...bin, scenarioCc: bin.cc == null ? null
    : index === selected ? bin.cc - movedCc : index === neighbourIndex ? bin.cc + movedCc : bin.cc }));
  const positives = scenario.map((bin) => bin.scenarioCc != null && bin.scenarioCc > 0 ? bin.scenarioCc : 0);
  const negatives = scenario.map((bin) => bin.scenarioCc != null && bin.scenarioCc < 0 ? -bin.scenarioCc : 0);
  const peak = Math.max(1, ...positives);
  const negativePeak = Math.max(0, ...negatives);
  const base = negativePeak ? 184 : 220;
  const top = 26;
  const floor = 246;
  const left = 54;
  const width = 914;
  const slot = width / scenario.length;
  const totalCc = scenario.every((bin) => bin.scenarioCc != null)
    ? scenario.reduce((sum, bin) => sum + (bin.scenarioCc as number), 0) : null;
  const cumulativeTotal = totalCc != null && totalCc > 0 ? totalCc : null;
  const cumulativeUnavailable = totalCc == null ? "an interval is unreadable" : totalCc <= 0 ? "quoted total is not positive" : null;
  let cumulative = 0;
  let cumulativeClipped = false;
  const cumulativePoints = cumulativeTotal == null ? null : scenario.map((bin, index) => {
    cumulative += bin.scenarioCc as number;
    const share = cumulative / cumulativeTotal;
    const visibleShare = Math.max(0, Math.min(1, share));
    if (visibleShare !== share) cumulativeClipped = true;
    const y = base - visibleShare * (base - top);
    return `${left + slot * (index + 0.5)},${y}`;
  }).join(" ");
  const isLadder = surface.engine === "ladder";
  const isDirect = surface.engine === "bucket" || surface.engine === "named";
  const method = isLadder
    ? "Bars are adjacent-survival differences; the line accumulates them"
    : isDirect
      ? "Bars are directly quoted interval mass; the line accumulates them"
      : "Bars are the interval masses returned by this surface; the line accumulates them";
  const formula = isLadder
    ? selected === 0 ? `1 − S(${surface.probes[0]?.strike ?? "k₀"})`
      : selected === bins.length - 1 ? `S(${surface.probes.at(-1)?.strike ?? "kₙ"})`
        : `S(${surface.probes[selected - 1]?.strike ?? "kᵢ"}) − S(${surface.probes[selected]?.strike ?? "kᵢ₊₁"})`
    : isDirect ? `q(${active.label})` : `m(${active.label})`;
  const status = surface.negative_bins.length
    ? `${surface.negative_bins.length} negative`
    : isLadder ? "monotone" : "non-negative";
  return (
    <figure className={styles.instrument} aria-labelledby={titleId}>
      <figcaption className={styles.head}>
        <span id={titleId}><small>Mass transport graph</small>{method}</span>
        <strong>{status}</strong>
      </figcaption>
      <div className={styles.massPlot} role="img" tabIndex={0} aria-label={`Histogram of ${bins.length} intervals; ${cumulativePoints ? cumulativeClipped ? "cumulative mass line clipped to its zero-to-one axis" : "cumulative mass line shown" : `cumulative mass unavailable because ${cumulativeUnavailable}`}; selected ${active.label}`}>
        <svg viewBox="0 0 1000 280" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <line x1={left} x2={left + width} y1={base} y2={base} className={styles.zeroLine} />
          <line x1={left} x2={left + width} y1={top} y2={top} className={styles.gridLine} />
          <text x={left - 8} y={top + 4} textAnchor="end" className={styles.axisText}>{fromCenticents(peak)}</text>
          <text x={left - 8} y={base + 4} textAnchor="end" className={styles.axisText}>0</text>
          {negativePeak ? <text x={left - 8} y={floor} textAnchor="end" className={styles.axisText}>−{fromCenticents(negativePeak)}</text> : null}
          {scenario.map((bin, index) => {
            const value = bin.scenarioCc;
            const x = left + index * slot + slot * 0.18;
            const barWidth = Math.max(2, slot * 0.64);
            const height = value == null ? 0 : value >= 0 ? (value / peak) * (base - top) : (-value / Math.max(1, negativePeak)) * (floor - base);
            const y = value == null ? base : value >= 0 ? base - height : base;
            return <g key={bin.key} data-selected={index === selected || undefined} className={styles.massMark}>
              <title>{`${bin.label}: recorded ${priceLabel(bin.mass)}, local what-if ${fromCenticents(value) ?? "unreadable"}`}</title>
              {value == null ? <text x={x + barWidth / 2} y={base - 8} textAnchor="middle" className={styles.axisText}>◌</text>
                : <rect x={x} y={y} width={barWidth} height={Math.max(1.5, height)} className={value < 0 ? styles.negativeBar : styles.massBar} />}
              {(bins.length <= 10 || index === selected || index === 0 || index === bins.length - 1)
                ? <text x={x + barWidth / 2} y={268} textAnchor="middle" className={styles.tickText}>{index + 1}</text> : null}
            </g>;
          })}
          {cumulativePoints ? <>
            <line x1={left + width} x2={left + width} y1={top} y2={base} className={styles.cumulativeAxis} />
            <text x={left + width - 6} y={top + 13} textAnchor="end" className={styles.cumulativeAxisText}>Σ 100%</text>
            <text x={left + width - 6} y={base - 6} textAnchor="end" className={styles.cumulativeAxisText}>Σ 0%</text>
            <polyline points={cumulativePoints} className={styles.cumulativeLine} />
          </> : <text x={left + width} y={top + 14} textAnchor="end" className={styles.lineLabel}>cumulative unavailable: {cumulativeUnavailable}</text>}
        </svg>
      </div>
      <div className={styles.plotLegend} aria-hidden="true"><span data-legend="bar">mass by interval</span><span data-legend="line">{cumulativePoints ? cumulativeClipped ? "cumulative share, clipped to 0–100%" : "cumulative share of quoted total" : "cumulative unavailable"}</span><span>▽ negative is a contradiction</span></div>
      <div className={styles.massScrubber} role="listbox" aria-label="Select an interval to inspect and simulate">
        {bins.map((bin, index) => {
          const props = optionProps(binKeys[index], index);
          return <button key={bin.key} type="button" role="option" aria-selected={selectedKey === binKeys[index]}
            className={styles.massTile} title={`${bin.label}: ${priceLabel(bin.mass)}`} tabIndex={props.tabIndex}
            onKeyDown={props.onKeyDown} onFocus={() => chooseBin(binKeys[index])}
            onClick={() => chooseBin(binKeys[index])}><span>{index + 1}</span><small>{bin.label}</small></button>;
        })}
      </div>
      <section className={styles.simulator} aria-label="Local adjacent-mass transfer simulator">
        <div><small>Local what-if</small><strong>Move selected mass → {neighbour?.label ?? "no neighbour"}</strong><p>Preserves total mass and never changes the recorded book.</p></div>
        <label><span>Transfer, up to 25%</span><input type="range" min={0} max={maxShiftCc} step={1} value={movedCc} disabled={!maxShiftCc}
          onChange={(event) => setShiftCc(Number(event.target.value))} aria-label="Mass to move from the selected interval in centicents" /></label>
        <button type="button" onClick={() => setShiftCc(0)} disabled={!movedCc}>Reset</button>
      </section>
      <div className={styles.readout}>
        <span><small>Selected interval</small><strong>{active.label}</strong><span className={styles.readoutNote}><code>{formula}</code></span></span>
        <span><small>Recorded exact</small><strong className="num">{priceLabel(active.mass)}</strong><span className={styles.readoutNote}>{active.low ?? "−∞"} to {active.high ?? "+∞"}</span></span>
        <span><small>Local what-if</small><strong className="num">{fromCenticents(scenario[selected]?.scenarioCc ?? null) ?? "—"}</strong><span className={styles.readoutNote}>{movedCc ? `${fromCenticents(movedCc)} moved; Σ remains ${fromCenticents(totalCc) ?? "—"}.` : "At recorded mass; move the slider to test the adjacent interval."}</span></span>
      </div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        Local what-if for {active.label}: {fromCenticents(scenario[selected]?.scenarioCc ?? null) ?? "unreadable"}. {movedCc ? `${fromCenticents(movedCc)} moved to ${neighbour?.label ?? "the adjacent interval"}; total remains ${fromCenticents(totalCc) ?? "unreadable"}.` : "No mass moved."}
      </output>
      <p className="coh-figure__reading">Negative bars extend below zero: they are contradictions, not small probabilities. A zero-height mark is a measured zero; ◌ is unreadable.</p>
    </figure>
  );
}

export function LatticeMoments({ surface }: { surface: CoherenceSurface }) {
  const points = surface.bins.flatMap((bin) => {
    const x = number(bin.representative);
    const cc = toCenticents(bin.mass);
    return x == null || cc == null || cc <= 0 ? [] : [{ key: JSON.stringify([bin.label, bin.representative]), label: bin.label, x, cc }];
  }).sort((a, b) => a.x - b.x);
  const [tilt, setTilt] = useState(0);
  const moments = [
    { key: "mean", label: "Centre", term: "Mean", raw: surface.mean, formula: "μ = Σwᵢxᵢ / Σwᵢ", note: "The balance point of positive bounded-bin mass." },
    { key: "sd", label: "Spread", term: "Standard deviation", raw: surface.standard_deviation, formula: "σ = √Σwᵢ(xᵢ−μ)² / Σwᵢ", note: "The shaded band spans one scenario σ either side of μ." },
    { key: "skew", label: "Lean", term: "Skewness", raw: surface.skewness, formula: "γ₁ = E[(X−μ)³] / σ³", note: "Positive pulls toward the high tail; negative pulls toward the low tail." },
    { key: "kurt", label: "Tails", term: "Excess kurtosis", raw: surface.excess_kurtosis, formula: "γ₂ = E[(X−μ)⁴] / σ⁴ − 3", note: "Above zero concentrates more weight in shoulders and tails." },
  ];
  const keys = moments.map((moment) => moment.key);
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(keys);
  const selected = Math.max(0, keys.indexOf(selectedKey ?? ""));
  const active = moments[selected];
  if (points.length < 2) {
    const named = surface.engine === "named";
    const reason = surface.moments_note
      || (named
        ? "These outcomes are names rather than numbers, so they have no mean or numeric moment axis."
        : "Fewer than two positive bounded bins sit on a numeric axis, so no moment shape can be simulated.");
    return (
      <figure className={styles.instrument} aria-label={named ? "Named outcomes have no numeric moment shape" : "No numeric moment shape is available"}>
        <figcaption className={styles.head}>
          <span><small>Moment shape simulator</small>{named ? "Named outcomes do not define a numeric profile" : "Not enough bounded mass sits on a numeric axis"}</span>
          <strong>{named ? "named axis" : `${points.length} usable bins`}</strong>
        </figcaption>
        <p className={styles.empty}>◌ {reason}</p>
        {surface.detail && surface.detail !== reason ? (
          <p className="coh-figure__missing">
            <span aria-hidden="true">◌</span>
            <span>{surface.detail}</span>
          </p>
        ) : null}
      </figure>
    );
  }
  const liveTotal = points.reduce((sum, point) => sum + point.cc, 0);
  const liveMean = points.reduce((sum, point) => sum + point.x * point.cc, 0) / liveTotal;
  const centre = points.reduce((best, point, index) => Math.abs(point.x - liveMean) < Math.abs(points[best].x - liveMean) ? index : best, 0);
  const requestedTail = tilt < 0 ? 0 : points.length - 1;
  const tail = requestedTail === centre ? (requestedTail === 0 ? points.length - 1 : 0) : requestedTail;
  const moved = Math.floor(points[centre].cc * Math.abs(tilt) / 100);
  const shaped = points.map((point, index) => ({ ...point, scenario: point.cc + (index === centre ? -moved : index === tail ? moved : 0) }));
  const weight = shaped.reduce((sum, point) => sum + point.scenario, 0);
  const mean = shaped.reduce((sum, point) => sum + point.x * point.scenario, 0) / weight;
  const variance = shaped.reduce((sum, point) => sum + (point.x - mean) ** 2 * point.scenario, 0) / weight;
  const sd = Math.sqrt(variance);
  const skew = sd ? shaped.reduce((sum, point) => sum + (point.x - mean) ** 3 * point.scenario, 0) / weight / sd ** 3 : null;
  const kurt = variance ? shaped.reduce((sum, point) => sum + (point.x - mean) ** 4 * point.scenario, 0) / weight / variance ** 2 - 3 : null;
  const scenarioValues = [mean, sd, skew, kurt];
  const lo = points[0].x;
  const hi = points.at(-1)!.x;
  const span = Math.max(1e-9, hi - lo);
  const x = (value: number) => 58 + ((value - lo) / span) * 900;
  const base = 224;
  const peak = Math.max(1, ...shaped.flatMap((point) => [point.cc, point.scenario]));
  const y = (value: number) => base - (value / peak) * 176;
  const liveLine = points.map((point) => `${x(point.x)},${y(point.cc)}`).join(" ");
  const scenarioLine = shaped.map((point) => `${x(point.x)},${y(point.scenario)}`).join(" ");
  const area = `58,${base} ${scenarioLine} 958,${base}`;
  const meanX = Math.min(958, Math.max(58, x(mean)));
  const bandLeft = Math.min(958, Math.max(58, x(mean - sd)));
  const bandRight = Math.min(958, Math.max(58, x(mean + sd)));
  const actualTransferPct = points[centre].cc > 0 ? moved / points[centre].cc * 100 : 0;
  const transferReading = tilt === 0
    ? "No mass moved"
    : moved === 0
      ? `${Math.abs(tilt)}% requested; less than one centicent, so no mass moved`
      : `${fmt(actualTransferPct, 2)}% moved (${fromCenticents(moved)})`;
  return (
    <figure className={`${styles.instrument} coh-surface__moment-shape`} aria-label="Four moments of the implied distribution">
      <figcaption className={styles.head}><span><small>Moment shape simulator</small>Move mass from the centre into either tail and watch the profile and moments respond</span><strong>{moved ? "local what-if" : `${points.length} usable bins`}</strong></figcaption>
      <div className={styles.momentTabs} role="listbox" aria-label="Choose a moment to explain">
        {moments.map((moment, index) => (
          <button key={moment.key} type="button" role="option" aria-selected={selected === index} className={styles.compassPoint}
                  {...optionProps(moment.key, index)} onClick={() => setSelectedKey(moment.key)}>
            <strong>{moment.label}</strong><small className="num">{decimalLabel(moment.raw, 4)}</small>
          </button>
        ))}
      </div>
      <div className={styles.momentPlot} role="img" tabIndex={0} aria-label={`Recorded and local what-if bounded-bin profiles; scenario mean ${fmt(mean, 4)} and standard deviation ${fmt(sd, 4)}`}>
        <svg viewBox="0 0 1000 270" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          <rect x={bandLeft} y={28} width={Math.max(1, bandRight - bandLeft)} height={base - 28} className={styles.sigmaBand} />
          <polygon points={area} className={styles.shapeArea} />
          <polyline points={liveLine} className={styles.liveProfile} />
          <polyline points={scenarioLine} className={styles.scenarioProfile} />
          <line x1={58} x2={958} y1={base} y2={base} className={styles.zeroLine} />
          <line x1={meanX} x2={meanX} y1={24} y2={base} className={styles.meanLine} />
          {shaped.map((point) => <g key={point.key}><title>{`${point.label}: recorded ${fromCenticents(point.cc)}, local what-if ${fromCenticents(point.scenario)}`}</title><circle cx={x(point.x)} cy={y(point.scenario)} r={5} className={styles.shapePoint} /></g>)}
          <text x={meanX} y={18} textAnchor="middle" className={styles.lineLabel}>μ {fmt(mean, 2)}</text>
          <text x={bandLeft} y={42} className={styles.lineLabel}>−σ</text><text x={bandRight} y={42} textAnchor="end" className={styles.lineLabel}>+σ</text>
          <text x={58} y={252} className={styles.tickText}>{fmt(lo, 0)}</text><text x={958} y={252} textAnchor="end" className={styles.tickText}>{fmt(hi, 0)}</text>
        </svg>
      </div>
      <div className={styles.plotLegend} aria-hidden="true"><span data-legend="live">recorded profile</span><span data-legend="line">local what-if</span><span>band = μ ± σ</span></div>
      <section className={styles.simulator} aria-label="Local tail-transfer simulator">
        <div><small>Local what-if</small><strong>{moved ? `Centre → ${points[tail].x < points[centre].x ? "low" : "high"} tail` : "Recorded shape"}</strong><p>Positive bounded-bin mass only; total usable weight stays fixed.</p></div>
        <label><span>Tail transfer</span><input type="range" min={-25} max={25} step={1} value={tilt} onChange={(event) => setTilt(Number(event.target.value))} aria-label="Percent of centre-bin mass moved to a tail" /></label>
        <button type="button" onClick={() => setTilt(0)} disabled={!tilt}>Reset</button>
      </section>
      <div className={styles.momentReadout}><span><small>{active.term}</small><strong className="num">{decimalLabel(active.raw, 4)}</strong><em>Recorded exact</em></span><span><small>Local what-if</small><strong className="num">≈ {fmt(scenarioValues[selected], 4)}</strong><em>{transferReading}</em></span><span className={styles.readoutNote}><code>{active.formula}</code><br />{active.note}</span></div>
      <output className="sr-only" aria-live="polite" aria-atomic="true">
        {active.term} local what-if: {fmt(scenarioValues[selected], 4)}. {transferReading}.
      </output>
      <p className="coh-figure__missing coh-surface__moments-note coh-surface__moments-note--shape">
        <span aria-hidden="true">◌</span>
        <span>{surface.moments_note}. Unbounded tails have no midpoint and receive no invented width; the simulation only moves mass among bounded representatives.</span>
      </p>
    </figure>
  );
}

export function MassReservoir({ surface }: { surface: CoherenceSurface }) {
  const chamberKeys = ["low", "interior", "high"];
  const [selectedKey, setSelectedKey, optionProps] = useRovingListbox(chamberKeys, "interior");
  const selected = Math.max(0, chamberKeys.indexOf(selectedKey ?? ""));
  if (surface.engine === "named") {
    return (
      <figure className={styles.instrument} aria-label="Moment support is not applicable to named outcomes">
        <figcaption className={styles.head}>
          <span><small>Moment support</small>Named outcomes have no ordered numeric axis</span>
          <strong>Not applicable</strong>
        </figcaption>
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span>
          <span>Open tails, bounded representatives, and numeric moments require an ordered strike axis. No support interval is invented for named outcomes.</span>
        </p>
      </figure>
    );
  }

  const totalCc = toCenticents(surface.total_mass);
  const hasLowTail = surface.bins.some((bin) => bin.low == null && bin.high != null);
  const hasHighTail = surface.bins.some((bin) => bin.low != null && bin.high == null);
  const lowCc = hasLowTail ? toCenticents(surface.tail_mass_low) : 0;
  const highCc = hasHighTail ? toCenticents(surface.tail_mass_high) : 0;
  const boundedBins = surface.bins.filter((bin) => bin.representative != null);
  const interiorCc = sumPrices(boundedBins.map((bin) => bin.mass));
  const accountedCc = lowCc == null || interiorCc == null || highCc == null
    ? null
    : lowCc + interiorCc + highCc;
  const accountingMismatch = totalCc != null && accountedCc != null && totalCc !== accountedCc;
  const supportDescription = hasLowTail && hasHighTail
    ? "Quoted mass split into two open tails and bounded interior"
    : hasLowTail || hasHighTail
      ? "Quoted mass split between one open tail and bounded interior"
      : "No open tails; quoted mass lives on bounded support";
  const chambers = [
    {
      label: "Low tail",
      value: lowCc,
      note: !hasLowTail
        ? "No open low-tail interval exists; this chamber is structurally zero."
        : lowCc == null
          ? "An open low-tail interval exists, but its mass is unreadable; it is omitted, never treated as zero."
          : "Below the lowest quoted strike; excluded because it has no finite midpoint.",
      exact: hasLowTail,
    },
    {
      label: "Bounded interior",
      value: interiorCc,
      note: interiorCc == null
        ? "At least one bounded-bin mass is unreadable; the bounded support is unavailable, not zero."
        : `Sum of ${boundedBins.length} bounded-bin ${boundedBins.length === 1 ? "mass" : "masses"}. Moments renormalise only their positive representatives.`,
      exact: false,
    },
    {
      label: "High tail",
      value: highCc,
      note: !hasHighTail
        ? "No open high-tail interval exists; this chamber is structurally zero."
        : highCc == null
          ? "An open high-tail interval exists, but its mass is unreadable; it is omitted, never treated as zero."
          : "Above the highest quoted strike; excluded because it has no finite midpoint.",
      exact: hasHighTail,
    },
  ];
  const active = chambers[selected];
  const knownTotal = chambers.reduce((sum, chamber) => sum + (chamber.value != null && chamber.value > 0 ? chamber.value : 0), 0);
  return (
    <figure className={styles.instrument} aria-label="Interior and tail mass chambers">
      <figcaption className={styles.head}><span><small>Moment support</small>{supportDescription}</span><strong className="num">Σ {decimalLabel(surface.total_mass, 4)}</strong></figcaption>
      <p className={styles.accountingEquation}><code>bounded interior = Σ bounded-bin masses</code></p>
      <div className={styles.reservoir} role="listbox" aria-label="Inspect a mass chamber">
        {chambers.map((chamber, index) => (
          <button key={chamber.label} type="button" role="option" aria-selected={selected === index} style={{ flexGrow: chamber.value == null || chamber.value <= 0 ? 0.08 : chamber.value / Math.max(1, knownTotal) }}
                  data-negative={(chamber.value != null && chamber.value < 0) || undefined}
                  {...optionProps(chamberKeys[index], index)} onClick={() => setSelectedKey(chamberKeys[index])}>
            <span aria-hidden="true">{index === 1 ? "━" : index === 0 ? "◁" : "▷"}</span>
            <strong className="num">{fromCenticents(chamber.value) ?? "—"}</strong><small>{chamber.label}</small>
          </button>
        ))}
      </div>
      <output className={`${styles.momentReadout} ${styles.reservoirReadout}`} aria-live="polite" aria-atomic="true"><span><small>{active.label}</small><strong className="num">{fromCenticents(active.value) ?? "—"}</strong><em>{active.value == null ? "Unavailable" : active.value < 0 ? "Contradiction" : selected === 1 ? "Derived exactly" : active.exact ? "Recorded exact" : "Structural zero"}</em></span><span className={styles.readoutNote}>{active.note}</span></output>
      {accountingMismatch ? (
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span>
          <span>The displayed chambers sum to {fromCenticents(accountedCc)}, while the quoted total is {fromCenticents(totalCc)}; the mismatch is preserved rather than reconciled.</span>
        </p>
      ) : null}
    </figure>
  );
}
