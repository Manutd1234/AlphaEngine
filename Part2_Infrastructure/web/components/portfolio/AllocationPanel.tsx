"use client";

/**
 * What the book should be, next to what it is.
 *
 * Everything else on this tab describes the current book. This is the only
 * panel that proposes a different one, so it carries the heaviest caveat: the
 * proposal forecasts *no* returns. It allocates by risk, because forecasting
 * covariance is hard and forecasting returns is harder, and a panel that
 * implied otherwise would be an opinion wearing arithmetic's clothes.
 *
 * Four things are deliberate:
 *
 *  - **The drift band is adjustable and starts at 5%.** Rebalancing every
 *    deviation is a fee-generating machine; the band is where a PM decides how
 *    much drift is cheaper to tolerate than to correct.
 *  - **Clipped targets name the limit that clipped them.** A proposal the risk
 *    gate would reject order by order is a worse way to learn about a limit.
 *  - **Manual override is not a fifth model.** The selector lists things that
 *    were *solved*; putting "manual" in it is exactly the misreading to prevent.
 *    It is a separate toggle, the selector stays visible as the seed, and the
 *    Model column keeps the solved answer on screen beside the typed one.
 *  - **Trades are composed, never sent.** The hand-off shows the exact
 *    authenticated request; sending it stays behind the operator gate on the
 *    execution surface, where every other write in this app lives.
 */

import { useMemo, useState } from "react";

import DriftBars from "@/components/portfolio/DriftBars";
import { fmt, pct, usd } from "@/lib/format";
import {
  applyManualWeights,
  proposeAllocation,
  rebalanceTrades,
  type AllocationMethod,
  type CovarianceModel,
  type RiskPosition,
} from "@/lib/portfolio-risk";

interface AllocationPanelProps {
  positions: RiskPosition[];
  model: CovarianceModel | null;
  limits: { maxSymbolNotional?: number; maxGrossNotional?: number };
}

const METHODS: Array<{ id: AllocationMethod; label: string; group: string; explain: string }> = [
  {
    id: "equal_weight",
    label: "Equal weight",
    group: "Naive",
    explain: "Every position the same size. It knows nothing about volatility or correlation and does not pretend to — which is what makes it the baseline the other three have to beat.",
  },
  {
    id: "inverse_vol",
    label: "Inverse volatility",
    group: "Risk-based",
    explain: "Each position sized by the reciprocal of its own volatility — a quiet name carries more notional for the same risk. Ignores correlation.",
  },
  {
    id: "equal_risk",
    label: "Equal risk contribution",
    group: "Risk-based",
    explain: "Each position contributes the same share of book volatility. Accounts for correlation, so two names that move together are sized as one bet.",
  },
  {
    id: "min_variance",
    label: "Minimum variance",
    group: "Risk-based",
    explain: "The long-only book with the smallest variance this covariance allows. The most concentrated of the four by construction, so it runs into a symbol cap sooner than the others.",
  },
];

const GROUPS = ["Naive", "Risk-based"];

export default function AllocationPanel({ positions, model, limits }: AllocationPanelProps) {
  const [method, setMethod] = useState<AllocationMethod>("inverse_vol");
  const [driftBand, setDriftBand] = useState(0.05);
  const [override, setOverride] = useState(false);
  const [pinned, setPinned] = useState<Record<string, number>>({});
  // The raw text is held separately while a cell is focused. A controlled
  // numeric input that re-normalises on every keystroke makes "0.2" unreachable:
  // typing "0" redistributes everything to zero and the next keystroke lands on
  // a different number than the one being typed.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const proposal = useMemo(
    () => (model ? proposeAllocation(positions, model, method, limits) : null),
    [positions, model, method, limits],
  );
  const manual = useMemo(
    () => (proposal && override ? applyManualWeights(proposal, pinned, limits) : null),
    [proposal, override, pinned, limits],
  );
  const active = manual ?? proposal;
  const trades = useMemo(
    () => (active && (!manual || manual.balanced) ? rebalanceTrades(active, positions, driftBand) : []),
    [active, manual, positions, driftBand],
  );

  if (!model || !proposal || !active) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Capital allocation</span>
            <h2>Target weights</h2>
          </div>
        </div>
        <p className="sub">
          A flat book, or too little shared price history to measure volatility. Allocation needs a
          covariance, and a covariance needs history — the proposal is withheld rather than guessed.
        </p>
      </div>
    );
  }

  const selected = METHODS.find((m) => m.id === method)!;
  const modelWeights = new Map(proposal.targets.map((t) => [t.symbol, t.targetWeight]));

  const commitDraft = (symbol: string) => {
    const trimmed = draft.trim();
    setEditing(null);
    setPinned((current) => {
      const next = { ...current };
      if (!trimmed) {
        // Cleared means un-pinned: the row goes back to being model-driven
        // rather than pinned at zero, which are very different instructions.
        delete next[symbol];
        return next;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) return current;
      next[symbol] = Math.max(0, Math.min(1, parsed / 100));
      return next;
    });
  };

  const overshoot = manual ? manual.weightSum - 1 : 0;
  /**
   * When the gross cap sits below current gross, `targetWeight` is measured
   * over the cap while `drift` is measured over gross — so `current → target`
   * stops equalling the drift beside it. The chart drops that annotation
   * rather than printing two numbers whose difference is not the third.
   */
  const capBinds = Boolean(
    limits.maxGrossNotional != null && limits.maxGrossNotional < active.grossBefore,
  );

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Capital allocation{manual ? " · manual" : ""}</span>
          <h2>
            Target weights
            {manual && <span className="allocation-override-chip">Override</span>}
          </h2>
        </div>
        <div className="allocation-controls">
          <label className="allocation-method-label" htmlFor="allocation-method">
            {manual ? "Seed" : "Model"}
          </label>
          <select
            id="allocation-method"
            className="allocation-method"
            value={method}
            disabled={override}
            onChange={(event) => setMethod(event.target.value as AllocationMethod)}
          >
            {GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {METHODS.filter((option) => option.group === group).map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
          <button
            type="button"
            aria-pressed={override}
            className="allocation-override-toggle"
            onClick={() => {
              setOverride((on) => !on);
              setEditing(null);
            }}
          >
            {override ? "Using typed weights" : "Override"}
          </button>
        </div>
      </div>

      {manual && !manual.balanced && (
        <div className="banner warn" role="status" aria-live="polite">
          <span aria-hidden>◆</span>
          <div>
            <strong>Weights sum to {pct(manual.weightSum, 1)}</strong> —{" "}
            {overshoot > 0
              ? `over-allocated by ${fmt(overshoot * 100, 1)}pp.`
              : `under-allocated by ${fmt(-overshoot * 100, 1)}pp.`}{" "}
            Trades are withheld until it balances. Nothing you typed has been rescaled to hide it.
          </div>
        </div>
      )}

      <DriftBars
        targets={active.targets}
        driftBand={driftBand}
        trades={trades}
        capBinds={capBinds}
        unbalancedSum={manual && !manual.balanced ? manual.weightSum : null}
      />

      {/* The control sits directly under the region it shades, so moving it is
          direct manipulation of the chart rather than an unrelated setting. */}
      <div className="allocation-band">
        <label>
          <span>Drift band · {pct(driftBand, 0)}</span>
          <input
            type="range"
            min={0.01}
            max={0.25}
            step={0.01}
            value={driftBand}
            onChange={(event) => setDriftBand(Number(event.target.value))}
          />
        </label>
      </div>

      {/* Forced open while overriding: the toggle's whole effect is the inputs
          in this table, and a control whose result is hidden reads as broken. */}
      <details className="disclosure" open={override}>
        <summary>Every weight as a table — notional now and notional target per symbol</summary>
        <div className="table-wrap" tabIndex={0}>
        <table>
          <caption className="sr-only">
            Current and proposed weight per position, with the drift between them.
          </caption>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Current</th>
              {override && <th scope="col">Model</th>}
              <th scope="col">Target</th>
              <th scope="col">Notional now</th>
              <th scope="col">Notional target</th>
              <th scope="col">Drift</th>
            </tr>
          </thead>
          <tbody>
            {active.targets.map((target) => {
              const isPinned = manual?.pinned.includes(target.symbol) ?? false;
              return (
                <tr key={target.symbol}>
                  <td>
                    {target.symbol}
                    {isPinned && <small className="muted"> · pinned</small>}
                    {target.clippedBy && (
                      <small className="muted"> · capped by {target.clippedBy}</small>
                    )}
                  </td>
                  <td className="num">{pct(target.currentWeight, 1)}</td>
                  {override && (
                    <td className="num muted">{pct(modelWeights.get(target.symbol) ?? 0, 1)}</td>
                  )}
                  <td className="num">
                    {override ? (
                      <input
                        className="allocation-target-input"
                        type="text"
                        inputMode="decimal"
                        aria-label={`Target weight for ${target.symbol}, percent`}
                        value={
                          editing === target.symbol
                            ? draft
                            : fmt((pinned[target.symbol] ?? target.targetWeight) * 100, 1)
                        }
                        onFocus={() => {
                          setEditing(target.symbol);
                          setDraft(fmt((pinned[target.symbol] ?? target.targetWeight) * 100, 1));
                        }}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => commitDraft(target.symbol)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") { event.currentTarget.blur(); }
                          if (event.key === "Escape") { setEditing(null); }
                        }}
                      />
                    ) : (
                      pct(target.targetWeight, 1)
                    )}
                  </td>
                  <td className="num">{usd(target.currentNotional)}</td>
                  <td className="num">{usd(target.targetNotional)}</td>
                  <td className={`num ${Math.abs(target.drift) >= driftBand ? (target.drift > 0 ? "pos" : "neg") : "muted"}`}>
                    {target.drift > 0 ? "+" : ""}{pct(target.drift, 1)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      </details>

      {manual && !manual.balanced ? null : trades.length === 0 ? (
        <p className="research-note">
          Nothing is outside the band — the book is already close enough to target that trading it
          would cost more than the drift does.
        </p>
      ) : (
        <>
          <h3 className="allocation-subhead">Trades to close the gap</h3>
          <ul className="allocation-trades">
            {trades.map((trade) => (
              <li key={trade.symbol}>
                <span className={trade.side === "BUY" ? "pos" : "neg"}>{trade.side}</span>
                <strong>{usd(trade.notional)}</strong>
                <span>{trade.symbol}</span>
                <small className="muted">{trade.reason}</small>
              </li>
            ))}
          </ul>
          <p className="research-note">
            Composed, not sent. Each of these is an ordinary order and would face the same fourteen
            pre-trade gates as any other — including the ones that may reject it. Gross would move
            from {usd(active.grossBefore)} to {usd(active.grossAfter)}.
            {active.clipped && " Some targets were capped by a risk limit, so the weights below no longer sum to one."}
          </p>
        </>
      )}

      <details className="disclosure">
        <summary>
          {manual
            ? `What you typed, against what ${selected.label.toLowerCase()} solved`
            : `What ${selected.label.toLowerCase()} assumes, what it ignores, `
              + `and the ${fmt(model.observations, 0)} observations behind it`}
        </summary>
        <p className="research-note">
          {manual
            ? `Targets you typed, seeded from ${selected.label.toLowerCase()}. The Model column keeps the solved answer beside yours.`
            : selected.explain}
        </p>
        <p className="research-note">
          {manual ? (
            <>
              These target weights were entered, not solved. The Model column shows what{" "}
              {selected.label.toLowerCase()} proposed; the difference is a judgement this panel does
              not evaluate. Weights you do not pin are spread across the remainder in the
              model&apos;s own proportions, so pinning one name does not silently resize the rest.
            </>
          ) : (
            <>
              No expected return is forecast anywhere in this proposal. It answers &quot;how should
              the risk be spread&quot;, never &quot;what should we own&quot;. Measured over{" "}
              {fmt(model.observations, 0)} observations.
            </>
          )}
        </p>
        <p className="research-note">
          Positions inside the drift band are left alone. Correcting a small deviation costs more in
          fees and slippage than the deviation costs in risk — which is what the shaded region on the
          chart is, and why widening it removes trades.
        </p>
        {capBinds && (
          <p className="research-note">
            The gross cap currently sits below current gross, so target weights are measured over the
            cap while drift is measured over gross. The chart therefore withholds the{" "}
            <span className="num">current → target</span> pair rather than printing two numbers whose
            difference is not the drift beside them.
          </p>
        )}
      </details>
    </div>
  );
}
