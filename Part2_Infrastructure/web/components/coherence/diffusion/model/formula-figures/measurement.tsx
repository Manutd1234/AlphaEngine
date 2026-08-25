"use client";

/**
 * The seven figures for the cards about a price path.
 *
 * Each draws the mechanism, and where the card names a failure the failure is
 * drawn beside it, dashed and labelled. Nothing here is measured — these are
 * diagrams of an argument, drawn from constants chosen to make the shape
 * legible, which is why none of them carries a mark a reader could mistake for
 * a reading.
 */

import { Axes, Band, Frame, Marker, Rule, W, Wrong, path, x, y } from "./primitives";

/** A decay from 0 to 1 with a settling tail, in unit space. */
const rise = (n: number, k = 3.2) =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [t, 1 - Math.exp(-k * t)] as const;
  });

export function Absorbed() {
  const pts = rise(24);
  return (
    <Frame label="One stage's abnormal return rising to its terminal, with the absorbed fraction read as the height at a horizon over the height at the terminal; a dashed shorter window is drawn where that ratio would be one by construction">
      <Axes yWord="ar" />
      <Rule at={1} word="ar(T*)" />
      <path className="coh-index__line" d={path(pts)} fill="none" />
      <Marker at={0.45} word="h" />
      <Marker at={1} word="T*" />
      <Wrong d={path(rise(24, 9).map(([a, b]) => [a * 0.45, b] as const))} word=""  />
    </Frame>
  );
}

export function Overshoot() {
  const pts = Array.from({ length: 28 }, (_, i) => {
    const t = i / 27;
    return [t, 1 - Math.exp(-4 * t) + 0.34 * Math.sin(Math.PI * Math.min(1, t * 1.7)) * Math.exp(-2 * t)] as const;
  });
  return (
    <Frame label="A path whose absorbed fraction rises above one and comes back, against a dashed copy clipped flat at one; the clipped copy crosses a half earlier">
      <Axes yWord="abs" />
      <Rule at={0.72} word="1.0" />
      <Rule at={0.36} word="half" kind="mark" />
      <path className="coh-index__line" d={path(pts.map(([a, b]) => [a, b * 0.72] as const))} fill="none" />
      <Wrong d={path(pts.map(([a, b]) => [a, Math.min(b, 1) * 0.72] as const))} word="clipped" at={[0.74, 1.16]} />
    </Frame>
  );
}

export function Floor() {
  return (
    <Frame label="A plus or minus two sigma band about zero with one terminal move inside it, refused, and one outside it, measured; a third case where a single pre-event bar collapses the band to nothing and admits everything">
      <Axes />
      <Band from={0} to={1} word="±2σ" />
      <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(0.5)} y2={y(0.5)} />
      <line className="coh-survival__median" x1={x(0.22)} x2={x(0.22)} y1={y(0.5)} y2={y(0.66)} />
      <text className="coh-ladder__tick" x={x(0.22)} y={y(0.72)} textAnchor="middle">✕</text>
      <line className="coh-survival__median" x1={x(0.66)} x2={x(0.66)} y1={y(0.5)} y2={y(1.34)} />
      <text className="coh-ladder__tick" x={x(0.66)} y={y(1.42)} textAnchor="middle">✓</text>
      
    </Frame>
  );
}

export function HalfLife() {
  const grid = [0, 0.18, 0.34, 0.52, 0.7, 1];
  const abs = [0.08, 0.2, 0.34, 0.46, 0.58, 0.92];
  return (
    <Frame label="A geometric horizon grid with the last cell shaded because it spans a doubling; the crossing interpolated in log x sits apart from the crossing a linear reading would place at the cell's arithmetic midpoint">
      <Axes yWord="abs" />
      <Band from={0.7} to={1} word="a doubling" />
      <Rule at={0.5} word="half" />
      <path className="coh-index__line" d={path(grid.map((g, i) => [g, abs[i]] as const))} fill="none" />
      {grid.map((g, i) => (
        <circle key={g} className="coh-model__point" cx={x(g)} cy={y(abs[i])} r={2.4} />
      ))}
      <Marker at={0.78} word="log" />
      <Wrong d={`M${x(0.85)},${y(0)}L${x(0.85)},${y(1)}`} word="linear" at={[0.93, -0.22]} />
    </Frame>
  );
}

export function States() {
  const rows: ReadonlyArray<readonly [string, string, ReadonlyArray<readonly [number, number]>]> = [
    ["✓", "ok", rise(14).map(([a, b]) => [a, b] as const)],
    ["▲", "at_or_before_first", rise(14, 14)],
    ["◌", "never_reached", rise(14, 0.55).map(([a, b]) => [a, b * 0.62] as const)],
    ["◌", "too_few_points", [[0, 0.1], [0.28, 0.3]] as const],
  ];
  return (
    <Frame label="Four outcomes against one half rule: a crossing that resolves, a path already past a half at the first horizon, a path that never reaches it, and two points that are not a curve">
      {rows.map(([mark, word, pts], row) => {
        const top = 6 + row * 19;
        const sy = (unit: number) => top + 13 - unit * 12;
        const sx = (unit: number) => 8 + unit * 76;
        const d = pts.map(([px, py], i) => `${i ? "L" : "M"}${sx(px).toFixed(1)},${sy(py).toFixed(1)}`).join("");
        return (
          <g key={word}>
            <line className="coh-survival__half" x1={8} x2={84} y1={sy(0.5)} y2={sy(0.5)} />
            <path className={row === 0 ? "coh-index__line" : "diff-cardfig__wrong"} d={d} fill="none" />
            <text className="coh-ladder__tick" x={92} y={sy(0.35)}>{mark} {word}</text>
          </g>
        );
      })}
    </Frame>
  );
}

export function Exponential() {
  const u = (t: number, inf: number, k: number) => inf + (0.92 - inf) * Math.exp(-k * t);
  const pts = (inf: number, k: number) =>
    Array.from({ length: 22 }, (_, i) => [i / 21, u(i / 21, inf, k)] as const);
  return (
    <Frame label="The unpriced fraction decaying to a low asymptote, against a dashed fit whose asymptote has been walked upward until its residual looked small">
      <Axes yWord="u" />
      <path className="coh-index__line" d={path(pts(0.06, 3.4))} fill="none" />
      <Rule at={0.06} word="u∞" />
      <Wrong d={path(pts(0.45, 6.5))} word="walked up" at={[0.62, 0.72]} />
    </Frame>
  );
}

export function Power() {
  const expo = Array.from({ length: 24 }, (_, i) => [i / 23, 0.9 * Math.exp(-3.1 * (i / 23))] as const);
  const pow = Array.from({ length: 24 }, (_, i) => [i / 23, 0.9 * (1 + 7 * (i / 23)) ** -1.25] as const);
  return (
    <Frame label="An exponential and a power law drawn through the same unpriced fractions; inside the measured grid they agree, and past the last horizon they separate">
      <Axes yWord="u" />
      <Band from={0.62} to={1} word="past the grid" />
      <path className="coh-index__line" d={path(expo)} fill="none" />
      <Wrong d={path(pow)} word="power" at={[0.86, 0.34]} />
      <Marker at={0.62} word="last" />
    </Frame>
  );
}
