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
      <polyline points={points} className="coh-lessonfig__curve" />
      <line x1={left} x2={halfX} y1={(floor + top) / 2} y2={(floor + top) / 2}
            className="coh-lessonfig__rule" />
      <line x1={halfX} x2={halfX} y1={(floor + top) / 2} y2={floor} className="coh-lessonfig__rule" />
      <text x={halfX + 4} y={(floor + top) / 2 - 4} className="coh-form__note">half gone</text>
      <line x1={tripX} x2={tripX} y1={top} y2={floor} className="coh-lessonfig__mark-line" />
      <text x={tripX + 4} y={top + 10} className="coh-form__note">your round trip</text>
      <text x={left} y={HEIGHT - 6} className="coh-form__note">
        arriving after the half is arriving late
      </text>
    </Frame>
  );
}
