import type { BarRow, BarSegment } from "@/components/charts/CategoryBars";
import { metricRow } from "@/lib/format";

export function nextCiCountIndex(
  current: number | null,
  keyCode: number,
  count: number,
): number | null {
  if (count <= 0 || keyCode === 27) return null;
  if (current === null) {
    if (keyCode === 35 || keyCode === 37 || keyCode === 38) return count - 1;
    if (keyCode === 36 || keyCode === 39 || keyCode === 40) return 0;
    return null;
  }
  const at = Math.min(count - 1, Math.max(0, current));
  if (keyCode === 36) return 0;
  if (keyCode === 35) return count - 1;
  if (keyCode === 38 || keyCode === 37) return Math.max(0, at - 1);
  if (keyCode === 40 || keyCode === 39) return Math.min(count - 1, at + 1);
  return null;
}

export default function CiCountBars({
  rows,
  ariaLabel,
  emptyNote,
  selectedLabel,
  onSelect,
}: {
  rows: BarRow[];
  ariaLabel: string;
  emptyNote: string;
  selectedLabel: string | null;
  onSelect: (label: string | null) => void;
}) {
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

  const requestedIndex = rows.findIndex((row) => row.label === selectedLabel);
  const selectedIndex = requestedIndex < 0 ? null : requestedIndex;
  const current = selectedIndex === null ? null : rows[selectedIndex];

  return (
    <figure
      className="category-bars developer-ci-counts protected-category-instrument"
      role="group"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        const next = nextCiCountIndex(selectedIndex, event.keyCode, rows.length);
        if (next !== null || event.keyCode === 27) {
          event.preventDefault();
          onSelect(next === null ? null : rows[next]?.label ?? null);
        }
      }}
    >
      <figcaption className="developer-ci-counts__caption">CI test counts</figcaption>
      {rows.map((row, index) => (
        <button
          type="button"
          className="category-bars__row"
          key={row.label}
          data-linked={selectedIndex === index ? "true" : undefined}
          data-selected={selectedLabel === row.label ? "true" : undefined}
          aria-pressed={selectedLabel === row.label}
          onClick={() => onSelect(selectedLabel === row.label ? null : row.label)}
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
        </button>
      ))}
      <span className="developer-ci-counts__reading">
        {current && (
          <output className="protected-chart-output num" aria-live="polite">
            {metricRow([
              current.label,
              current.note ?? totals[selectedIndex ?? 0].toLocaleString(),
            ])}
          </output>
        )}
      </span>
      {legend.length > 1 && (
        <div className="legend category-bars__legend">
          {legend.map((segment) => (
            <span key={segment.label}>
              <i style={{ background: segment.color }} /> {segment.label}
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}
