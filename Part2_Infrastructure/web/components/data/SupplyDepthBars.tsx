import { useRef, useState } from "react";

import type { BarRow, BarSegment } from "@/components/charts/CategoryBars";
import { metricRow } from "@/lib/format";

export function nextSupplyDepthIndex(
  current: number,
  keyCode: number,
  count: number,
): number | null {
  if (count <= 0 || keyCode === 27) return null;
  const at = Math.min(count - 1, Math.max(0, current));
  if (keyCode === 36) return 0;
  if (keyCode === 35) return count - 1;
  if (keyCode === 38 || keyCode === 37) return Math.max(0, at - 1);
  if (keyCode === 40 || keyCode === 39) return Math.min(count - 1, at + 1);
  return null;
}

export default function SupplyDepthBars({
  rows,
  ariaLabel,
  emptyNote,
}: {
  rows: BarRow[];
  ariaLabel: string;
  emptyNote: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const focused = useRef(false);
  const totals = rows.map((row) => row.segments.reduce(
    (sum, segment) => sum + Math.max(0, segment.value),
    0,
  ));
  const domain = Math.max(1, ...totals);

  if (!rows.some((_, index) => totals[index] > 0)) {
    return <p className="muted console-empty">{emptyNote}</p>;
  }

  const legend: BarSegment[] = [];
  for (const row of rows) {
    for (const segment of row.segments) {
      if (segment.value > 0 && !legend.some((item) => item.label === segment.label)) {
        legend.push(segment);
      }
    }
  }

  const activeIndex = active === null
    ? null
    : Math.min(rows.length - 1, Math.max(0, active));
  const activate = (index: number | null) => setActive(index);
  const current = activeIndex === null ? null : rows[activeIndex];

  return (
    <div
      className="category-bars data-supply-depth protected-category-instrument"
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onFocus={() => {
        focused.current = true;
        activate(activeIndex ?? 0);
      }}
      onBlur={() => {
        focused.current = false;
        activate(null);
      }}
      onKeyDown={(event) => {
        const next = nextSupplyDepthIndex(activeIndex ?? 0, event.keyCode, rows.length);
        if (next !== null || event.keyCode === 27) {
          event.preventDefault();
          activate(next);
        }
      }}
      onPointerLeave={() => {
        if (!focused.current) activate(null);
      }}
    >
      {rows.map((row, index) => (
        <div
          className="category-bars__row"
          key={row.label}
          data-linked={activeIndex === index ? "true" : undefined}
          onPointerEnter={() => activate(index)}
        >
          <span className="category-bars__label">{row.label}</span>
          <span className="category-bars__track">
            {row.segments.map((segment) => segment.value > 0 ? (
              <i
                key={segment.label}
                style={{
                  width: `${(segment.value / domain) * 100}%`,
                  background: segment.color,
                }}
                title={`${segment.label}: ${segment.value.toLocaleString()}`}
              />
            ) : null)}
          </span>
          <span className="category-bars__value num">
            {row.note ?? totals[index].toLocaleString()}
          </span>
        </div>
      ))}
      {current && (
        <output className="protected-chart-output num" aria-live="polite">
          {metricRow([
            current.label,
            current.note ?? totals[activeIndex ?? 0].toLocaleString(),
            ...current.segments
              .filter((segment) => segment.value > 0)
              .map((segment) => `${segment.label} ${segment.value.toLocaleString()}`),
          ])}
        </output>
      )}
      {legend.length > 1 && (
        <div className="legend category-bars__legend">
          {legend.map((segment) => (
            <span key={segment.label}>
              <i style={{ background: segment.color }} /> {segment.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
