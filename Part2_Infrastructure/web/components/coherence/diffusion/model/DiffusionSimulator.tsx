"use client";

/**
 * The whole pipeline over a path whose truth is known, including its refusals.
 *
 * Every other figure on this tab shows what the estimator SAID about data whose
 * true answer nobody has. This one generates a path with a half-life the reader
 * chose, runs the same arithmetic the gateway runs, and puts the recovered
 * figure beside the true one. What that buys is the only honest way to learn an
 * estimator's limits without waiting for the market to demonstrate them:
 *
 *  - PUSH THE NOISE UP and the gate refuses — `no_signal`, because the terminal
 *    move no longer clears two pre-event sigmas. The path is still obviously a
 *    decay to the eye. That is the point: most rate decisions move neither stage
 *    two sigmas, and a summary showing only the stages that cleared the floor
 *    would describe a quarter of the sample as though it were all of it.
 *  - DROP THE PRE-WINDOW under the bar minimum and it refuses differently —
 *    `insufficient_pre_window`, because numpy.std of one observation is 0.0 and
 *    a 2σ floor with no scale admits every event. Two refusals, two reasons,
 *    never one word for both.
 *  - SHORTEN THE TRUE HALF-LIFE below the first horizon and the crossing stops
 *    being resolvable: `at_or_before_first`. The estimator does not report 60s.
 *  - AND WHERE IT DOES ANSWER, the recovered half-life drifts from the true one
 *    exactly where the grid is coarsest, which is the geometric grid's cost made
 *    visible rather than argued.
 *
 * THE RANDOMNESS IS SEEDED AND WRITTEN HERE. `mulberry32` is nine lines; the
 * desk ships on five dependencies and a PRNG is not going to be the sixth. A
 * seed in the control row also makes the figure reproducible — a reader can
 * report what they saw, and the same seed gives the same path.
 *
 * NO ANIMATION. The figure redraws on input and nothing moves on its own, which
 * is what `prefers-reduced-motion` asks of a surface that would otherwise want a
 * transition. There is no motion to reduce.
 *
 * The arithmetic is `lib/coherence/diffusion-model` throughout — the twin the
 * parity fixture holds to `decay.py`. The simulator generates data and reads the
 * verdict; it computes no statistic of its own.
 */

import { useMemo, useState } from "react";

import { fitExponential, fitPower, halfLife } from "@/lib/coherence/diffusion-model";
import Figure from "../../Figure";
import { StateChip } from "../../Figure";
import { useMeasuredWidth } from "@/components/chart-kit";

const GRID = [60, 120, 300, 600, 900, 1800] as const;
const GRID_LABELS = ["1m", "2m", "5m", "10m", "15m", "30m"] as const;
/** The terminal both stages are measured to, in seconds — thirty minutes. */
const TERMINAL = 1800;
/** `DIFFUSION_SIGNAL_FLOOR_SIGMA` on the gateway. */
const FLOOR_SIGMA = 2;
/** `DIFFUSION_PRE_MIN_BARS` on the gateway. */
const PRE_MIN_BARS = 30;

const HEIGHT = 180;
const MARGIN = { top: 14, right: 12, bottom: 26, left: 34 };

/** Nine lines rather than a dependency. Same seed, same path, every time. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A standard normal from two uniforms, so the noise is not a flat band. */
function gaussian(random: () => number): number {
  const u = Math.max(random(), Number.EPSILON);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

interface Run {
  path: Array<{ t: number; value: number }>;
  absorbed: number[];
  terminal: number;
  sigmaBar: number;
  sigmaTerminal: number;
  signal: "ok" | "no_signal" | "insufficient_pre_window";
  reason: string | null;
}

function simulate(trueHalfLife: number, move: number, noise: number, preBars: number, seed: number): Run {
  const random = mulberry32(seed);
  const tau = trueHalfLife / Math.LN2;

  // The pre-event window sets the scale. Below the bar minimum there is no
  // scale, which is a refusal rather than a zero.
  const preReturns = Array.from({ length: Math.max(0, Math.round(preBars)) }, () => gaussian(random) * noise);
  const sigmaBar = preReturns.length >= PRE_MIN_BARS
    ? Math.sqrt(preReturns.reduce((total, value) => total + value * value, 0) / (preReturns.length - 1))
    : Number.NaN;

  // One minute per bar to the terminal, the coarsest interval the grid needs.
  const step = 60;
  const path: Array<{ t: number; value: number }> = [];
  let drift = 0;
  for (let t = 0; t <= TERMINAL; t += step) {
    drift = move * (1 - Math.exp(-t / tau));
    path.push({ t, value: drift + gaussian(random) * noise * Math.sqrt(t / step + 1) });
  }

  const at = (target: number) => path.reduce((best, point) =>
    Math.abs(point.t - target) < Math.abs(best.t - target) ? point : best, path[0]);
  const terminal = at(TERMINAL).value;
  const sigmaTerminal = sigmaBar * Math.sqrt(TERMINAL / step);

  let signal: Run["signal"] = "ok";
  let reason: string | null = null;
  if (!Number.isFinite(sigmaBar)) {
    signal = "insufficient_pre_window";
    reason = `${preReturns.length} pre-event returns is below the floor of ${PRE_MIN_BARS}, so there is no scale`;
  } else if (Math.abs(terminal) < FLOOR_SIGMA * sigmaTerminal) {
    signal = "no_signal";
    reason = `the terminal move is ${(Math.abs(terminal) / sigmaTerminal).toFixed(2)} pre-event sigmas, `
      + `below the floor of ${FLOOR_SIGMA}`;
  }

  // Absorbed is computed only when the gate passed, exactly as the reference
  // does — there is nothing to divide by when the move is not a move.
  const absorbed = signal === "ok" ? GRID.map((horizon) => at(horizon).value / terminal) : [];
  return { path, absorbed, terminal, sigmaBar, sigmaTerminal, signal, reason };
}

export default function DiffusionSimulator() {
  const [trueHalfLife, setTrueHalfLife] = useState(240);
  const [move, setMove] = useState(0.012);
  const [noise, setNoise] = useState(0.0008);
  const [preBars, setPreBars] = useState(60);
  const [seed, setSeed] = useState(7);
  const [plotRef, plotW] = useMeasuredWidth<HTMLDivElement>(720);

  const run = useMemo(
    () => simulate(trueHalfLife, move, noise, preBars, seed),
    [trueHalfLife, move, noise, preBars, seed],
  );
  const recovered = run.signal === "ok" ? halfLife([...GRID], run.absorbed) : null;
  const exponential = run.signal === "ok" ? fitExponential([...GRID], run.absorbed) : null;
  const power = run.signal === "ok" ? fitPower([...GRID], run.absorbed) : null;

  const plotWidth = Math.max(1, plotW - MARGIN.left - MARGIN.right);
  const base = HEIGHT - MARGIN.bottom;
  const span = Math.max(...run.path.map((point) => Math.abs(point.value)), 1e-9);
  const x = (t: number) => MARGIN.left + (t / TERMINAL) * plotWidth;
  const y = (value: number) => base - ((value + span) / (2 * span)) * (base - MARGIN.top);
  const line = run.path.map((point, index) => `${index ? "L" : "M"}${x(point.t).toFixed(2)},${y(point.value).toFixed(2)}`).join("");

  const drift = (t: number) => move * (1 - Math.exp(-t / (trueHalfLife / Math.LN2)));
  const truth = run.path.map((point, index) => `${index ? "L" : "M"}${x(point.t).toFixed(2)},${y(drift(point.t)).toFixed(2)}`).join("");

  const error = recovered?.value != null
    ? `${(((recovered.value - trueHalfLife) / trueHalfLife) * 100).toFixed(0)}%`
    : null;

  return (
    <div className="diff-pane">
      <p className="coh-event__note">
        A path with a half-life you chose, run through the arithmetic the gateway runs. The interesting
        settings are the ones where it declines to answer.
      </p>

      <div className="coh-model__controls">
        <label>
          <span className="field">True half-life — {trueHalfLife}s</span>
          <input type="range" min={20} max={1200} step={10} value={trueHalfLife}
                 onChange={(event) => setTrueHalfLife(Number(event.target.value))} />
        </label>
        <label>
          <span className="field">Terminal move — {(move * 100).toFixed(2)}%</span>
          <input type="range" min={0} max={0.05} step={0.001} value={move}
                 onChange={(event) => setMove(Number(event.target.value))} />
        </label>
        <label>
          <span className="field">Noise σ per bar — {(noise * 100).toFixed(3)}%</span>
          <input type="range" min={0} max={0.006} step={0.0001} value={noise}
                 onChange={(event) => setNoise(Number(event.target.value))} />
        </label>
        <label>
          <span className="field">Pre-event bars — {preBars}</span>
          <input type="range" min={0} max={120} step={1} value={preBars}
                 onChange={(event) => setPreBars(Number(event.target.value))} />
        </label>
        <label>
          <span className="field">Seed — {seed}</span>
          <input type="range" min={1} max={40} step={1} value={seed}
                 onChange={(event) => setSeed(Number(event.target.value))} />
        </label>
      </div>

      <div className="coh-status__chips">
        <StateChip
          mark={run.signal === "ok" ? "✓" : "▲"}
          word={run.signal === "ok" ? "Cleared the floor" : run.signal}
          value={Number.isFinite(run.sigmaTerminal)
            ? `${(Math.abs(run.terminal) / run.sigmaTerminal).toFixed(2)}σ`
            : "no scale"}
          tone={run.signal === "ok" ? "good" : "warn"}
        />
        <StateChip mark="◇" word="True half-life" value={`${trueHalfLife}s`} tone="muted" />
        <StateChip
          mark={recovered?.value != null ? "→" : "◌"}
          word="Recovered"
          value={recovered?.value != null ? `${Math.round(recovered.value)}s` : (recovered?.state ?? "not measured")}
          tone={recovered?.value != null ? "muted" : "warn"}
        />
        {error ? <StateChip mark="▲" word="Error against truth" value={error} tone="muted" /> : null}
      </div>

      <Figure
        caption="The simulated abnormal return, against the decay it was drawn from"
        ariaLabel={`A simulated path over ${TERMINAL / 60} minutes with a true half-life of ${trueHalfLife} seconds`}
        reading={
          run.signal === "ok"
            ? `The gate passed and the estimator reports ${recovered?.state}. `
              + (recovered?.value != null
                ? `It recovered ${Math.round(recovered.value)}s against a true ${trueHalfLife}s.`
                : "It declines to name a crossing on this grid.")
            : `The gate refused: ${run.reason}. No absorbed fraction is computed, because there is no move to divide by.`
        }
        missing={
          run.signal === "ok" && exponential && power
            ? `Exponential fit ${exponential.halfLife == null ? "declined" : `${Math.round(exponential.halfLife)}s`} `
              + `(SSE ${exponential.sse?.toFixed(4) ?? "—"}), power fit `
              + `${power.halfLife == null ? "declined" : `${Math.round(power.halfLife)}s`} `
              + `(SSE ${power.sse?.toFixed(4) ?? "—"}). Both are reported and neither is the verdict.`
            : null
        }
      >
        <div ref={plotRef} style={{ width: "100%" }}>
          <svg viewBox={`0 0 ${plotW} ${HEIGHT}`} width={plotW} height={HEIGHT}>
            <line x1={MARGIN.left} x2={plotW - MARGIN.right} y1={y(0)} y2={y(0)} className="coh-ladder__axis" />
            <path d={truth} fill="none" className="coh-model__truth">
              <title>{`The decay the path was drawn from: half-life ${trueHalfLife}s`}</title>
            </path>
            <path d={line} fill="none" className="coh-index__line">
              <title>{`The simulated path, seed ${seed}, noise σ ${(noise * 100).toFixed(3)}% per bar`}</title>
            </path>
            {run.signal === "ok" && recovered?.value != null ? (
              <line x1={x(recovered.value)} x2={x(recovered.value)} y1={MARGIN.top} y2={base}
                    className="coh-survival__median">
                <title>{`Recovered half-life ${Math.round(recovered.value)}s`}</title>
              </line>
            ) : null}
            {GRID.map((horizon, index) => (
              <text key={horizon} x={x(horizon)} y={HEIGHT - 8} textAnchor="middle" className="coh-ladder__tick">
                {GRID_LABELS[index]}
              </text>
            ))}
          </svg>
        </div>
      </Figure>
    </div>
  );
}
