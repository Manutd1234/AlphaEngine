/**
 * The lessons about a bound that is not the naive one.
 *
 * Split out of `index.tsx` on 2026-08-25 with the rest of the registry.
 */

import { Frame, HEIGHT, WIDTH } from "./frame";

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
  let run = 0;
  return (
    <Frame label="A fee bar in which the rounding component dwarfs the trading component">
      <rect x={left} y={36} width={span} height={22} className="coh-lessonfig__track">
        <title>
          The whole fee on one fill, at the clip size where the split hurts. Drawn to the proportions of
          Kalshi&rsquo;s own published example; the lengths are the ratio, not a reading off a live book.
        </title>
      </rect>
      {parts.map((part) => {
        const from = run;
        run += part.value;
        return (
          <g key={part.label}>
            <rect x={left + (from / total) * span} y={36} width={(part.value / total) * span} height={22}
                  className={part.className}>
              <title>{part.says}</title>
            </rect>
            <text x={left + ((from + part.value / 2) / total) * span} y={30} textAnchor="middle"
                  className="coh-form__note">{part.label}</text>
          </g>
        );
      })}
      <text x={left} y={HEIGHT - 8} className="coh-form__note">
        nineteen times the one every bot models
      </text>
    </Frame>
  );
}
