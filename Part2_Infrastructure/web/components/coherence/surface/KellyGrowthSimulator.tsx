"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { fmt, pct } from "@/lib/format";
import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import {
  replayKellyScale,
  type KellyFrontierCandidate as Candidate,
  type KellyFrontierPoint as FrontierPoint,
} from "@/lib/coherence/kelly-frontier";

import styles from "../StakeInstrument.module.css";

const WIDTH = 760;
const HEIGHT = 272;
const MARGIN = { top: 24, right: 20, bottom: 42, left: 56 };

function number(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw.trim())) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function candidatesOf(kelly: CoherenceKelly): Candidate[] | null {
  const candidates: Candidate[] = [];
  for (const stake of kelly.stakes) {
    const probability = number(stake.probability);
    const price = number(stake.price);
    const fullFraction = number(stake.full_fraction);
    if (probability == null || price == null || price <= 0 || fullFraction == null || fullFraction < 0) return null;
    candidates.push({ probability, price, fullFraction });
  }
  return candidates.length ? candidates : null;
}

function maximumScale(candidates: readonly Candidate[]): number {
  let last = 1;
  for (let step = 101; step <= 160; step += 1) {
    const scale = step / 100;
    if (!replayKellyScale(candidates, scale)) break;
    last = scale;
  }
  return last;
}

function path(points: readonly FrontierPoint[], x: (value: number) => number, y: (value: number) => number): string {
  return points.map((point, index) => `${index ? "L" : "M"}${x(point.scale).toFixed(2)},${y(point.growth).toFixed(2)}`).join(" ");
}

export default function KellyGrowthSimulator({
  kelly,
  eyebrow = "Decision chamber",
}: {
  kelly: CoherenceKelly;
  eyebrow?: string;
}) {
  const candidates = useMemo(() => candidatesOf(kelly), [kelly]);
  const shrinkage = number(kelly.shrinkage);
  const riskless = number(kelly.riskless_growth);
  const maxScale = candidates ? maximumScale(candidates) : 1;
  const maxPercent = Math.max(100, Math.floor(maxScale * 100));
  const initialPercent = shrinkage == null
    ? 0
    : Math.max(0, Math.min(maxPercent, Math.round(shrinkage * 100)));
  const [scalePercent, setScalePercent] = useState(initialPercent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [frontierScrollable, setFrontierScrollable] = useState(false);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    const update = () => {
      const next = node.scrollWidth > node.clientWidth + 1;
      setFrontierScrollable((current) => current === next ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [candidates]);

  const frontier = useMemo(() => {
    if (!candidates) return [];
    const points: FrontierPoint[] = [];
    for (let index = 0; index <= 80; index += 1) {
      const point = replayKellyScale(candidates, (maxScale * index) / 80);
      if (point) points.push(point);
    }
    return points;
  }, [candidates, maxScale]);

  if (!candidates || !frontier.length) {
    return (
      <figure className={styles.instrument} aria-label="Kelly growth frontier unavailable">
        <figcaption className={styles.head}>
          <span><small>{eyebrow}</small>Growth and terminal wealth across Kelly scale</span>
          <strong>withheld</strong>
        </figcaption>
        <p className="coh-figure__missing">
          <span aria-hidden="true">◌</span>
          <span>A complete probability, price and full-Kelly fraction is required for every outcome.</span>
        </p>
      </figure>
    );
  }

  const scale = scalePercent / 100;
  const active = replayKellyScale(candidates, scale) ?? frontier[frontier.length - 1];
  const growthValues = frontier.map((point) => point.growth).concat(riskless == null ? [] : [riskless], [0]);
  const rawMin = Math.min(...growthValues);
  const rawMax = Math.max(...growthValues);
  const spread = Math.max(0.0005, rawMax - rawMin);
  const yMin = rawMin - spread * 0.16;
  const yMax = rawMax + spread * 0.18;
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (value: number) => MARGIN.left + (value / maxScale) * plotWidth;
  const y = (value: number) => MARGIN.top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const growthPath = path(frontier, x, y);
  const zeroY = y(0);
  const currentX = x(Math.min(scale, maxScale));
  const returnedGrowth = number(kelly.growth_rate);
  const returnedFloor = number(kelly.worst_case_wealth);
  const isFlat = frontier.every((point) => Math.abs(point.growth) < 1e-12);

  return (
    <figure className={styles.instrument} aria-label="Interactive Kelly growth frontier">
      <figcaption className={styles.head}>
        <span><small>{eyebrow}</small>Drag from no bet through fractional and full Kelly</span>
        <strong>{isFlat ? "flat: stake nothing" : `${scalePercent}% Kelly`}</strong>
      </figcaption>

      <div className={styles.frontierStage}>
        <div
          ref={scrollRef}
          className={styles.frontierScroll}
          role={frontierScrollable ? "region" : undefined}
          aria-label={frontierScrollable ? "Kelly frontier plot; scroll horizontally" : undefined}
          tabIndex={frontierScrollable ? 0 : undefined}
        >
          <svg className={styles.frontierSvg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img"
               aria-label={`Expected log growth by Kelly scale. Selected ${scalePercent} percent, growth ${fmt(active.growth, 6)}, worst wealth ${fmt(active.floor, 4)}.`}>
          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={zeroY} y2={zeroY} className={styles.frontierZero} />
          <text x={MARGIN.left} y={zeroY - 7} className={styles.frontierLabel}>stake nothing</text>

          {riskless == null ? null : (
            <>
              <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={y(riskless)} y2={y(riskless)} className={styles.frontierRiskless} />
              <text x={WIDTH - MARGIN.right} y={y(riskless) - 7} textAnchor="end" className={styles.frontierLabel}>riskless alternative</text>
            </>
          )}

          <path d={`${growthPath} L${x(maxScale)},${zeroY} L${x(0)},${zeroY} Z`} className={styles.frontierArea} />
          <path d={growthPath} className={styles.frontierLine} />

          {shrinkage == null ? null : (
            <>
              <line x1={x(shrinkage)} x2={x(shrinkage)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className={styles.frontierReturned} />
              <text x={x(shrinkage) + 6} y={MARGIN.top + 12} className={styles.frontierLabel}>returned plan</text>
            </>
          )}
          <line x1={x(1)} x2={x(1)} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className={styles.frontierFull} />
          <text x={x(1) - 6} y={HEIGHT - MARGIN.bottom - 7} textAnchor="end" className={styles.frontierLabel}>full Kelly</text>

          <line x1={currentX} x2={currentX} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} className={styles.frontierCrosshair} />
          <circle cx={currentX} cy={y(active.growth)} r="6" className={styles.frontierPoint} />

          <line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} className={styles.frontierAxis} />
          {[0, ...(shrinkage == null ? [] : [shrinkage]), 1, maxScale].filter((value, index, values) => value >= 0 && value <= maxScale && values.indexOf(value) === index).map((value) => (
            <text key={value} x={x(value)} y={HEIGHT - 15} textAnchor="middle" className={styles.frontierTick}>{pct(value, 0)}</text>
          ))}
            <text x={15} y={MARGIN.top + plotHeight / 2} textAnchor="middle" transform={`rotate(-90 15 ${MARGIN.top + plotHeight / 2})`} className={styles.frontierTick}>expected log growth</text>
          </svg>
        </div>

        <label className={styles.frontierControl}>
          <span><small>Kelly scale</small><strong>Move the allocation crosshair</strong></span>
          <input type="range" min={0} max={maxPercent} step={1} value={scalePercent}
                 onChange={(event) => setScalePercent(Number(event.target.value))} />
          <output className="num">{scalePercent}%</output>
        </label>
      </div>

      <output className={styles.frontierReadout} aria-live="polite" aria-atomic="true">
        <span><small>Expected log growth</small><strong className="num">{fmt(active.growth, 6)}</strong></span>
        <span><small>Worst terminal dollar</small><strong className="num">{fmt(active.floor, 4)}</strong></span>
        <span><small>Cash left</small><strong className="num">{fmt(active.cash, 4)}</strong></span>
        <span><small>Against riskless</small><strong className="num">{riskless == null ? "—" : fmt(active.growth - riskless, 6)}</strong></span>
      </output>

      <p className="coh-figure__reading">
        {isFlat
          ? "The curve stays on zero because every full-Kelly fraction is zero: changing scale cannot create a bet."
          : shrinkage == null
            ? `The server withheld its Kelly scale; the crosshair still replays the returned outcome inputs without drawing a synthetic returned-plan marker.`
            : `The server returned ${pct(shrinkage, 0)} Kelly at growth ${fmt(returnedGrowth, 6)} and a ${fmt(returnedFloor, 4)} terminal floor; the crosshair replays the same outcome wealth equation.`}
      </p>
      <p className="coh-figure__missing">
        <span aria-hidden="true">◌</span>
        <span>Sensitivity replay only; moving the control does not rerun the solver or place an order.</span>
      </p>
    </figure>
  );
}
