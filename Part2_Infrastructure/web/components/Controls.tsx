"use client";

import { useEffect, useRef, useState } from "react";

import { paramGrid } from "@/lib/engine";
import {
  INTERVALS,
  MAX_COMBOS,
  PARAM_MEANING,
  STRATEGY_LABELS,
  Strategy,
  SweepRequest,
} from "@/lib/types";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "ADAUSDT",
  "DOGEUSDT", "AVAXUSDT", "LINKUSDT", "DOTUSDT", "LTCUSDT", "TRXUSDT",
  "AAPL", "NVDA", "MSFT",
];

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

/**
 * A numeric field you can actually type a decimal or a minus sign into.
 *
 * `<input type="number">` bound straight to `Number(e.target.value)` cannot
 * accept either. The browser reports `value === ""` for any transient text that
 * is not yet a valid floating-point number — a trailing `"."`, a lone `"-"` —
 * and `Number("")` is `0`, so the handler commits zero and React writes "0" back
 * over the caret. Typing `.05` into Impact k ended up as `005`, which the route
 * clamped to `1.0`: the maximum impact coefficient, twenty times what was asked
 * for, with the field still reading `005`.
 *
 * So the raw string is held here and only committed when it parses. `type=text`
 * with `inputMode=decimal` rather than `type=number`, because the number input's
 * own value-sanitisation algorithm is what discards the partial literal in the
 * first place — keeping the numeric keypad on touch without the sanitiser.
 */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(() => String(value));
  const ref = useRef<HTMLInputElement | null>(null);

  // Re-sync when the value changes from outside — cloning a saved experiment
  // rewrites the whole request — but never while the field has focus, which
  // would be the same stomping this component exists to prevent.
  useEffect(() => {
    if (typeof document !== "undefined" && document.activeElement === ref.current) return;
    setText(String(value));
  }, [value]);

  return (
    <div>
      <label className="field" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={text}
        aria-label={label}
        onChange={(event) => {
          const raw = event.target.value;
          setText(raw);
          const parsed = Number(raw);
          // "", "-", "0." and "1e" are all mid-typing states. Committing any of
          // them writes a number the user never asked for.
          if (raw.trim() === "" || raw === "-" || !Number.isFinite(parsed)) return;
          onCommit(Math.min(max, Math.max(min, parsed)));
        }}
        onBlur={() => setText(String(value))}
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
  const frictionsOn = Boolean(
    (req.impactCoefficient ?? 0) > 0
      || (req.fundingBpsPer8h ?? 0) !== 0
      || (req.borrowBpsAnnual ?? 0) > 0,
  );
  // Which frictions, not just that some are: a funding rate someone enabled
  // last week must be visible without expanding the group.
  const frictionSummary = frictionsOn
    ? [
        (req.impactCoefficient ?? 0) > 0 && "impact",
        (req.fundingBpsPer8h ?? 0) !== 0 && `funding ${req.fundingBpsPer8h} bps/8h`,
        (req.borrowBpsAnnual ?? 0) > 0 && `borrow ${req.borrowBpsAnnual} bps/yr`,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

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
              onChange={(e) => e.target.value !== "" && patch({ bars: Number(e.target.value) })}
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
              style={{ fontSize: 12, color: combos < raw ? "var(--warning-text)" : "var(--series-1)" }}
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
              onChange={(e) => e.target.value !== "" && patch({ feeBps: Number(e.target.value) })}
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
              onChange={(e) => e.target.value !== "" && patch({ slippageBps: Number(e.target.value) })}
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
              onChange={(e) => e.target.value !== "" && patch({ folds: Number(e.target.value) })}
            />
          </div>
        </div>

        <hr style={{ border: 0, borderTop: "1px solid var(--grid)", margin: "4px 0" }} />

        {/* Microstructure frictions.
            Collapsed by default and zero by default, because switching any of
            these on makes this run diverge from the Python gateway — which
            models flat bps only. That is stated where the switch is, not in a
            footnote, since a cost assumption a researcher forgot they enabled
            is indistinguishable from a strategy that stopped working. */}
        <details className="friction-group" open={frictionsOn}>
          <summary>
            Microstructure frictions
            <span
              className={frictionsOn ? "friction-badge is-on" : "friction-badge"}
              title={frictionSummary ?? undefined}
            >
              {frictionSummary ? `modelled · ${frictionSummary}` : "flat bps only"}
            </span>
          </summary>

          <p className="friction-note">
            Beyond flat fee and slippage. Each defaults to zero; with all four at zero this run is
            arithmetically identical to the gateway&apos;s reference engine. Any non-zero value makes it a
            model of your assumptions, and the two will no longer agree.
          </p>

          <div className="row">
            <NumberField
              id="impact"
              label="Impact k"
              value={req.impactCoefficient ?? 0}
              min={0}
              max={1}
              onCommit={(v) => patch({ impactCoefficient: v })}
            />
            <NumberField
              id="notional"
              label="Order size"
              value={req.orderNotional ?? 0}
              min={0}
              max={1e10}
              onCommit={(v) => patch({ orderNotional: v })}
            />
          </div>
          <p className="friction-note">
            Square-root impact: <code>k·√(order ÷ ADV)</code>. Doubling size costs about 1.41×, not 2×.
            Both must be non-zero for impact to apply.
          </p>

          <div className="row">
            <NumberField
              id="funding"
              label="Funding bps/8h"
              value={req.fundingBpsPer8h ?? 0}
              min={-50}
              max={50}
              onCommit={(v) => patch({ fundingBpsPer8h: v })}
            />
            <NumberField
              id="borrow"
              label="Borrow bps/yr"
              value={req.borrowBpsAnnual ?? 0}
              min={0}
              max={5000}
              onCommit={(v) => patch({ borrowBpsAnnual: v })}
            />
          </div>
          <p className="friction-note">
            Funding is charged on absolute exposure every bar; borrow only on short exposure, so it does
            nothing in a long-only run.
          </p>
        </details>

        <button className="primary" onClick={onRun} disabled={running}>
          {running ? "Running sweep…" : "Run parameter sweep"}
        </button>
      </div>
    </div>
  );
}
