"use client";

/**
 * Horizontal category bars, optionally stacked.
 *
 * The two surfaces that reach for this — data evidence composition and CI test
 * counts — are both "a handful of named rows, one magnitude each". That does
 * not want an axis-and-grid line chart; it wants the bars to be the axis, which
 * is why the labels sit in the row rather than in a margin, and why the value
 * is printed at the end of each bar instead of being read off a scale.
 *
 * Stacked segments are drawn in the order given and never re-sorted: a reader
 * comparing two rows is comparing positions, and a series that moves between
 * rows makes that impossible.
 */

export interface BarSegment {
  label: string;
  value: number;
  /** A CSS colour — house tokens only. */
  color: string;
}

export interface BarRow {
  label: string;
  /** Right-aligned annotation: the total, a rate, a provenance note. */
  note?: string;
  segments: BarSegment[];
}

export default function CategoryBars({
  rows,
  ariaLabel,
  /** Shared denominator so rows stay comparable; defaults to the largest row. */
  max,
  emptyNote = "No measurements yet.",
}: {
  rows: BarRow[];
  ariaLabel: string;
  max?: number;
  emptyNote?: string;
}) {
  const totals = rows.map((row) => row.segments.reduce((sum, s) => sum + Math.max(0, s.value), 0));
  const domain = Math.max(1, max ?? Math.max(0, ...totals));
  const populated = rows.filter((_, i) => totals[i] > 0);

  if (!populated.length) {
    return <p className="muted console-empty">{emptyNote}</p>;
  }

  // The legend names every series once, from the first row that carries it —
  // repeating a key per row is noise when the order is fixed.
  const legend: BarSegment[] = [];
  for (const row of rows) {
    for (const seg of row.segments) {
      if (seg.value > 0 && !legend.some((l) => l.label === seg.label)) legend.push(seg);
    }
  }

  return (
    <div className="category-bars" role="img" aria-label={ariaLabel}>
      {rows.map((row, i) => (
        <div className="category-bars__row" key={row.label}>
          <span className="category-bars__label">{row.label}</span>
          <span className="category-bars__track">
            {row.segments.map((seg) =>
              seg.value > 0 ? (
                <i
                  key={seg.label}
                  style={{ width: `${(seg.value / domain) * 100}%`, background: seg.color }}
                  title={`${seg.label}: ${seg.value.toLocaleString()}`}
                />
              ) : null,
            )}
          </span>
          <span className="category-bars__value num">{row.note ?? totals[i].toLocaleString()}</span>
        </div>
      ))}
      {legend.length > 1 && (
        <div className="legend category-bars__legend">
          {legend.map((seg) => (
            <span key={seg.label}>
              <i style={{ background: seg.color }} /> {seg.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
