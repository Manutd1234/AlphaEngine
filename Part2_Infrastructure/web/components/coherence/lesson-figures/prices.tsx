/**
 * The three lessons about what a price IS on this exchange.
 *
 * Split out of `index.tsx` on 2026-08-25 when the registry grew past four
 * figures. Grouped the way the curriculum groups them, so a lesson and its
 * drawing are found the same way.
 *
 * REDRAWN 2026-08-26 onto the wider canvas. "the diagrams need to be better,
 * need more innovation, revamp the diagrams." What each of these three gained
 * is the same thing: the NUMBER its claim turns on, drawn rather than left in a
 * hover. A figure whose quantities are only in `<title>` is a picture of a
 * shape a reader has to be told the meaning of.
 */

import { FLOOR, Frame, WIDTH } from "./frame";

/**
 * The grid: valid prices are the venue's own bands, and the bands are UNEVEN.
 *
 * Drawn as a ruler whose ticks bunch at the ends, because that is the fact —
 * finer steps at the edges of the range than in the centre. A reader who thinks
 * "tick size" is one number prices every market on the next structure wrong,
 * and the shape is what says otherwise before the sentence does.
 *
 * THE STEP SIZES ARE PRINTED NOW. Tick density says the bands differ; it does
 * not say by how much, and "ten times finer" is the fact a reader needs to
 * carry away. Three labels under the three bands, and a brace over each so the
 * label is attached to a span rather than floating near one.
 */
export function Grid() {
  const y = 60;
  const bands = [
    { from: 0.01, to: 0.05, step: 0.005 },
    { from: 0.05, to: 0.95, step: 0.05 },
    { from: 0.95, to: 0.99, step: 0.005 },
  ];
  const x = (p: number) => 16 + p * (WIDTH - 32);
  const ticks: Array<{ p: number; step: number }> = [];
  for (const band of bands) {
    for (let p = band.from; p <= band.to + 1e-9; p += band.step) ticks.push({ p, step: band.step });
  }
  return (
    <Frame
      label="A price ruler whose steps are finer at both ends than in the middle"
      claim="one number called tick size prices the next structure wrong"
    >
      <line x1={x(0)} x2={x(1)} y1={y} y2={y} className="coh-form__arrow">
        <title>
          The whole quotable range, $0.01 to $0.99. A price outside it is not a cheap price — it is a
          price the venue will not accept, which is why an order built from a model&rsquo;s continuous
          output has to be snapped to this ruler before it is sent.
        </title>
      </line>
      {ticks.map((tick, i) => (
        <line key={i} x1={x(tick.p)} x2={x(tick.p)} y1={y - 8} y2={y + 8} className="coh-lessonfig__tick">
          <title>
            {`A quotable price at ${tick.p.toFixed(3)}. The step here is ${tick.step.toFixed(3)} — `
             + `${tick.step < 0.01
                ? "the fine grid the venue uses near the ends of the range"
                : "the coarse grid it uses through the middle"}`
             + ". One number called “tick size” prices every market on the next structure wrong."}
          </title>
        </line>
      ))}
      {/* A BRACE PER BAND, so each step size is attached to the span it
          describes. Floating the labels near the ruler left a reader guessing
          which one applied where, which is the whole distinction. */}
      {bands.map((band) => {
        const from = x(band.from);
        const to = x(band.to);
        const mid = (from + to) / 2;
        return (
          <g key={band.from}>
            <path
              d={`M${from},${y + 18} L${from},${y + 23} L${to},${y + 23} L${to},${y + 18}`}
              className="coh-lessonfig__brace"
            />
            <text x={mid} y={y + 36} textAnchor="middle" className="coh-lessonfig__tick">
              {`step ${band.step.toFixed(3)}`}
            </text>
          </g>
        );
      })}
      <text x={x(0)} y={y - 16} className="coh-form__note">$0.01</text>
      <text x={x(1)} y={y - 16} textAnchor="end" className="coh-form__note">$0.99</text>
      <text x={WIDTH / 2} y={16} textAnchor="middle" className="coh-form__note">
        <tspan x={WIDTH / 2} dy={0}>ten times finer at both ends</tspan>
        <tspan x={WIDTH / 2} dy={12}>than through the middle</tspan>
      </text>
    </Frame>
  );
}

/**
 * Absence: a market with no quote is not a market quoted at zero.
 *
 * Two rows that a careless reader would total the same way, drawn side by side:
 * one priced at nothing, one not priced at all. Zero is a legal Kalshi price,
 * which is exactly why the two must not collapse into one another.
 *
 * THE CONSEQUENCE IS DRAWN NOW, and it is the reason the lesson exists. The two
 * rows on their own are a distinction; what a reader has to leave with is what
 * the distinction COSTS, which is a basket summed over the quoted legs alone
 * coming out under a dollar and looking like an arbitrage. So the two rows feed
 * a third: the sum, once honestly and once with the gap read as zero.
 */
export function Absence() {
  const rows = [
    { label: "quoted at zero", drawn: true, price: "0.00" },
    { label: "not quoted", drawn: false, price: "—" },
  ];
  const track = 132;
  const value = WIDTH - 40;
  return (
    <Frame
      label="A market quoted at zero beside a market with no quote at all, and what totalling them together costs"
      claim="one is a price, the other is a gap, and summing them alike invents 0.06 of edge"
    >
      {rows.map((row, i) => {
        const y = 30 + i * 26;
        return (
          <g key={row.label}>
            <text x={8} y={y + 4} className="coh-form__note">{row.label}</text>
            <line x1={track} x2={value - 34} y1={y} y2={y} className="coh-lessonfig__track" />
            {row.drawn ? (
              <circle cx={track} cy={y} r={5} className="coh-lessonfig__mark">
                <title>
                  A market quoted at zero. Somebody has looked and offered nothing, which is a
                  measurement: zero is a legal price on this venue and it means the market is worthless,
                  not unknown.
                </title>
              </circle>
            ) : (
              <text x={track - 6} y={y + 5} className="coh-lessonfig__gap" aria-hidden="true">
                ◌
                <title>
                  A market with no quote at all. Nobody is resting on this side, so the price is
                  UNKNOWN. Totalling it as zero turns &ldquo;we do not know&rdquo; into &ldquo;it is
                  worthless&rdquo;, and every sum built on it is understated by exactly the legs that
                  were never priced.
                </title>
              </text>
            )}
            <text x={value} y={y + 4} textAnchor="end" className="coh-lessonfig__tick">{row.price}</text>
          </g>
        );
      })}

      {/* THE CONSEQUENCE, AS TWO TOTALS. The distinction above is what the
          lesson SAYS; this is what it costs, and it is the reason the lesson
          exists — a basket summed over the quoted legs alone comes out under
          the dollar it pays and reads as an arbitrage that is not there. */}
      <line x1={8} x2={value} y1={78} y2={78} className="coh-lessonfig__rule" />
      <text x={8} y={94} className="coh-form__note">what the family really costs</text>
      <text x={value} y={94} textAnchor="end" className="coh-lessonfig__tick">1.02</text>
      <text x={8} y={FLOOR} className="coh-form__note">summed over the quoted legs</text>
      <text x={value} y={FLOOR} textAnchor="end" className="coh-lessonfig__gap-note">
        0.94
        <title>
          The six cents between the two totals are the unquoted leg. Read as zero it looks like a family
          costing less than the dollar it pays, which is an arbitrage that does not exist.
        </title>
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
 * cannot overlap, so the two asks cannot sum to less than a dollar.
 *
 * THE ASKS ARE MARKED ON THE BAR NOW. They are the whole identity and they were
 * a hover: each side's ask is the far end of the OTHER side's ladder, which is
 * a position on this bar and was being described in words instead of pointed
 * at. Two callouts, each on the end it names.
 *
 * 42 and 55 are chosen, like every value in this registry. A three-cent gap is
 * wide enough to be a length rather than a rounding artefact.
 */
export function Book() {
  const left = 16;
  const span = WIDTH - 32;
  const barY = 52;
  const barH = 22;
  const at = (cents: number) => left + (cents / 100) * span;
  return (
    <Frame
      label="Two bid ladders growing toward each other from opposite ends of a dollar, with the spread as the gap between them"
      claim="the asks are the far ends: 45 + 58 = a dollar and the spread, never less"
    >
      {/* THE SPREAD ABOVE, THE TWO ASKS BELOW, and the split is what stopped
          them colliding. The first version put a header note, the spread label
          and one ask callout all in the twenty pixels above the bar: three
          strings within thirteen pixels of each other, at a width where two of
          them are sixty pixels wide. Seen at a viewport — SVG text neither
          wraps nor clips, so it simply printed over itself. */}
      <text x={left} y={30} className="coh-form__note">$0</text>
      <text x={left + span} y={30} textAnchor="end" className="coh-form__note">$1</text>

      <rect x={left} y={barY} width={span} height={barH} className="coh-lessonfig__track">
        <title>
          One dollar, measured from both ends. A binary market pays exactly $1 to one side, so the two
          bid ladders are two claims on the same dollar and the bar is the dollar itself.
        </title>
      </rect>
      <rect x={left} y={barY} width={at(42) - left} height={barH} className="coh-lessonfig__slice">
        <title>
          The YES bid ladder, resting to 42. This is what a YES buyer will pay — and the NO side&rsquo;s
          offer is its far end: a NO ask of 58 IS this ladder read from the other direction, at
          1 &minus; 0.42.
        </title>
      </rect>
      <rect x={at(45)} y={barY} width={left + span - at(45)} height={barH}
            className="coh-lessonfig__slice is-loud">
        <title>
          The NO bid ladder, resting to 55, measured from the opposite end. The YES ask of 45 is its far
          end, at 1 &minus; 0.55. Neither ask is quoted by anyone: both are readings of the other
          side&rsquo;s bids.
        </title>
      </rect>
      <text x={at(21)} y={barY + 15} textAnchor="middle" className="coh-lessonfig__tick">YES bid 42</text>
      <text x={at(72)} y={barY + 15} textAnchor="middle" className="coh-lessonfig__tick">NO bid 55</text>

      <line x1={at(42)} x2={at(45)} y1={barY - 10} y2={barY - 10} className="coh-lessonfig__mark-line">
        <title>
          The spread, three cents. The two ladders cannot overlap, so the two asks cannot sum to less
          than a dollar: 45 + 58 = 103. A snapshot showing them summing BELOW one has been torn — the
          ladders were read at different instants — and a bot trading on it is trading its own latency.
        </title>
      </line>
      <text x={at(43.5)} y={barY - 16} textAnchor="middle" className="coh-form__note">3c spread</text>

      {/* THE TWO ASKS, POINTED AT, on one line and reading outward from the gap.
          They are nine pixels apart on the bar and sixty wide as words, so they
          share a baseline only because one is anchored left of its mark and the
          other right of its own. */}
      <line x1={at(42)} x2={at(42)} y1={barY + barH} y2={barY + barH + 14} className="coh-lessonfig__callout" />
      <line x1={at(45)} x2={at(45)} y1={barY + barH} y2={barY + barH + 14} className="coh-lessonfig__callout" />
      <text x={at(42) - 5} y={barY + barH + 26} textAnchor="end" className="coh-lessonfig__tick">
        NO ask 58
      </text>
      <text x={at(45) + 5} y={barY + barH + 26} className="coh-lessonfig__tick">
        YES ask 45
      </text>
    </Frame>
  );
}
