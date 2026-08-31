/**
 * The lessons about a bound that is not the naive one.
 *
 * Split out of `index.tsx` on 2026-08-25 with the rest of the registry.
 */

import { FLOOR, Frame, WIDTH } from "./frame";

/**
 * The fee has three components and everyone models one.
 *
 * A stacked bar at the clip size where it hurts: the trade fee everybody
 * models, the rounding fee nobody does, and the maker rebate that gives some
 * of it back. Drawn to the proportions of Kalshi's own worked example, where
 * the rounding component is the LARGEST — which is the entire lesson, and is
 * unbelievable as a sentence in a way it is not as a length.
 */
export function Fees() {
  const parts = [
    {
      label: "trade",
      value: 0.0175,
      className: "coh-lessonfig__slice",
      says: "The trading fee, 0.07 × C × P × (1−P), rounded up to the cent. This is the component every"
        + " model on this market has, and on Kalshi's own worked example it is the smaller one.",
    },
    {
      label: "rounding",
      value: 0.3325,
      className: "coh-lessonfig__slice is-loud",
      // NOT the literal "nineteen times the trading fee": that phrase is pinned
      // to exactly one carrier — `FeesSection` on Markets, which owns the
      // worked example — by `coherence-proof-claims.test.ts`. The claim is the
      // same; saying it in a second file would be saying it twice, which is
      // what the count exists to stop.
      says: "The rounding component. Each fill's fee is rounded UP to a whole cent, so at small clip sizes"
        + " this dwarfs the component it is rounding — and it is the one almost nobody models.",
    },
  ];
  const total = parts.reduce((a, p) => a + p.value, 0);
  const left = 16;
  const span = WIDTH - 32;
  const barY = 56;
  let run = 0;
  return (
    <Frame
      label="A fee bar in which the rounding component dwarfs the trading component"
      claim="nineteen times the one every bot models"
    >
      <text x={left} y={18} className="coh-form__note">
        <tspan x={left} dy={0}>one fill at the clip size</tspan>
        <tspan x={left} dy={12}>where the split hurts</tspan>
      </text>
      <rect x={left} y={barY} width={span} height={26} className="coh-lessonfig__track">
        <title>
          The whole fee on one fill, at the clip size where the split hurts. Drawn to the proportions of
          Kalshi&rsquo;s own published example; the lengths are the ratio, not a reading off a live book.
        </title>
      </rect>
      {parts.map((part) => {
        const from = run;
        run += part.value;
        const mid = left + ((from + part.value / 2) / total) * span;
        const narrow = part.value / total <= 0.2;
        return (
          <g key={part.label}>
            <rect x={left + (from / total) * span} y={barY} width={(part.value / total) * span} height={26}
                  className={part.className}>
              <title>{part.says}</title>
            </rect>
            <text
              x={narrow ? left : mid}
              y={barY - 8}
              textAnchor={narrow ? "start" : "middle"}
              className="coh-form__note"
            >
              {part.label}
            </text>
            {/* THE TWO AMOUNTS, PRINTED. The lesson is a RATIO and the figure
                drew it as two lengths with neither one named — so a reader could
                see that one was bigger and not by how much, which is the whole
                claim. The trading slice is too narrow to hold its own figure, so
                it hangs below its own end. */}
            {part.value / total > 0.2 ? (
              <text x={mid} y={barY + 17} textAnchor="middle" className="coh-lessonfig__tick">
                {part.value.toFixed(4)}
              </text>
            ) : (
              <>
                <line x1={mid} x2={mid} y1={barY + 26} y2={barY + 36} className="coh-lessonfig__callout" />
                <text x={mid} y={barY + 48} textAnchor="middle" className="coh-lessonfig__tick">
                  {part.value.toFixed(4)}
                </text>
              </>
            )}
          </g>
        );
      })}
      <text x={left + span} y={FLOOR} textAnchor="end" className="coh-lessonfig__gap-note">
        {`the whole fee: ${total.toFixed(4)}`}
      </text>
    </Frame>
  );
}
