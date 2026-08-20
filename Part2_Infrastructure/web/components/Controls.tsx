"use client";

import { useEffect, useRef, useState } from "react";

import SymbolCombobox from "@/components/SymbolCombobox";
import { paramGrid } from "@/lib/engine";
import { defaultBenchmark, RESEARCH_SYMBOLS } from "@/lib/research-symbols";
import { strategiesByFamily } from "@/lib/strategy-progress";
import {
  INTERVALS,
  MAX_COMBOS,
  PARAM_MEANING,
  STRATEGY_LABELS,
  Strategy,
  SweepRequest,
} from "@/lib/types";


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
      <div className="slider-row">
        <span>{label}</span>
        <span className="num">{value}</span>
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
  onCommit,
  tried,
}: {
  req: SweepRequest;
  setReq: (r: SweepRequest) => void;
  /**
   * Declared but not rendered here any more, and deliberately still separate
   * from `onCommit`.
   *
   * This panel used to close with a "Run sweep now" button; the desk had three
   * ways to start the same sweep visible at once, and this was the one that
   * scrolled out of view with the controls above it. The distinction the two
   * props draw is the mechanism, not the button: `onCommit` is the DOM's own
   * `change`, `onRun` is an explicit request, and a component that collapsed
   * them would put a request on every tick of a slider drag —
   * `tests/sweep-autorun.test.ts` reads this signature for exactly that.
   */
  onRun: () => void;
  /** The user has settled on a value — see the `change` listener below. */
  onCommit: () => void;
  /** Strategies in this browser's run log, marked "— run" in the picker. */
  tried?: ReadonlySet<Strategy>;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [setupExpanded, setSetupExpanded] = useState(false);

  /**
   * Auto-run, driven by the DOM's own notion of "the user has finished".
   *
   * React's `onChange` is really the native `input` event: it fires on every
   * tick of a slider drag, which is why every edit below patches the request
   * but does not run anything. The native `change` event is the browser's own
   * commit signal — pointer release for a drag, arrow-key press for the
   * keyboard, blur or Enter for a typed field — and it is both cheaper and
   * more accurate than any debounce interval we could pick.
   *
   * One listener, not fifteen: `change` bubbles for form controls, so the
   * panel root sees every slider, select and field in the subtree. Adding a
   * control below needs no wiring here.
   *
   * A ref rather than an `onChange` prop because React has no synthetic event
   * for the native `change` of a range input — its `onChange` is `input`, and
   * the distinction between the two is the entire mechanism.
   */
  useEffect(() => {
    const node = panelRef.current;
    if (!node) return;
    const handler = () => onCommit();
    node.addEventListener("change", handler);
    return () => node.removeEventListener("change", handler);
  }, [onCommit]);

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
        .join(", ")
    : null;

  return (
    <div
      id="research-experiment-setup"
      className="card sidebar experiment-panel"
      data-expanded={setupExpanded}
      ref={panelRef}
    >
      <div className="experiment-panel__heading">
        <div>
          <h2>Experiment setup</h2>
          <p className="sub">
            {req.symbol} at {req.interval}, {STRATEGY_LABELS[req.strategy]}, {combos} combos
          </p>
        </div>
        <button
          type="button"
          className="experiment-panel__toggle"
          aria-controls="research-experiment-controls"
          aria-expanded={setupExpanded}
          onClick={() => setSetupExpanded((expanded) => !expanded)}
        >
          {setupExpanded ? "Hide setup" : "Edit setup"}
        </button>
      </div>
      <div id="research-experiment-controls" className="experiment-panel__body">
        <p className="sub experiment-panel__help">
          {/* Compressed to fit the 310px rail without losing a fact: the
              trigger for each input type, and how to stop it. */}
          Sliders re-run the sweep on release, typed fields on blur.
          Turn <strong>Auto</strong> off on the rail to hold it.
        </p>
        <div className="stack">
        <div className="row">
          <div>
            {/* A combobox, not a `<datalist>`. A datalist filters its options
                against the input's current value, so a full box showed exactly
                one suggestion and the roster could only be browsed by deleting
                the symbol first. Not a `<select>` either: unlisted tickers
                (ATOMUSDT, SUIUSDT, any equity the providers carry) backtest
                correctly and a select would silently drop them. */}
            <SymbolCombobox
              value={req.symbol}
              onCommit={(symbol) => patch({ symbol })}
            />
          </div>
          <div>
            <label className="field" htmlFor="benchmark">
              Benchmark
            </label>
            {/* A select, not a datalist: unlike the traded symbol this is a
                comparison the reader has to be able to name, and an
                unrecognised ticker here produces a silently absent alpha
                rather than a failed run. "None" is a real choice — the
                same-symbol buy-and-hold comparison is computed either way. */}
            <select
              id="benchmark"
              value={req.benchmarkSymbol ?? ""}
              onChange={(e) => patch({ benchmarkSymbol: e.target.value || undefined })}
            >
              <option value="">None — buy-and-hold only</option>
              {RESEARCH_SYMBOLS.filter((s) => s.symbol !== req.symbol).map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {`${s.symbol} — ${s.name}`}
                  {s.symbol === defaultBenchmark(req.symbol) ? " (suggested)" : ""}
                </option>
              ))}
            </select>
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
            {/* The first rendering STRATEGY_FAMILY has ever had: 46 flat
                options grouped into the seven families the codex browses.
                "— run" mirrors the codex's explored-state, derived from the
                same log. */}
            {[...strategiesByFamily()].map(([family, strategies]) => (
              <optgroup key={family} label={family}>
                {strategies.map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABELS[s]}{tried?.has(s) ? " — run" : ""}
                  </option>
                ))}
              </optgroup>
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

        <hr className="field-divider" />

        <div>
          <div className="sweep-heading">
            <span className="field">Parameter sweep</span>
            <span className={combos < raw ? "num sweep-count is-thinned" : "num sweep-count"}>
              {combos} combos
            </span>
          </div>
          {combos < raw && (
            <p className="sweep-note">
              Grid of {raw} thinned to {MAX_COMBOS}; a wider search also raises the
              multiple-testing hurdle.
            </p>
          )}

          <div className="stack">
            <div className="param-caption">{meaning.fast}</div>
            <Slider label="from" value={req.fastMin} min={2} max={100} onChange={(v) => patch({ fastMin: v })} />
            <Slider label="to" value={req.fastMax} min={3} max={200} onChange={(v) => patch({ fastMax: v })} />
            <Slider label="step" value={req.fastStep} min={1} max={25} onChange={(v) => patch({ fastStep: v })} />

            <div className="param-caption is-spaced">{meaning.slow}</div>
            <Slider label="from" value={req.slowMin} min={5} max={300} onChange={(v) => patch({ slowMin: v })} />
            <Slider label="to" value={req.slowMax} min={10} max={600} onChange={(v) => patch({ slowMax: v })} />
            <Slider label="step" value={req.slowStep} min={1} max={60} onChange={(v) => patch({ slowStep: v })} />
          </div>
        </div>

        <hr className="field-divider" />

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

        <hr className="field-divider" />

        {/* Microstructure frictions.
            Collapsed by default and zero by default, because switching any of
            these on makes this run diverge from the Python gateway — which
            models flat bps only. That is stated where the switch is, not in a
            footnote, since a cost assumption a researcher forgot they enabled
            is indistinguishable from a strategy that stopped working. */}
        <details className="friction-group" open={frictionsOn}>
          {/* The row is a child of the summary, not the summary itself. A
              `display: flex` summary loses the browser's disclosure marker —
              the marker only renders for `display: list-item` — which left
              this control with no sign it opened at all, and the state badge
              on the right reading as the thing to click. Every other <details>
              on the desk uses the native marker; this one does again. */}
          <summary>
            <span className="friction-group__row">
              {/* "Microstructure frictions" needed 272px of a 235px row and
                  wrapped the badge onto a second line. The word doing the work
                  is not "microstructure" — the note one line below already
                  says "Beyond flat fee and slippage", which is the same
                  distinction with room to make it. */}
              <span className="friction-group__label">Frictions</span>
              <span
                className={frictionsOn ? "friction-badge is-on" : "friction-badge"}
                title={frictionSummary ?? undefined}
              >
                {frictionSummary ? `modelled: ${frictionSummary}` : "flat bps only"}
              </span>
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

        {/* The "Run sweep now" button that used to close this panel is gone.
            Three ways to start the same sweep were visible at once on Research
            ▸ Summary — this one, "Run now" on the section rail, and ⌘/Ctrl+Enter
            (which the palette also offers) — and this was the one that scrolled
            away with the setup it sat under. The rail button survives scrolling
            and stays beside the Auto switch that suspends it. */}
        </div>
      </div>
    </div>
  );
}
