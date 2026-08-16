"use client";

/**
 * A composition ring — what a whole is made of, when the parts are few.
 *
 * Deliberately narrow: a donut is only honest for a handful of slices that sum
 * to something meaningful, so this refuses to draw above eight and states the
 * total rather than making the reader add the labels up. Every slice carries
 * its printed share beside its swatch, because arc length is the one encoding
 * people systematically misread — the ring is the glance, the legend is the
 * answer.
 *
 * Colour never carries meaning alone: each legend row prints its own label and
 * value, so the chart survives a greyscale print and forced-colors alike.
 */

const CIRCUMFERENCE = 2 * Math.PI * 42;

export interface DonutSlice {
  label: string;
  value: number;
  /** A CSS colour — pass a token (`var(--series-1)`), never a raw hex. */
  colour: string;
}

export default function DonutChart({
  slices,
  total,
  centreLabel,
  centreValue,
  emptyNote,
  ariaLabel,
}: {
  slices: DonutSlice[];
  /** The denominator. Defaults to the sum of the slices. */
  total?: number;
  centreLabel?: string;
  centreValue?: string;
  emptyNote: string;
  ariaLabel: string;
}) {
  const drawn = slices.filter((slice) => slice.value > 0).slice(0, 8);
  const sum = total ?? drawn.reduce((acc, slice) => acc + slice.value, 0);

  if (!drawn.length || sum <= 0) {
    return <p className="muted donut-empty">{emptyNote}</p>;
  }

  let offset = 0;
  const arcs = drawn.map((slice) => {
    const share = slice.value / sum;
    const arc = {
      ...slice,
      share,
      dash: share * CIRCUMFERENCE,
      // Negative rotation because SVG strokes run clockwise from 3 o'clock and
      // the ring is read from 12.
      offset: -offset * CIRCUMFERENCE,
    };
    offset += share;
    return arc;
  });

  return (
    <div className="donut">
      {/* chart-fade replays on remount — the entrance every chart shares. */}
      <svg viewBox="0 0 100 100" role="img" aria-label={ariaLabel} className="donut__ring chart-fade">
        {arcs.map((arc) => (
          <circle
            key={arc.label}
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={arc.colour}
            strokeWidth="13"
            strokeDasharray={`${arc.dash} ${CIRCUMFERENCE - arc.dash}`}
            strokeDashoffset={arc.offset}
            transform="rotate(-90 50 50)"
          />
        ))}
        {centreValue ? (
          <>
            <text x="50" y="48" textAnchor="middle" className="donut__value">
              {centreValue}
            </text>
            <text x="50" y="60" textAnchor="middle" className="donut__label">
              {centreLabel}
            </text>
          </>
        ) : null}
      </svg>

      <ul className="donut__legend">
        {arcs.map((arc) => (
          <li key={arc.label}>
            <i aria-hidden style={{ background: arc.colour }} />
            <span>{arc.label}</span>
            <strong className="num">{Math.round(arc.share * 100)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
