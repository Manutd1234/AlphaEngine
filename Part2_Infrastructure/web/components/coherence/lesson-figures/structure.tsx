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

/**
 * The certificate of infeasibility is the trade.
 *
 * `max t subject to payoff − cost ≥ t`. The abstraction that makes this lesson
 * hard is that `t` is not a profit in some state — it is the profit in the
 * WORST state, and maximising it is what makes the answer a certificate rather
 * than a hopeful trade. So: one bar per state, each the payoff net of cost, and
 * a rule at the shortest of them. That rule is `t*`, and the claim a reader
 * should leave with is that it sits ABOVE zero — every state pays, and the
 * least generous one still pays this much.
 *
 * Three states, not two, because two invite the reading "it wins or it loses".
 * The values are chosen; what is drawn to scale is their ORDER and the fact
 * that the rule touches the smallest bar rather than the average of them.
 */
export function Duality() {
  const states = [0.31, 0.09, 0.22];
  const worst = Math.min(...states);
  const left = 44;
  const span = WIDTH - 60;
  const scale = 0.36;
  return (
    <Frame label="Three state bars all above a zero rule, with the shortest of them marked as the guaranteed profit">
      <line x1={left} x2={left} y1={16} y2={78} className="coh-lessonfig__rule" />
      <text x={left - 4} y={14} textAnchor="end" className="coh-lessonfig__tick">0</text>
      {states.map((value, index) => (
        <g key={index}>
          <rect x={left} y={20 + index * 18} width={(value / scale) * span} height={12}
                className={value === worst ? "coh-lessonfig__slice is-loud" : "coh-lessonfig__slice"} />
          <text x={left - 6} y={30 + index * 18} textAnchor="end" className="coh-lessonfig__tick">
            {`s${index + 1}`}
          </text>
        </g>
      ))}
      <line x1={left + (worst / scale) * span} x2={left + (worst / scale) * span} y1={16} y2={78}
            className="coh-lessonfig__mark-line" />
      <text x={left + (worst / scale) * span + 4} y={14} className="coh-form__note">t*</text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        the worst state still pays, so the portfolio is the proof
      </text>
    </Frame>
  );
}

/**
 * A ladder of strikes is a distribution, one subtraction at a time.
 *
 * `pmf(kᵢ, kᵢ₊₁] = S(kᵢ) − S(kᵢ₊₁)`. The survival function is what the exchange
 * quotes — each strike's price is the chance of finishing above it — and the
 * mass between two strikes is a SUBTRACTION nobody had to publish. So the
 * figure is the descending ladder of quotes with one gap bracketed and dropped
 * to a bar beneath it: the subtraction, performed once, in the place it happens.
 *
 * Only one bar is drawn rather than the whole histogram. Drawing all four turns
 * this into a picture of a distribution, which the reader has seen; drawing one
 * keeps it a picture of the OPERATION, which is the lesson.
 */
export function Distribution() {
  const quotes = [0.82, 0.61, 0.34, 0.12];
  const left = 22;
  const step = (WIDTH - 44) / quotes.length;
  const base = 60;
  const y = (p: number) => base - p * 40;
  return (
    <Frame label="Four descending strike quotes with the gap between two of them dropped to a bar as the implied mass">
      <line x1={left} x2={WIDTH - 22} y1={base} y2={base} className="coh-lessonfig__rule" />
      <polyline
        points={quotes.map((p, i) => `${left + i * step + step / 2},${y(p)}`).join(" ")}
        className="coh-lessonfig__curve"
      />
      {quotes.map((p, i) => (
        <circle key={i} cx={left + i * step + step / 2} cy={y(p)} r={3} className="coh-lessonfig__mark" />
      ))}
      <line x1={left + step + step / 2} x2={left + step + step / 2} y1={y(quotes[1])} y2={y(quotes[2])}
            className="coh-lessonfig__mark-line" />
      <rect x={left + step + step / 2} y={y(quotes[2])} width={step} height={(quotes[1] - quotes[2]) * 40}
            className="coh-lessonfig__slice is-loud" />
      <text x={left + step + step / 2 + 4} y={y(quotes[1]) - 4} className="coh-form__note">
        S(k₂) − S(k₃)
      </text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        the mass between two strikes is what their prices differ by
      </text>
    </Frame>
  );
}
