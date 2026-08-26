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
  const barY = 52;
  let run = 0;
  return (
    <Frame
      label="A dollar split into four outcome prices that total less than the dollar"
      claim="buy every outcome, own the dollar"
    >
      <rect x={left} y={barY} width={span} height={24} className="coh-lessonfig__track">
        <title>
          The dollar the family is certain to pay. Exactly one outcome settles, so the set pays $1
          whatever happens — which is why the sum of the pieces is a test and not an estimate.
        </title>
      </rect>
      {parts.map((part, i) => {
        const from = run;
        run += part;
        return (
          <g key={i}>
            <rect x={x(from)} y={barY} width={part * span} height={24}
                  className="coh-lessonfig__slice">
              <title>
                {`Outcome ${i + 1}, priced ${part.toFixed(2)}. Its width is its price, so the four widths `
                 + "together are what buying the whole family costs."}
              </title>
            </rect>
            {/* THE PRICES, ON THE PIECES. Each width IS a price, and the figure
                was asking a reader to read four lengths off an unlabelled bar
                and add them — which is the arithmetic the lesson is about, done
                by eye instead of shown. */}
            <text x={x(from) + (part * span) / 2} y={barY + 16} textAnchor="middle"
                  className="coh-lessonfig__tick">
              {part.toFixed(2)}
            </text>
          </g>
        );
      })}

      {/* THE GAP, DRAWN. It was a `<title>` on the dollar rule, which put the
          one number the lesson exists for — the guaranteed profit — behind a
          hover. It is a span between where the pieces stop and where the dollar
          is, marked and priced. */}
      <line x1={x(total)} x2={x(1)} y1={barY - 9} y2={barY - 9} className="coh-lessonfig__mark-line">
        <title>
          {`The pieces stop ${(1 - total).toFixed(2)} short of the dollar they are certain to pay. Buy `
           + "every outcome and you own that gap whatever settles. This is the Dutch book the engine "
           + "exists to find."}
        </title>
      </line>
      <text x={(x(total) + x(1)) / 2} y={barY - 15} textAnchor="middle" className="coh-lessonfig__gap-note">
        {`${(1 - total).toFixed(2)} free`}
      </text>

      <line x1={x(1)} x2={x(1)} y1={barY - 4} y2={barY + 34} className="coh-lessonfig__rule">
        <title>Where the pieces would end if they cost exactly what they pay.</title>
      </line>
      <text x={x(1)} y={barY + 46} textAnchor="end" className="coh-form__note">$1 pays</text>
      <text x={left} y={barY + 46} className="coh-form__note">
        {`the pieces cost ${total.toFixed(2)}`}
      </text>
      <text x={left} y={24} className="coh-form__note">
        one outcome settles, so the set is worth a dollar whatever happens
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
    { r: 46, label: "≥ 95k", p: "0.62" },
    { r: 31, label: "≥ 100k", p: "0.31" },
    { r: 16, label: "≥ 105k", p: "0.09" },
  ];
  const cx = 62;
  const cy = 62;
  const listX = 128;
  return (
    <Frame
      label="Three nested thresholds, each contained in the one below it, with their prices falling in the same order"
      claim="contained implies never dearer, and the venue publishes both"
    >
      {rings.map((ring, i) => (
        <circle key={ring.label} cx={cx} cy={cy} r={ring.r} className="coh-lessonfig__ring">
          <title>
            {`Finishing ${ring.label}, priced ${ring.p}. `
             + (i === 0
               ? "The widest set: every outcome the tighter thresholds contain is inside this one too."
               : `Contained in ${rings[i - 1].label}, so it can never be dearer than ${rings[i - 1].p} — `
                 + "implication IS containment, and a price that broke the order would be a monotonicity "
                 + "violation the venue published against itself.")}
          </title>
        </circle>
      ))}

      {/* THE PRICES ON THE RINGS THEMSELVES, not only in a list beside them.
          The claim is that the nesting and the price ORDER agree, and a reader
          could not check that without carrying three numbers from a list back
          to three circles. */}
      {rings.map((ring) => (
        <text key={`p-${ring.label}`} x={cx} y={cy - ring.r + 12} textAnchor="middle"
              className="coh-lessonfig__tick">
          {ring.p}
        </text>
      ))}

      {rings.map((ring, i) => (
        <g key={`row-${ring.label}`}>
          <text x={listX} y={34 + i * 22} className="coh-form__note">{ring.label}</text>
          <text x={WIDTH - 16} y={34 + i * 22} textAnchor="end" className="coh-lessonfig__tick">
            {ring.p}
          </text>
          {/* The arrow of implication, drawn between consecutive rows: the
              tighter set implies the wider one, so its price may not exceed it.
              Three rows and two arrows, which is the relation rather than a
              property of any one row. */}
          {i > 0 ? (
            <path
              d={`M${listX + 62},${34 + i * 22 - 16} L${listX + 62},${34 + i * 22 - 6}`}
              className="coh-lessonfig__callout"
            />
          ) : null}
        </g>
      ))}
      <text x={listX} y={100} className="coh-form__note">falling, and it must</text>
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
  const left = 40;
  const span = WIDTH - 84;
  const scale = 0.36;
  const rowY = (index: number) => 34 + index * 24;
  const tStar = left + (worst / scale) * span;
  return (
    <Frame
      label="Three state bars all above a zero rule, with the shortest of them marked as the guaranteed profit"
      claim="the worst state still pays, so the portfolio is the proof"
    >
      <line x1={left} x2={left} y1={22} y2={108} className="coh-lessonfig__rule">
        <title>Zero. A bar reaching left of this would be a state the portfolio loses in.</title>
      </line>
      <text x={left - 4} y={20} textAnchor="end" className="coh-lessonfig__tick">0</text>

      {states.map((value, index) => (
        <g key={index}>
          <rect x={left} y={rowY(index)} width={(value / scale) * span} height={15}
                className={value === worst ? "coh-lessonfig__slice is-loud" : "coh-lessonfig__slice"}>
            <title>
              {`State s${index + 1}: the portfolio pays ${value.toFixed(2)} net of what it cost. `
               + (value === worst
                 ? "The WORST state, and the one the whole programme is about — t* is this bar's length."
                 : "Above the worst, so it is not what the guarantee is measured on.")}
            </title>
          </rect>
          <text x={left - 6} y={rowY(index) + 12} textAnchor="end" className="coh-lessonfig__tick">
            {`s${index + 1}`}
          </text>
          {/* WHAT EACH STATE PAYS, PRINTED. The bars are drawn to scale and the
              lesson turns on which is SHORTEST, but the figure asked a reader
              to take three lengths on trust and never told them what any of
              them was worth. */}
          <text x={left + (value / scale) * span + 6} y={rowY(index) + 12} className="coh-lessonfig__tick">
            {value.toFixed(2)}
          </text>
        </g>
      ))}

      <line x1={tStar} x2={tStar} y1={22} y2={108} className="coh-lessonfig__mark-line">
        <title>
          {`t* = ${worst.toFixed(2)}, the profit in the worst state rather than in some state. It touches `
           + "the SHORTEST bar, never the average of them, and it sits above zero — so every state pays "
           + "and the least generous one still pays this much. Maximising it is what makes the answer a "
           + "certificate rather than a hopeful trade."}
        </title>
      </line>
      <text x={tStar + 4} y={20} className="coh-lessonfig__gap-note">{`t* = ${worst.toFixed(2)}`}</text>
      {/* NO SPAN FROM ZERO TO t* HERE. It was drawn at y=110 with "guaranteed in
          every state" under it at 122, which is inside the claim's band — the
          two printed over each other. It was also the third time one figure
          said one thing: the rule is labelled `t*`, the shortest bar is loud,
          and the claim under the figure says the worst state still pays. */}
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
  const left = 26;
  const step = (WIDTH - 52) / quotes.length;
  const base = 84;
  const y = (p: number) => base - p * 58;
  const cx = (i: number) => left + i * step + step / 2;
  return (
    <Frame
      label="Four descending strike quotes with the gap between two of them dropped to a bar as the implied mass"
      claim="the mass between two strikes is what their prices differ by"
    >
      <line x1={left} x2={WIDTH - 26} y1={base} y2={base} className="coh-lessonfig__rule" />
      <polyline
        points={quotes.map((p, i) => `${cx(i)},${y(p)}`).join(" ")}
        className="coh-lessonfig__curve"
      />
      {quotes.map((p, i) => (
        <g key={i}>
          <circle cx={cx(i)} cy={y(p)} r={3.5} className="coh-lessonfig__mark">
            <title>
              {`Strike k${i + 1}, quoted ${p.toFixed(2)}. This is S(k${i + 1}) — the chance of finishing `
               + "ABOVE it — which is what the exchange publishes. It never publishes the mass between two "
               + "strikes; that is a subtraction anyone can do and almost nobody does."}
            </title>
          </circle>
          {/* THE QUOTES, PRINTED. The subtraction is the lesson, and a reader
              cannot do it in their head off four unlabelled dots. */}
          <text x={cx(i)} y={y(p) - 8} textAnchor="middle" className="coh-lessonfig__tick">
            {p.toFixed(2)}
          </text>
          <text x={cx(i)} y={base + 14} textAnchor="middle" className="coh-form__note">
            {`k${i + 1}`}
          </text>
        </g>
      ))}
      <line x1={cx(1)} x2={cx(1)} y1={y(quotes[1])} y2={y(quotes[2])} className="coh-lessonfig__mark-line" />
      <rect x={cx(1)} y={y(quotes[2])} width={step} height={(quotes[1] - quotes[2]) * 58}
            className="coh-lessonfig__slice is-loud">
        <title>
          {`The implied mass between k₂ and k₃: ${quotes[1].toFixed(2)} − ${quotes[2].toFixed(2)} = `
           + `${(quotes[1] - quotes[2]).toFixed(2)}. One subtraction, and the quoted ladder becomes a `
           + "distribution. Only one bar is drawn on purpose — four would make this a picture of a "
           + "distribution, which a reader has seen, instead of a picture of the OPERATION."}
        </title>
      </rect>
      <text x={cx(1) + step / 2} y={y(quotes[2]) - 6} textAnchor="middle" className="coh-lessonfig__gap-note">
        {`= ${(quotes[1] - quotes[2]).toFixed(2)}`}
      </text>
      <text x={left} y={20} className="coh-form__note">
        the venue quotes S(k); it never quotes the mass between two of them
      </text>
    </Frame>
  );
}
