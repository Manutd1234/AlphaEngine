"use client";

/**
 * Where the book is concentrated — and how concentrated it really is.
 *
 * A donut of four slices is easy to read and easy to over-read: four positions
 * look diversified. They are not, if one is 42% of the book, and they are
 * *really* not if the four move together. So the ring carries two numbers the
 * shape cannot:
 *
 *  - **Effective positions** (inverse HHI): how many *equally sized* positions
 *    this book behaves like. A book of four at 42/28/17/13 behaves like ~3.4.
 *  - **Largest share**, because concentration risk is usually one name.
 *
 * Gross notional, not net. A long and a short of the same size are two
 * concentrations of risk, not zero — netting them would draw an empty ring over
 * a book with real exposure on both sides. Direction is shown by the slice
 * label instead.
 */

import { useMemo, useState } from "react";

import { fmt, pct, usd } from "@/lib/format";
import type { PortfolioPosition } from "@/lib/portfolio";

interface AllocationDonutProps {
  positions: PortfolioPosition[];
  gross: number;
  effectivePositions: number;
  largestShare: number;
  hhi: number;
}

/** Categorical slots, assigned in fixed order and never cycled. */
const SLICE_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--diverging-pos)",
  "var(--status-warning)",
  "var(--text-muted)",
];

const SIZE = 190;
const RADIUS = 74;
const THICKNESS = 26;

/** Arc path for a donut segment, angles in radians clockwise from 12 o'clock. */
function arc(from: number, to: number): string {
  const c = SIZE / 2;
  const outer = RADIUS;
  const inner = RADIUS - THICKNESS;
  const point = (r: number, a: number) => [c + r * Math.sin(a), c - r * Math.cos(a)];
  const [x0, y0] = point(outer, from);
  const [x1, y1] = point(outer, to);
  const [x2, y2] = point(inner, to);
  const [x3, y3] = point(inner, from);
  const large = to - from > Math.PI ? 1 : 0;
  return [
    `M${x0.toFixed(2)},${y0.toFixed(2)}`,
    `A${outer},${outer} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`,
    `L${x2.toFixed(2)},${y2.toFixed(2)}`,
    `A${inner},${inner} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)}`,
    "Z",
  ].join("");
}

export default function AllocationDonut({
  positions,
  gross,
  effectivePositions,
  largestShare,
  hhi,
}: AllocationDonutProps) {
  const [hover, setHover] = useState<string | null>(null);

  const slices = useMemo(() => {
    const sorted = [...positions].filter((p) => p.notional > 0).sort((a, b) => b.notional - a.notional);
    let cursor = 0;
    return sorted.map((p, i) => {
      const share = gross > 0 ? p.notional / gross : 0;
      const from = cursor;
      const to = cursor + share * Math.PI * 2;
      cursor = to;
      return { position: p, share, from, to, color: SLICE_COLORS[i % SLICE_COLORS.length] };
    });
  }, [positions, gross]);

  if (!slices.length) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Concentration</span>
            <h2>Allocation</h2>
          </div>
        </div>
        <p className="sub">The book is flat — there is nothing allocated to show.</p>
      </div>
    );
  }

  const active = slices.find((s) => s.position.symbol === hover) ?? null;

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Concentration</span>
          <h2>Allocation</h2>
        </div>
        <span>{usd(gross, 0)} gross</span>
      </div>

      <div className="allocation-body">
        <div className="allocation-ring">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            role="img"
            aria-label={`Allocation by instrument across ${slices.length} positions. Largest is ${slices[0].position.symbol} at ${pct(slices[0].share, 1)} of gross notional.`}
          >
            {slices.map((s) => (
              <path
                key={s.position.symbol}
                d={arc(s.from, s.to)}
                fill={s.color}
                opacity={hover && hover !== s.position.symbol ? 0.35 : 1}
                onPointerEnter={() => setHover(s.position.symbol)}
                onPointerLeave={() => setHover(null)}
              >
                <title>
                  {`${s.position.symbol} ${s.position.side} — ${usd(s.position.notional, 0)}, ${pct(s.share, 1)} of gross`}
                </title>
              </path>
            ))}
            {/* The centre carries the number the ring cannot: how concentrated
                four slices actually are. */}
            <text
              x={SIZE / 2}
              y={SIZE / 2 - 6}
              textAnchor="middle"
              fontSize={22}
              fontWeight={680}
              fontFamily="var(--mono)"
              fill="var(--text-primary)"
            >
              {fmt(effectivePositions, 1)}
            </text>
            <text
              x={SIZE / 2}
              y={SIZE / 2 + 12}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="var(--sans)"
              fill="var(--text-muted)"
            >
              effective positions
            </text>
          </svg>
        </div>

        <div className="allocation-legend">
          {slices.map((s) => (
            <div
              key={s.position.symbol}
              className={`allocation-row${active?.position.symbol === s.position.symbol ? " is-active" : ""}`}
              onPointerEnter={() => setHover(s.position.symbol)}
              onPointerLeave={() => setHover(null)}
            >
              <i style={{ background: s.color }} aria-hidden />
              <span className="allocation-symbol">
                {s.position.symbol}
                <small className={s.position.side === "SHORT" ? "neg" : "pos"}>{s.position.side}</small>
              </span>
              <span className="num">{pct(s.share, 1)}</span>
              <span className="num muted">{usd(s.position.notional, 0)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="allocation-facts">
        <span>
          Largest <strong className="num">{pct(largestShare, 1)}</strong>
        </span>
        <span>
          HHI <strong className="num">{fmt(hhi, 3)}</strong>
        </span>
        <span>
          Behaves like <strong className="num">{fmt(effectivePositions, 1)}</strong> equal positions
        </span>
      </div>

      {/* Method, not measurement. The caveat it carries — that this says nothing
          about whether the positions move together — is load-bearing, so the
          summary carries it rather than hiding it behind a neutral label. */}
      <details className="disclosure">
        <summary>How this is sized, and what it does not tell you</summary>
        <p className="research-note">
          Sized by gross notional, so a long and a short of equal size read as two concentrations
          rather than cancelling to nothing. Effective positions is the inverse Herfindahl index — it
          falls below the position count whenever the book is unevenly weighted, and it says nothing
          about whether those positions move together. The correlation matrix does.
        </p>
      </details>
    </div>
  );
}
