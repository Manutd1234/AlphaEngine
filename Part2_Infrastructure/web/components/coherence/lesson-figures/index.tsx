"use client";

/**
 * A small drawing for the lessons whose claim is geometric, keyed by lesson id.
 *
 * Every lesson already carries a `formula` — a plain Unicode string — and
 * rendered it as a line of code. For most of the catalogue that is right: "the
 * mass sums to a dollar" is a sentence, and a picture of it would be a picture
 * of an equals sign. But four of the fourteen make claims about a SHAPE, and for
 * those the formula is the part a reader can already read and the shape is the
 * part they cannot.
 *
 * A REGISTRY RATHER THAN A FIELD ON THE DATA, and that is the load-bearing
 * decision here. `lessons.ts` is a catalogue one test walks, and a lesson
 * without an entry below renders exactly the card it renders today — no gap, no
 * placeholder, no "figure to follow". Adding a fifteenth lesson cannot break
 * this, and adding a fifth figure needs no change to the data. The alternative,
 * a `figure` field, would make every lesson carry a null for a thing most of
 * them should not have.
 *
 * ALL FOUR ARE DRAWN FROM CONSTANTS, not from a read. A lesson is a claim about
 * what is always true, so a figure that fetched would be illustrating one poll's
 * answer to a question about every poll — and it would put a gateway call behind
 * a tab whose whole subject is the curriculum.
 *
 * Classes are `FormationDiagram`'s, so the ladder is the engine's and this adds
 * no CSS. Every mark carries its own `<title>`.
 */

import type { ReactNode } from "react";

import { Frame, WIDTH } from "./frame";
import { Fees } from "./bounds";
import { Absence, Book, Grid } from "./prices";
import { HalfLife, Index } from "./record";
import { Basket, Distribution, Duality, Lattice } from "./structure";

/**
 * Fréchet: two marginals do not determine a joint, they BOUND it.
 *
 * The band between max(0, p+q−1) and min(p, q) is drawn at p = q = 0.6, with the
 * independence product marked inside it. The reason the lesson exists is that
 * Πpᵢ looks like the answer and is one point in an interval.
 */
function Frechet() {
  const p = 0.6;
  const q = 0.6;
  const low = Math.max(0, p + q - 1);
  const high = Math.min(p, q);
  const product = p * q;
  const left = 24;
  const x = (value: number) => left + value * (WIDTH - 2 * left);
  const bandY = 52;
  const bandH = 26;
  return (
    <Frame
      label={`Fréchet band from ${low.toFixed(2)} to ${high.toFixed(2)} with the independence product at ${product.toFixed(2)}`}
      claim="the band is the answer; the product is one point inside it"
    >
      <text x={left} y={20} className="coh-form__note">
        <tspan x={left} dy={0}>{`two legs at ${p.toFixed(2)}`}</tspan>
        <tspan x={left} dy={12}>every joint they permit</tspan>
      </text>
      <line x1={x(0)} x2={x(1)} y1={bandY + bandH} y2={bandY + bandH} className="coh-lessonfig__rule" />
      <text x={x(0)} y={bandY + bandH + 15} className="coh-lessonfig__tick">0</text>
      <text x={x(1)} y={bandY + bandH + 15} textAnchor="end" className="coh-lessonfig__tick">1</text>

      <rect x={x(low)} y={bandY} width={x(high) - x(low)} height={bandH} className="coh-lessonfig__band">
        <title>{`Every joint probability consistent with these two legs lies between ${low.toFixed(2)} and ${high.toFixed(2)}. The band is the answer; a point is not.`}</title>
      </rect>
      <line x1={x(product)} x2={x(product)} y1={bandY - 10} y2={bandY + bandH + 6}
            className="coh-survival__median">
        <title>{`Independence would give ${product.toFixed(2)} — one point inside the band, and only correct if the legs are independent, which the venue never promises.`}</title>
      </line>

      {/* THE THREE NUMBERS, EACH ON ITS OWN MARK. The band's ends were labelled
          and its WIDTH was not, which is the quantity the lesson is about — how
          much a pair of marginals leaves undetermined. */}
      <text x={x(low)} y={bandY - 6} className="coh-lessonfig__tick">{low.toFixed(2)}</text>
      <text x={x(high)} y={bandY - 6} textAnchor="end" className="coh-lessonfig__tick">{high.toFixed(2)}</text>
      <text x={x(product)} y={bandY + bandH + 15} textAnchor="middle" className="coh-form__note">
        {`Πp = ${product.toFixed(2)}`}
      </text>
      <text x={(x(low) + x(high)) / 2} y={bandY + 17} textAnchor="middle" className="coh-lessonfig__gap-note">
        {`${(high - low).toFixed(2)} wide`}
      </text>
    </Frame>
  );
}

/**
 * Kelly: growth against stake fraction, and why the peak is not the target.
 *
 * The curve is log-growth for a favourable bet; full Kelly is its maximum and
 * shrunk Kelly sits left of it. The lesson is that the right of the peak is
 * where growth turns negative faster than intuition expects.
 */
function Kelly() {
  const edge = 0.08;
  const growth = (f: number) => 0.5 * Math.log(1 + f * (1 + edge)) + 0.5 * Math.log(1 - f);
  const full = edge;
  const points = Array.from({ length: 72 }, (_, i) => (i / 71) * 0.35);
  const values = points.map(growth);
  const peak = Math.max(...values);
  const left = 26;
  const floor = 92;
  const x = (f: number) => left + (f / 0.35) * (WIDTH - 2 * left);
  const y = (v: number) => floor - (v / peak) * 58;
  const path = points.map((f, i) => `${i ? "L" : "M"}${x(f).toFixed(1)},${y(values[i]).toFixed(1)}`).join("");
  return (
    <Frame
      label="Log growth against stake fraction, with full and shrunk Kelly marked and the region past the peak named"
      claim="past the peak, growth falls away faster than it rose"
    >
      <line x1={left} x2={WIDTH - left} y1={floor} y2={floor} className="coh-form__arrow" />
      <text x={left} y={floor + 14} className="coh-lessonfig__tick">0</text>
      <text x={WIDTH - left} y={floor + 14} textAnchor="end" className="coh-lessonfig__tick">
        fraction staked
      </text>
      {/* THE RUINOUS HALF, TINTED. The curve showed that growth turns over; the
          lesson is that the far side is not symmetric with the near one, and a
          reader met that as a sentence under an untinted curve. */}
      <rect x={x(full)} y={26} width={WIDTH - left - x(full)} height={floor - 26}
            className="coh-lessonfig__danger">
        <title>
          Everything right of the peak. Growth falls away here faster than it rose, so overstaking costs
          more than the same distance of understaking saves — which is why the engine shrinks rather
          than aiming at the maximum.
        </title>
      </rect>
      <path d={path} fill="none" className="coh-index__line">
        <title>Expected log growth against the fraction staked. It is a curve with a maximum, not a line that keeps rising.</title>
      </path>
      <line x1={x(full)} x2={x(full)} y1={26} y2={floor} className="coh-survival__median">
        <title>Full Kelly maximises growth. Past it, growth falls away faster than it rose — which is why the engine stakes a shrunk fraction.</title>
      </line>
      <line x1={x(full / 2)} x2={x(full / 2)} y1={38} y2={floor} className="coh-form__arrow">
        <title>Half Kelly gives up a quarter of the growth for half the variance, which is the trade the shrinkage is making.</title>
      </line>
      <text x={x(full)} y={22} textAnchor="middle" className="coh-form__note">full</text>
      <text x={x(full / 2)} y={34} textAnchor="middle" className="coh-form__note">shrunk</text>
      <text x={x(full) + 8} y={52} className="coh-lessonfig__gap-note">ruinous</text>
    </Frame>
  );
}

/**
 * The fixed point: coherent price vectors are the ones that sum to a dollar.
 *
 * A two-outcome family is a line from (1,0) to (0,1); a coherent pair sits ON
 * it, an incoherent one sits off it, and the distance to the line is exactly
 * what the coherence index measures.
 */
function FixedPoint() {
  const left = 44;
  const right = WIDTH - 84;
  const top = 26;
  const bottom = 96;
  // A pair summing to 1.12 — off the simplex by 0.12, which is the length drawn.
  const point = { x: left + 0.62 * (right - left), y: bottom - 0.5 * (bottom - top) };
  const foot = { x: point.x - 15, y: point.y + 15 };
  return (
    <Frame
      label="The simplex for a two-outcome family, with an incoherent price vector sitting off it and the distance back marked"
      claim="a family summing over a dollar sits off the line, and the gap is the trade"
    >
      <line x1={left} x2={right} y1={bottom} y2={top} className="coh-lessonfig__simplex">
        <title>Every price vector on this line sums to a dollar and admits a probability measure. This is the set the solver projects onto.</title>
      </line>
      <circle cx={point.x} cy={point.y} r={4.5} className="coh-lessonfig__off">
        <title>A family whose prices sum to more than a dollar sits off the line. Buying every outcome costs more than the dollar it is certain to pay — which is the Dutch book, seen as a distance.</title>
      </circle>
      <line x1={point.x} x2={foot.x} y1={point.y} y2={foot.y} className="coh-survival__median">
        <title>The L1 distance to the nearest coherent vector. This length IS the coherence index.</title>
      </line>
      <circle cx={foot.x} cy={foot.y} r={3.5} className="coh-lessonfig__ring">
        <title>The nearest vector that sums to a dollar — what these quotes would have to become.</title>
      </circle>

      {/* WHAT THE POINT SUMS TO, AND WHAT THE GAP IS WORTH. The figure drew a
          dot off a line and named neither, so "sits off the simplex" was a
          shape with no magnitude — and the magnitude is the lesson. */}
      <text x={point.x + 8} y={point.y - 6} className="coh-lessonfig__tick">Σp = 1.12</text>
      <text x={right + 8} y={top + 10} className="coh-form__note">Σp = 1</text>
      <text x={foot.x - 6} y={foot.y + 14} textAnchor="end" className="coh-lessonfig__gap-note">0.12</text>
      <text x={left} y={bottom + 15} className="coh-form__note">all on NO</text>
      <text x={right} y={top - 8} textAnchor="end" className="coh-form__note">all on YES</text>
    </Frame>
  );
}

/**
 * Calibration: the diagonal, and what a slope away from it means.
 *
 * Steeper than the diagonal is the favourite–longshot shape — longshots overbet,
 * happening less often than their price says. The lesson is that the SIGN is
 * easy to get backwards, so the picture states it.
 */
function Calibration() {
  const left = 40;
  const right = WIDTH - 62;
  const top = 26;
  const bottom = 96;
  const slope = 1.25;
  const at = (t: number) => {
    const value = Math.min(1, Math.max(0, 0.5 + slope * (t - 0.5)));
    return { x: left + t * (right - left), y: bottom - value * (bottom - top) };
  };
  const fitted = [0, 0.25, 0.5, 0.75, 1].map(at);
  const longshot = at(0.2);
  return (
    <Frame
      label="A reliability diagram's diagonal, with a fitted slope steeper than one and the longshot gap marked"
      claim="steeper than the diagonal is the favourite–longshot shape"
    >
      <line x1={left} x2={right} y1={bottom} y2={top} className="coh-lessonfig__simplex">
        <title>Perfect calibration: of the contracts priced at p, exactly p of them pay.</title>
      </line>
      <path
        d={fitted.map((point, i) => `${i ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join("")}
        fill="none"
        className="coh-index__line"
      >
        <title>{`A slope of ${slope} — steeper than the diagonal. Longshots happen LESS often than their price says and favourites more, which is the favourite–longshot shape.`}</title>
      </path>

      {/* WHICH WAY THE SIGN GOES, DRAWN AT ONE PRICE. The lesson's own docstring
          says the sign is easy to get backwards, and the figure answered that
          with two crossing lines — which shows there IS a difference and not
          which side is which. One vertical at a longshot price, between the
          diagonal and the fit, names the direction where a reader is looking. */}
      <line x1={longshot.x} x2={longshot.x} y1={longshot.y} y2={bottom - 0.2 * (bottom - top)}
            className="coh-lessonfig__mark-line">
        <title>
          At a quoted 0.20 the fitted line sits BELOW the diagonal: these paid less often than their
          price said. That is the longshot half of the shape, and it is the half whose sign is easy to
          state backwards.
        </title>
      </line>
      <text x={longshot.x + 8} y={bottom - 0.2 * (bottom - top) + 14} className="coh-lessonfig__gap-note">
        overpriced
      </text>
      <text x={left} y={bottom + 15} className="coh-form__note">price quoted</text>
      <text x={WIDTH - 16} y={top + 10} textAnchor="end" className="coh-form__note">
        how often it paid
      </text>
    </Frame>
  );
}

/**
 * Lesson id to figure. A lesson absent from this map draws no figure at all.
 *
 * NINE of fourteen as of 2026-08-25, from four. The four it had were the four
 * whose shape is a coordinate geometry — a band, a growth path, a simplex, a
 * slope — and the five added are the ones whose claim is a PROPORTION or a
 * CONTAINMENT, which a picture carries better than a sentence: an uneven price
 * ruler, a quoted zero beside a missing quote, a dollar sold in pieces that do
 * not total it, three nested thresholds, a fee bar whose rounding component
 * dwarfs the trading one, and a decay curve with a round trip landing after
 * its half.
 *
 * ALL FOURTEEN ARE DRAWN as of 2026-08-25. This paragraph used to argue the
 * last four should not be, and the reversal is recorded rather than quietly
 * deleted because half of that argument was sound and the other half was not.
 *
 * What was sound: `book` and `duality` ARE drawn in full elsewhere on the
 * engine, by `IdentityStrip` and `PayoffByState`. What was wrong is the
 * conclusion drawn from it — the copy rule against making one claim twice is
 * about one SCREEN, and a reader on Lessons is not on Books or on Basket. A
 * lesson card is where someone goes to learn the claim; the section is where
 * they go to read today's numbers off it. The two figures differ accordingly:
 * these draw the identity and the certificate at chosen values, the sections
 * draw the live book and the live portfolio.
 *
 * What was wrong outright: `index` and `distribution` were called readings
 * rather than shapes, and they are not. `CI = min ‖p − q‖₁` is a point off a
 * line and the path between them; `pmf = S(kᵢ) − S(kᵢ₊₁)` is one subtraction
 * between two quotes. Both are geometry. The test that argument reached for —
 * "a diagram of a reading is a chart with invented numbers in it" — would
 * condemn the ten figures already here, every one of which is drawn at chosen
 * values; `Fees` says so in its own docstring. A lesson figure is a diagram of
 * a claim, and the claim is what decides whether it can be drawn.
 */
export const LESSON_FIGURES: Record<string, () => ReactNode> = {
  frechet: Frechet,
  kelly: Kelly,
  fixedpoint: FixedPoint,
  calibration: Calibration,
  grid: Grid,
  absence: Absence,
  basket: Basket,
  lattice: Lattice,
  fees: Fees,
  halflife: HalfLife,
  book: Book,
  duality: Duality,
  distribution: Distribution,
  index: Index,
};

export default function LessonFigure({ id }: { id: string }) {
  const Drawing = LESSON_FIGURES[id];
  if (!Drawing) return null;
  return (
    <div
      className="coh-lessonfig"
      role="region"
      aria-label={`${id} lesson technical diagram`}
      tabIndex={0}
    >
      {Drawing()}
    </div>
  );
}
