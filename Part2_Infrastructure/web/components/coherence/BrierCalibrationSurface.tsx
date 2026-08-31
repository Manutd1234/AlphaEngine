"use client";

import { useId, type KeyboardEvent } from "react";

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import {
  calibrationMetrics,
  calibrationSurfaceBins,
  type CalibrationSurfaceBin,
} from "@/lib/coherence/brier-calibration-surface";
import { useHot } from "@/lib/coherence/use-hot";

import Figure from "./Figure";
import { QuantInspectionPair, QuantInspectionReadout } from "./QuantInspectionPair";
import styles from "./BrierCalibrationSurface.module.css";

const WIDTH = 760;
const HEIGHT = 350;
const MARGIN = { top: 24, right: 24, bottom: 64, left: 54 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

function moveInspection(
  event: KeyboardEvent<HTMLElement>,
  current: number | null,
  count: number,
  inspect: (index: number | null) => void,
) {
  if (!count) return;
  const moves: Record<string, number | "first" | "last"> = {
    ArrowRight: 1,
    ArrowDown: 1,
    ArrowLeft: -1,
    ArrowUp: -1,
    Home: "first",
    End: "last",
  };
  if (event.key in moves) {
    event.preventDefault();
    const move = moves[event.key];
    const at = current === null ? 0 : current;
    const next = move === "first"
      ? 0
      : move === "last"
        ? count - 1
        : Math.max(0, Math.min(count - 1, at + move));
    inspect(next);
  } else if (event.key === "Escape") {
    event.preventDefault();
    inspect(null);
    event.currentTarget.blur();
  }
}

function SurfaceState({
  state,
  title,
  detail,
}: {
  state: "loading" | "empty" | "unavailable";
  title: string;
  detail: string;
}) {
  const mark = state === "loading" ? "◌" : state === "empty" ? "○" : "✕";
  return (
    <section className={styles.state} data-state={state} role="status">
      <span className={styles.stateMark} aria-hidden="true">{mark}</span>
      <span><strong>{title}</strong><small>{detail}</small></span>
    </section>
  );
}

function SurfacePlot({ rows }: { rows: CalibrationSurfaceBin[] }) {
  const { hot, setHot } = useHot();
  const instructionsId = useId();
  const maxCount = Math.max(1, ...rows.map((row) => row.count === null ? 0 : row.count));
  const x = (value: number) => MARGIN.left + value * PLOT_WIDTH;
  const y = (value: number) => MARGIN.top + (1 - value) * PLOT_HEIGHT;

  return (
    <div
      className={styles.plotInstrument}
      role="group"
      aria-label="Calibration bins; use arrow keys to inspect"
      aria-describedby={instructionsId}
      tabIndex={0}
      onFocus={() => { if (hot === null && rows.length) setHot(0); }}
      onKeyDown={(event) => moveInspection(event, hot, rows.length, setHot)}
    >
      <span id={instructionsId} className="sr-only">
        Use arrow keys to inspect bins, Home and End to jump, and Escape to clear the reading.
      </span>
      <svg
        className={styles.plot}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        aria-hidden="true"
        focusable="false"
        onPointerLeave={() => setHot(null)}
      >
        {TICKS.map((tick) => (
          <g key={`grid-${tick}`}>
            <line x1={x(0)} x2={x(1)} y1={y(tick)} y2={y(tick)} className={styles.grid} />
            <line x1={x(tick)} x2={x(tick)} y1={y(0)} y2={y(1)} className={styles.grid} />
            <text x={MARGIN.left - 8} y={y(tick) + 4} textAnchor="end" className={styles.tick}>
              {tick === 0 ? "0.00" : tick === 0.25 ? "0.25" : tick === 0.5 ? "0.50" : tick === 0.75 ? "0.75" : "1.00"}
            </text>
            <text x={x(tick)} y={HEIGHT - 38} textAnchor="middle" className={styles.tick}>
              {tick === 0 ? "0.00" : tick === 0.25 ? "0.25" : tick === 0.5 ? "0.50" : tick === 0.75 ? "0.75" : "1.00"}
            </text>
          </g>
        ))}

        {rows.map((row) => {
          if (row.low === null || row.high === null) return null;
          const left = x(row.low);
          const right = x(row.high);
          const mid = left + (right - left) / 2;
          const active = hot === row.index;
          const radius = row.count === null
            ? 4
            : 4 + 8 * Math.sqrt(row.count / maxCount);
          return (
            <g
              key={row.key}
              className={`${styles.bin}${active ? ` ${styles.active}` : ""}`}
              data-surface-index={row.index}
              data-bin-state={row.state}
              onPointerEnter={() => setHot(row.index)}
            >
              <rect
                x={left}
                y={MARGIN.top}
                width={Math.max(1, right - left)}
                height={PLOT_HEIGHT}
                className={styles.hitArea}
              />
              {row.state === "point" && row.forecast !== null && row.observed !== null ? (
                <>
                  <line
                    x1={x(row.forecast)}
                    x2={x(row.forecast)}
                    y1={y(row.forecast)}
                    y2={y(row.observed)}
                    className={styles.residual}
                  />
                  <circle
                    cx={x(row.forecast)}
                    cy={y(row.observed)}
                    r={radius}
                    className={styles.point}
                  />
                </>
              ) : (
                <text x={mid} y={y(0.5) + 5} textAnchor="middle" className={styles.absentMark}>
                  {row.state === "empty" ? "○" : "✕"}
                </text>
              )}
            </g>
          );
        })}

        <line x1={x(0)} x2={x(1)} y1={y(0)} y2={y(1)} className={styles.perfect} />
        <text x={x(0.68)} y={y(0.68) - 10} className={styles.referenceLabel}>
          forecast = observed
        </text>
        <text x={MARGIN.left + PLOT_WIDTH / 2} y={HEIGHT - 12} textAnchor="middle" className={styles.axisLabel}>
          forecast mean
        </text>
        <text
          x={15}
          y={MARGIN.top + PLOT_HEIGHT / 2}
          textAnchor="middle"
          transform={`rotate(-90 15 ${MARGIN.top + PLOT_HEIGHT / 2})`}
          className={styles.axisLabel}
        >
          observed frequency
        </text>
      </svg>
    </div>
  );
}

function BinRail({ rows }: { rows: CalibrationSurfaceBin[] }) {
  const { hot, setHot } = useHot();
  const listId = useId();
  return (
    <div
      className={styles.binRail}
      role="listbox"
      aria-label="Calibration probability bins"
      aria-activedescendant={hot === null ? undefined : `${listId}-${hot}`}
      tabIndex={0}
      onFocus={() => { if (hot === null && rows.length) setHot(0); }}
      onKeyDown={(event) => moveInspection(event, hot, rows.length, setHot)}
      onPointerLeave={() => setHot(null)}
    >
      {rows.map((row) => (
        <div
          id={`${listId}-${row.index}`}
          key={row.key}
          className={styles.binChip}
          role="option"
          aria-selected={hot === row.index}
          data-bin-state={row.state}
          onPointerEnter={() => setHot(row.index)}
        >
          <span>{row.label}</span>
          <strong className="num">{row.countText}</strong>
        </div>
      ))}
    </div>
  );
}

function SurfaceWorkbench({ data }: { data: CoherenceCalibration }) {
  const rows = calibrationSurfaceBins(data.bins);
  const unavailable = rows.filter((row) => row.state === "unavailable").length;
  const metrics = calibrationMetrics(data);
  return (
    <QuantInspectionPair className={styles.workbench}>
      <Figure
        caption="Brier calibration surface: forecast mean against observed frequency, one returned probability bin per column"
        ariaLabel={`${rows.length} returned probability bins; point area and printed N are settled counts`}
        reading="The dashed diagonal is exact calibration. Each vertical residual is observed frequency minus forecast mean; point area and the printed N both encode the settled count."
        missing={unavailable ? `${unavailable} bin${unavailable === 1 ? " is" : "s are"} unplottable because a required returned value is unavailable; each remains inspectable in the bin rail.` : null}
        reserveInteractionRow={false}
      >
        {data.thin ? (
          <p className={styles.sampleState} data-sample-state="low-count">
            <span aria-hidden="true">▲</span> Engine state: thin settled sample. Counts remain explicit; the surface promotes no pass verdict.
          </p>
        ) : (
          <p className={styles.sampleState} data-sample-state="scored">
            <span aria-hidden="true">●</span> Engine state: sample not flagged thin.
          </p>
        )}
        <SurfacePlot rows={rows} />
        <div className="sr-only">
          <QuantInspectionReadout rows={rows} reading={(row) => row.readout} />
        </div>
        <BinRail rows={rows} />
        <section className={styles.metrics} aria-label="Exact Brier decomposition">
          <p>Brier = Reliability − Resolution + Uncertainty + Binning</p>
          <dl>
            {metrics.map((metric) => (
              <div key={metric.label} data-role={metric.role}>
                <dt>{metric.label}</dt>
                <dd className="num">{metric.value}</dd>
              </div>
            ))}
          </dl>
          <small>Uncertainty is the returned corpus term, not an inferred confidence band.</small>
        </section>
      </Figure>
    </QuantInspectionPair>
  );
}

export default function BrierCalibrationSurface({
  data,
  error,
}: {
  data: CoherenceCalibration | null;
  error: string | null;
}) {
  if (!data) {
    return error
      ? <SurfaceState state="unavailable" title="Calibration surface unavailable" detail={error} />
      : <SurfaceState state="loading" title="Preparing calibration surface" detail="Waiting for the settled-corpus read." />;
  }
  if (data.state !== "available") {
    return (
      <SurfaceState
        state="unavailable"
        title="Calibration surface unavailable"
        detail={data.detail || "The settled calibration payload is unavailable."}
      />
    );
  }
  const totalReady = Number.isSafeInteger(data.count) && data.count > 0;
  if (!totalReady || !data.bins.length) {
    return (
      <SurfaceState
        state="empty"
        title="No settled calibration surface"
        detail="No scored markets or probability bins were returned; no zero-valued surface is substituted."
      />
    );
  }
  return <SurfaceWorkbench data={data} />;
}
