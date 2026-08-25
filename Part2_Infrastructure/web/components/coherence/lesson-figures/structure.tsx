/**
 * The lessons about what the venue's own structure implies.
 *
 * Split out of `index.tsx` on 2026-08-25 with the rest of the registry.
 */

import { Frame, HEIGHT, WIDTH } from "./frame";

/**
 * A mutually exclusive family is one dollar sold in pieces.
 *
 * The dollar is the bar; the outcomes are its segments; the gap at the end is
 * what the basket costs against what it pays. Drawn under a dollar, because
 * that is the interesting case — a family whose pieces total less than the
 * whole is the Dutch book this engine exists to find.
 */
export function Basket() {
  const parts = [0.31, 0.28, 0.22, 0.13];
  const total = parts.reduce((a, b) => a + b, 0);
  const left = 16;
  const span = WIDTH - 32;
  const x = (p: number) => left + p * span;
  let run = 0;
  return (
    <Frame label="A dollar split into four outcome prices that total less than the dollar">
      <rect x={left} y={34} width={span} height={20} className="coh-lessonfig__track" />
      {parts.map((part, i) => {
        const from = run;
        run += part;
        return (
          <rect key={i} x={x(from)} y={34} width={part * span} height={20}
                className="coh-lessonfig__slice" />
        );
      })}
      <line x1={x(1)} x2={x(1)} y1={26} y2={62} className="coh-lessonfig__rule" />
      <text x={x(1)} y={22} textAnchor="end" className="coh-form__note">$1 pays</text>
      <text x={x(total)} y={72} textAnchor="middle" className="coh-form__note">
        the pieces cost {total.toFixed(2)}
      </text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        buy every outcome, own the dollar
      </text>
    </Frame>
  );
}

/**
 * The lattice: the venue publishes which markets imply which.
 *
 * Three nested thresholds — `≥105k` inside `≥100k` inside `≥95k` — because
 * implication IS containment, and a containment is a picture. The prices must
 * fall in the same order the sets nest; a reader who has seen the nesting knows
 * what a monotonicity violation is without the word.
 */
export function Lattice() {
  const rings = [
    { r: 40, label: "≥ 95k", p: "0.62" },
    { r: 27, label: "≥ 100k", p: "0.31" },
    { r: 14, label: "≥ 105k", p: "0.09" },
  ];
  const cx = 62;
  const cy = HEIGHT / 2;
  return (
    <Frame label="Three nested thresholds, each contained in the one below it, with their prices">
      {rings.map((ring) => (
        <circle key={ring.label} cx={cx} cy={cy} r={ring.r} className="coh-lessonfig__ring" />
      ))}
      {rings.map((ring, i) => (
        <text key={ring.label} x={118} y={26 + i * 22} className="coh-form__note">
          {`${ring.label} priced ${ring.p}`}
        </text>
      ))}
      <text x={118} y={HEIGHT - 10} className="coh-form__note">contained ⟹ never dearer</text>
    </Frame>
  );
}
