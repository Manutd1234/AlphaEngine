/**
 * The lessons about what the recorder can and cannot write down.
 *
 * Split out of `index.tsx` on 2026-08-25 with the rest of the registry.
 */

import { Frame, HEIGHT, WIDTH } from "./frame";

/**
 * Measure how long a dislocation survives before building an executor.
 *
 * A decay curve with the half marked, against a round-trip that does not fit
 * under it. The lesson is a comparison of two durations, and two durations on
 * one axis is the shortest way to make a comparison — the alternative is a
 * reader holding "8.3s" and "3.2s" in their head and doing it themselves.
 */
export function HalfLife() {
  const left = 20;
  const right = WIDTH - 20;
  const top = 20;
  const floor = 68;
  const span = right - left;
  const decay = (t: number) => Math.pow(0.5, t / 0.35);
  const points = Array.from({ length: 40 }, (_, i) => {
    const t = i / 39;
    return `${left + t * span},${floor - decay(t) * (floor - top)}`;
  }).join(" ");
  const halfX = left + 0.35 * span;
  const tripX = left + 0.62 * span;
  return (
    <Frame label="A decay curve with its half-life marked, and a round trip that lands after it">
      <line x1={left} x2={right} y1={floor} y2={floor} className="coh-form__arrow" />
      <polyline points={points} className="coh-lessonfig__curve">
        <title>
          How much of a dislocation is still there, as time passes. Exponential decay: the survival
          curve of the edge, not of the price. Its shape is why an executor cannot be specified without
          measuring it first — the answer is a duration, and the duration is what decides whether any
          executor is worth building.
        </title>
      </polyline>
      <line x1={left} x2={halfX} y1={(floor + top) / 2} y2={(floor + top) / 2}
            className="coh-lessonfig__rule">
        <title>Half the edge. Above this line the dislocation is mostly intact; below it, mostly gone.</title>
      </line>
      <line x1={halfX} x2={halfX} y1={(floor + top) / 2} y2={floor} className="coh-lessonfig__rule">
        <title>
          The half-life: the moment half the edge has evaporated. This is the number to measure BEFORE
          building anything, because it is the deadline every other decision is judged against.
        </title>
      </line>
      <text x={halfX + 4} y={(floor + top) / 2 - 4} className="coh-form__note">half gone</text>
      <line x1={tripX} x2={tripX} y1={top} y2={floor} className="coh-lessonfig__mark-line">
        <title>
          Your round trip — detect, decide, send, fill. It lands to the RIGHT of the half-life, so by
          the time the order arrives most of what it was sent for is gone. Two durations on one axis,
          because the comparison is the whole lesson and a reader should not have to hold both numbers
          in their head to make it.
        </title>
      </line>
      <text x={tripX + 4} y={top + 10} className="coh-form__note">your round trip</text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        arriving after the half is arriving late
      </text>
    </Frame>
  );
}

/**
 * Incoherence is measurable, per series, over time.
 *
 * `CI = min ‖p_quoted − q‖₁ over the coherent vectors q`. The reason this
 * lesson needs a picture is that "distance to the nearest arbitrage-free price
 * vector" sounds like a metaphor and is not one: the coherent vectors form a
 * LINE (here, the two prices that sum to a dollar), the quoted pair is a point
 * off it, and the index is the length of the path between them.
 *
 * The path is drawn as an L rather than a diagonal, because the norm is L1 and
 * a diagonal would draw the Euclidean distance — a different number, and the
 * kind of quietly wrong picture that teaches the wrong thing for years. Two
 * axes, not the full simplex, for the same reason the duality figure uses three
 * states: the smallest case where the claim is still the claim.
 *
 * The point sits OUTSIDE the line rather than on it, because the lesson's own
 * argument is that this distance exists on every poll and is usually small but
 * not zero — a figure showing a coherent book would draw nothing at all.
 */
export function Index() {
  const left = 30;
  const base = 74;
  const span = 88;
  return (
    <Frame label="A quoted price pair sitting off the line of coherent pairs, with the L-shaped distance between them">
      <line x1={left} x2={left} y1={base - span} y2={base} className="coh-lessonfig__rule" />
      <line x1={left} x2={left + span} y1={base} y2={base} className="coh-lessonfig__rule" />
      <line x1={left} x2={left + span} y1={base - span} y2={base} className="coh-lessonfig__simplex">
        <title>
          Every price pair that sums to a dollar. This line IS the coherent set for two outcomes — the
          simplex — and &ldquo;admits a probability measure&rdquo; means nothing more mysterious than
          sitting on it.
        </title>
      </line>
      <text x={left + span + 4} y={base - span + 10} className="coh-lessonfig__tick">p₁ + p₂ = 1</text>
      <line x1={left + 62} x2={left + 62} y1={base - 44} y2={base - 26} className="coh-lessonfig__mark-line">
        <title>
          The first leg of the L1 path: how far one price must move. Drawn as an L and never as a
          diagonal — the norm is L1, so the distance is the SUM of the two moves. A diagonal would draw
          the Euclidean distance, a different number, and teach the wrong one convincingly.
        </title>
      </line>
      <line x1={left + 62} x2={left + 44} y1={base - 26} y2={base - 26} className="coh-lessonfig__mark-line">
        <title>The second leg. The two lengths added together ARE the coherence index for this book.</title>
      </line>
      <circle cx={left + 62} cy={base - 44} r={3.5} className="coh-lessonfig__off">
        <title>
          The quoted pair, sitting off the line. It is drawn off rather than on because that is the
          usual case: the distance is small on most polls and not zero, and a figure of a coherent book
          would have nothing to show.
        </title>
      </circle>
      <circle cx={left + 44} cy={base - 26} r={3.5} className="coh-lessonfig__ring">
        <title>
          The nearest coherent pair — what the quotes would have to become. The solver projects onto
          this point, and the length of the path to it is the index.
        </title>
      </circle>
      <text x={left + 68} y={base - 46} className="coh-form__note">quoted</text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        the L1 path, not the diagonal: the index is the sum of the two legs
      </text>
    </Frame>
  );
}
