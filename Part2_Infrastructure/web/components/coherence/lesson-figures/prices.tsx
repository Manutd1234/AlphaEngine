/**
 * The three lessons about what a price IS on this exchange.
 *
 * Split out of `index.tsx` on 2026-08-25 when the registry grew past four
 * figures. Grouped the way the curriculum groups them, so a lesson and its
 * drawing are found the same way.
 */

import { Frame, HEIGHT, WIDTH } from "./frame";

/**
 * The grid: valid prices are the venue's own bands, and the bands are UNEVEN.
 *
 * Drawn as a ruler whose ticks bunch at the ends, because that is the fact —
 * finer steps at the edges of the range than in the centre. A reader who thinks
 * "tick size" is one number prices every market on the next structure wrong,
 * and the shape is what says otherwise before the sentence does.
 */
export function Grid() {
  const y = 52;
  const bands = [
    { from: 0.01, to: 0.05, step: 0.005 },
    { from: 0.05, to: 0.95, step: 0.05 },
    { from: 0.95, to: 0.99, step: 0.005 },
  ];
  const x = (p: number) => 16 + p * (WIDTH - 32);
  const ticks: number[] = [];
  for (const band of bands) {
    for (let p = band.from; p <= band.to + 1e-9; p += band.step) ticks.push(p);
  }
  return (
    <Frame label="A price ruler whose steps are finer at both ends than in the middle">
      <line x1={x(0)} x2={x(1)} y1={y} y2={y} className="coh-form__arrow" />
      {ticks.map((p, i) => (
        <line key={i} x1={x(p)} x2={x(p)} y1={y - 6} y2={y + 6} className="coh-lessonfig__tick" />
      ))}
      <text x={x(0)} y={y + 22} className="coh-form__note">$0.01</text>
      <text x={x(1)} y={y + 22} textAnchor="end" className="coh-form__note">$0.99</text>
      <text x={WIDTH / 2} y={y - 16} textAnchor="middle" className="coh-form__note">
        coarse in the middle
      </text>
      <text x={x(0.03)} y={22} textAnchor="middle" className="coh-form__note">fine</text>
      <text x={x(0.97)} y={22} textAnchor="middle" className="coh-form__note">fine</text>
    </Frame>
  );
}

/**
 * Absence: a market with no quote is not a market quoted at zero.
 *
 * Two rows that a careless reader would total the same way, drawn side by side:
 * one priced at nothing, one not priced at all. Zero is a legal Kalshi price,
 * which is exactly why the two must not collapse into one another.
 */
export function Absence() {
  const rows = [
    { label: "quoted at zero", drawn: true },
    { label: "not quoted", drawn: false },
  ];
  return (
    <Frame label="A market quoted at zero beside a market with no quote at all">
      {rows.map((row, i) => {
        const y = 30 + i * 34;
        return (
          <g key={row.label}>
            <text x={12} y={y + 4} className="coh-form__note">{row.label}</text>
            <line x1={110} x2={WIDTH - 16} y1={y} y2={y} className="coh-lessonfig__track" />
            {row.drawn ? (
              <circle cx={110} cy={y} r={5} className="coh-lessonfig__mark" />
            ) : (
              <text x={110} y={y + 4} className="coh-form__note">◌ —</text>
            )}
          </g>
        );
      })}
      <text x={WIDTH / 2} y={HEIGHT - 8} textAnchor="middle" className="coh-form__note">
        one is a price, the other is a gap
      </text>
    </Frame>
  );
}

/**
 * A binary book has two bid ladders and no asks.
 *
 * The claim is an identity — `yes_ask + no_ask = (1 − no_bid) + (1 − yes_bid)
 * = 1 + spread` — and it is the kind of arithmetic that is unarguable on a line
 * and slippery in a sentence. Two bars grow toward each other from opposite
 * ends, because that is what two bid ladders on a binary market ARE: everything
 * a YES buyer will pay, and everything a NO buyer will pay, measured from
 * opposite ends of the same dollar. The offer either side trades against is the
 * far end of the other bar.
 *
 * The gap between them is the spread, and drawing it is the point: the two bars
 * cannot overlap, so the two asks cannot sum to less than a dollar. A sum below
 * one is a torn snapshot — the two ladders read at different instants — and the
 * lesson's `whenItFails` says a bot trading on it trades its own latency.
 *
 * 42 and 55 are chosen, like every value in this registry. A three-cent gap is
 * wide enough to be a length rather than a rounding artefact.
 */
export function Book() {
  const left = 16;
  const span = WIDTH - 32;
  const at = (cents: number) => left + (cents / 100) * span;
  return (
    <Frame label="Two bid ladders growing toward each other from opposite ends of a dollar, with the spread as the gap between them">
      <rect x={left} y={40} width={span} height={20} className="coh-lessonfig__track" />
      <rect x={left} y={40} width={at(42) - left} height={20} className="coh-lessonfig__slice" />
      <rect x={at(45)} y={40} width={left + span - at(45)} height={20} className="coh-lessonfig__slice is-loud" />
      <text x={at(21)} y={54} textAnchor="middle" className="coh-lessonfig__tick">YES bid 42</text>
      <text x={at(72)} y={54} textAnchor="middle" className="coh-lessonfig__tick">NO bid 55</text>
      <line x1={at(42)} x2={at(45)} y1={32} y2={32} className="coh-lessonfig__mark-line" />
      <text x={at(43.5)} y={26} textAnchor="middle" className="coh-form__note">spread</text>
      <text x={left} y={HEIGHT - 8} className="coh-form__note">
        the asks are the far ends: 45 + 58 = a dollar and the spread, never less
      </text>
    </Frame>
  );
}
