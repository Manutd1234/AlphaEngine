"use client";

/**
 * The six figures for the cards about the instrument built on the measurement.
 *
 * Same rules as the measurement half: the mechanism drawn, the card's own
 * failure drawn beside it dashed and labelled, no mark a reader could mistake
 * for a reading, and every label on the 10px tick class.
 *
 * ONE OF THEM DELIBERATELY DOES NOT DRAW ITS OWN IDENTITY. `identity` states
 * that the spectrum's integral IS the mutual information, and `SpectrumExplorer`
 * already DEMONSTRATES that — it computes both sides into two chips, and its
 * header records that demonstrating rather than printing it is the reason that
 * view exists. Drawing it a third time here would be the shape this codebase
 * guards against, so this card's figure draws its `breaks` clause instead: the
 * learned estimator is biased upward, so a small positive number is not
 * evidence and the floor has to come from a shuffled null.
 */

import { Axes, Band, Frame, Marker, Rule, Wrong, path, x, y } from "./primitives";

const sigmoid = (v: number) => (v >= 0 ? 1 / (1 + Math.exp(-v)) : Math.exp(v) / (1 + Math.exp(v)));

export function Clock() {
  const wall = [0.06, 0.18, 0.34, 0.52, 0.72, 0.95];
  const vol = [0.1, 0.3, 0.44, 0.55, 0.78, 0.95];
  return (
    <Frame label="The same six horizons on two axes: wall-clock seconds above, and the variance matched no-news windows had accumulated by then below; connectors show which horizons move">
      <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(0.86)} y2={y(0.86)} />
      <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(0.18)} y2={y(0.18)} />
      <text className="coh-ladder__tick" x={2} y={y(0.98)}>wall</text>
      <text className="coh-ladder__tick" x={2} y={y(0.3)}>vol</text>
      {wall.map((w, i) => (
        <g key={w}>
          <line className="coh-survival__half" x1={x(w)} x2={x(vol[i])} y1={y(0.86)} y2={y(0.18)} />
          <circle className="coh-model__point" cx={x(w)} cy={y(0.86)} r={2.2} />
          <circle className="coh-model__point" cx={x(vol[i])} cy={y(0.18)} r={2.2} />
        </g>
      ))}
    </Frame>
  );
}

export function Percentile() {
  const controls = [0.12, 0.2, 0.31, 0.38, 0.46, 0.55, 0.63, 0.71, 0.8, 0.9];
  return (
    <Frame label="One stage ranked against matched no-news windows twice: at the left of every control, and in the middle of them, with the same half-life in seconds either way">
      {[0.72, 0.24].map((row, index) => (
        <g key={row}>
          <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(row)} y2={y(row)} />
          {controls.map((c) => (
            <line key={c} className="coh-survival__half" x1={x(c)} x2={x(c)} y1={y(row) - 4} y2={y(row) + 4} />
          ))}
          <line
            className="coh-survival__median"
            x1={x(index ? 0.5 : 0.06)} x2={x(index ? 0.5 : 0.06)}
            y1={y(row) - 8} y2={y(row) + 8}
          />
          <text className="coh-ladder__tick" x={x(1)} y={y(row) - 7} textAnchor="end">
            {index ? "p ≈ 0.5" : "p ≈ 0.02"}
          </text>
        </g>
      ))}
      <text className="coh-ladder__tick" x={x(0)} y={y(-0.34)}>same half-life, opposite readings</text>
    </Frame>
  );
}

export function Mmse() {
  const curve = (shift: number) =>
    Array.from({ length: 40 }, (_, i) => {
      const a = -6 + (12 * i) / 39;
      return [(a + 6) / 12, sigmoid(a + shift)] as const;
    });
  const sum = Array.from({ length: 40 }, (_, i) => {
    const a = -6 + (12 * i) / 39;
    return [(a + 6) / 12, (sigmoid(a - 2) + sigmoid(a) + sigmoid(a + 2)) / 3] as const;
  });
  return (
    <Frame label="The Bayes-optimal error rising across log signal-to-noise as a sum of shifted sigmoids, with its two tails shaded because the raw error diverges at both and only the difference against a matched Gaussian converges">
      <Axes yWord="mmse" />
      <Band from={0} to={0.12} word="" />
      <Band from={0.88} to={1} word="" />
      {[-2, 0, 2].map((s) => (
        <Wrong key={s} d={path(curve(s))} word="" />
      ))}
      <path className="coh-index__line" d={path(sum)} fill="none" />
      <text className="coh-ladder__tick" x={x(0.5)} y={y(-0.34)} textAnchor="middle">α, log-SNR</text>
    </Frame>
  );
}

export function Spectrum() {
  const bump = (a: number, centre: number, width: number) => Math.exp(-(((a - centre) / width) ** 2));
  const real = Array.from({ length: 48 }, (_, i) => {
    const a = -6 + (12 * i) / 47;
    return [(a + 6) / 12, 0.35 * bump(a, -3, 1.5) + 0.55 * bump(a, 0, 1.3) + 0.4 * bump(a, 3, 1.4)] as const;
  });
  const white = Array.from({ length: 48 }, (_, i) => {
    const a = -6 + (12 * i) / 47;
    return [(a + 6) / 12, 0.95 * bump(a, 0, 0.7)] as const;
  });
  return (
    <Frame label="The information density spread across resolution, against a dashed whitened version collapsed to one bump at zero where the resolution axis has been destroyed">
      <Axes yWord="g(α)" />
      <path className="coh-index__line" d={path(real)} fill="none" />
      <Wrong d={path(white)} word="whitened" at={[0.5, 1.18]} />
      <text className="coh-ladder__tick" x={x(0)} y={y(-0.34)}>coarse</text>
      <text className="coh-ladder__tick" x={x(1)} y={y(-0.34)} textAnchor="end">fine</text>
    </Frame>
  );
}

export function Identity() {
  const hump = Array.from({ length: 36 }, (_, i) => {
    const t = i / 35;
    return [0.42 + t * 0.5, Math.exp(-(((t - 0.45) / 0.26) ** 2))] as const;
  });
  return (
    <Frame label="A signed axis about zero: the closed form sits exactly at zero when the conditioning carries nothing, while the learned estimator's shuffled null lies entirely to the right of it, so a standard-error floor falls inside the null and only the shuffled floor clears it">
      <Axes />
      <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(0)} />
      <Marker at={0.36} word="0" />
      <circle className="coh-model__point" cx={x(0.36)} cy={y(0)} r={3} />
      <text className="coh-ladder__tick" x={x(0.34)} y={y(1.2)} textAnchor="end">closed form</text>
      <path className="coh-model__area" d={`${path(hump)}L${x(0.92)},${y(0)}L${x(0.42)},${y(0)}Z`} />
      <Wrong d={`M${x(0.5)},${y(0)}L${x(0.5)},${y(1)}`} word="✕ SE floor" at={[0.72, 1.2]} />
      <line className="coh-survival__median" x1={x(0.86)} x2={x(0.86)} y1={y(0)} y2={y(1)} />
      <text className="coh-ladder__tick" x={x(1)} y={y(-0.34)} textAnchor="end">✓ shuffled null</text>
    </Frame>
  );
}

export function Skill() {
  const pts: ReadonlyArray<readonly [number, number]> = [
    [0.08, 0.3], [0.2, 0.52], [0.32, 0.36], [0.44, 0.66], [0.56, 0.5], [0.68, 0.78], [0.8, 0.62], [0.92, 0.86],
  ];
  const fit = (t: number) => 0.28 + 0.58 * t;
  return (
    <Frame label="Held-out points against a flat mean and a fitted line: the residuals to the mean are the total sum of squares and the residuals to the fit are what is left, and the gain a text adds is drawn signed so a negative one is reported rather than floored">
      <Axes yWord="resid" />
      <Rule at={0.55} word="mean" />
      <path className="coh-index__line" d={path([[0, fit(0)], [1, fit(1)]])} fill="none" />
      {pts.map(([px, py]) => (
        <g key={px}>
          <line className="coh-survival__half" x1={x(px)} x2={x(px)} y1={y(py)} y2={y(fit(px))} />
          <circle className="coh-model__point" cx={x(px)} cy={y(py)} r={2.2} />
        </g>
      ))}
      <text className="coh-ladder__tick" x={x(1)} y={y(-0.34)} textAnchor="end">signed gain</text>
    </Frame>
  );
}
