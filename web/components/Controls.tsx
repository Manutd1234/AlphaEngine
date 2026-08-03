"use client";

import { paramGrid } from "@/lib/engine";
import {
  INTERVALS,
  MAX_COMBOS,
  PARAM_MEANING,
  STRATEGY_LABELS,
  Strategy,
  SweepRequest,
} from "@/lib/types";

const SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT", "AAPL", "NVDA", "MSFT"];

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 11,
          color: "var(--text-muted)",
          marginBottom: 2,
        }}
      >
        <span>{label}</span>
        <span className="num" style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export default function Controls({
  req,
  setReq,
  onRun,
  running,
}: {
  req: SweepRequest;
  setReq: (r: SweepRequest) => void;
  onRun: () => void;
  running: boolean;
}) {
  const patch = (p: Partial<SweepRequest>) => {
    const next = { ...req, ...p };
    // Keep the grid coherent while dragging, rather than rejecting it on submit.
    if (next.fastMin >= next.fastMax) next.fastMax = next.fastMin + 1;
    if (next.slowMin >= next.slowMax) next.slowMax = next.slowMin + 1;
    setReq(next);
  };

  const combos = paramGrid(req).length;
  const raw = (() => {
    let n = 0;
    for (let f = req.fastMin; f <= req.fastMax; f += req.fastStep)
      for (let s = req.slowMin; s <= req.slowMax; s += req.slowStep) if (f < s) n++;
    return n;
  })();
  const meaning = PARAM_MEANING[req.strategy];

  return (
    <div className="card sidebar experiment-panel">
      <h2>Experiment setup</h2>
      <p className="sub">Changes stay in the shared desk context until you run a new validation.</p>
      <div className="stack">
        <div className="row">
          <div>
            <label className="field" htmlFor="symbol">
              Symbol
            </label>
            <input
              id="symbol"
              list="research-symbols"
              value={req.symbol}
              onChange={(e) => patch({ symbol: e.target.value.toUpperCase() })}
              onBlur={(e) => patch({ symbol: e.target.value.trim().toUpperCase() || "BTCUSDT" })}
              spellCheck={false}
            />
            <datalist id="research-symbols">
              {SYMBOLS.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="field" htmlFor="interval">
              Interval
            </label>
            <select
              id="interval"
              value={req.interval}
              onChange={(e) => patch({ interval: e.target.value })}
            >
              {INTERVALS.map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="field" htmlFor="strategy">
            Model
          </label>
          <select
            id="strategy"
            value={req.strategy}
            onChange={(e) => patch({ strategy: e.target.value as Strategy })}
          >
            {(Object.keys(STRATEGY_LABELS) as Strategy[]).map((s) => (
              <option key={s} value={s}>
                {STRATEGY_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="row">
          <div>
            <label className="field" htmlFor="bars">
              History (bars)
            </label>
            <input
              id="bars"
              type="number"
              min={300}
              max={5000}
              step={100}
              value={req.bars}
              onChange={(e) => patch({ bars: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="field" htmlFor="direction">
              Direction
            </label>
            <select
              id="direction"
              value={req.direction}
              onChange={(e) =>
                patch({ direction: e.target.value as SweepRequest["direction"] })
              }
            >
              <option value="long_only">Long only</option>
              <option value="long_short">Long / short</option>
            </select>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--grid)", margin: "4px 0" }} />

        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 8,
            }}
          >
            <span className="field" style={{ margin: 0 }}>
              Parameter sweep
            </span>
            <span
              className="num"
              style={{ fontSize: 12, color: combos < raw ? "var(--status-warning)" : "var(--series-1)" }}
            >
              {combos} combos
            </span>
          </div>
          {combos < raw && (
            <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 10 }}>
              Grid of {raw} thinned to {MAX_COMBOS} — a wider search also raises the
              multiple-testing hurdle, so it is not free.
            </p>
          )}

          <div className="stack">
            <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>{meaning.fast}</div>
            <Slider label="from" value={req.fastMin} min={2} max={100} onChange={(v) => patch({ fastMin: v })} />
            <Slider label="to" value={req.fastMax} min={3} max={200} onChange={(v) => patch({ fastMax: v })} />
            <Slider label="step" value={req.fastStep} min={1} max={25} onChange={(v) => patch({ fastStep: v })} />

            <div style={{ fontSize: 11.5, color: "var(--text-secondary)", paddingTop: 6 }}>
              {meaning.slow}
            </div>
            <Slider label="from" value={req.slowMin} min={5} max={300} onChange={(v) => patch({ slowMin: v })} />
            <Slider label="to" value={req.slowMax} min={10} max={600} onChange={(v) => patch({ slowMax: v })} />
            <Slider label="step" value={req.slowStep} min={1} max={60} onChange={(v) => patch({ slowStep: v })} />
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--grid)", margin: "4px 0" }} />

        <div className="row">
          <div>
            <label className="field" htmlFor="fee">
              Fee bps
            </label>
            <input
              id="fee"
              type="number"
              min={0}
              max={100}
              step={1}
              value={req.feeBps}
              onChange={(e) => patch({ feeBps: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="field" htmlFor="slip">
              Slippage bps
            </label>
            <input
              id="slip"
              type="number"
              min={0}
              max={100}
              step={1}
              value={req.slippageBps}
              onChange={(e) => patch({ slippageBps: Number(e.target.value) })}
            />
          </div>
          <div>
            <label className="field" htmlFor="folds">
              WF folds
            </label>
            <input
              id="folds"
              type="number"
              min={2}
              max={10}
              value={req.folds}
              onChange={(e) => patch({ folds: Number(e.target.value) })}
            />
          </div>
        </div>

        <button className="primary" onClick={onRun} disabled={running}>
          {running ? "Running sweep…" : "Run parameter sweep"}
        </button>
      </div>
    </div>
  );
}
