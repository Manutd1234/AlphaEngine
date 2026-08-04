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
 * Three things are deliberate:
 *
 *  - **The drift band is adjustable and starts at 5%.** Rebalancing every
 *    deviation is a fee-generating machine; the band is where a PM decides how
 *    much drift is cheaper to tolerate than to correct.
 *  - **Clipped targets name the limit that clipped them.** A proposal the risk
 *    gate would reject order by order is a worse way to learn about a limit.
 *  - **Trades are composed, never sent.** The hand-off shows the exact
 *    authenticated request; sending it stays behind the operator gate on the
 *    execution surface, where every other write in this app lives.
 */

import { useMemo, useState } from "react";

import { fmt, pct, usd } from "@/lib/format";
import {
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

const METHODS: Array<{ id: AllocationMethod; label: string; explain: string }> = [
  {
    id: "inverse_vol",
    label: "Inverse volatility",
    explain: "Each position sized by the reciprocal of its own volatility — a quiet name carries more notional for the same risk. Ignores correlation.",
  },
  {
    id: "equal_risk",
    label: "Equal risk contribution",
    explain: "Each position contributes the same share of book volatility. Accounts for correlation, so two names that move together are sized as one bet.",
  },
];

export default function AllocationPanel({ positions, model, limits }: AllocationPanelProps) {
  const [method, setMethod] = useState<AllocationMethod>("inverse_vol");
  const [driftBand, setDriftBand] = useState(0.05);

  const proposal = useMemo(
    () => (model ? proposeAllocation(positions, model, method, limits) : null),
    [positions, model, method, limits],
  );
  const trades = useMemo(
    () => (proposal ? rebalanceTrades(proposal, positions, driftBand) : []),
    [proposal, positions, driftBand],
  );

  if (!model || !proposal) {
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

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Capital allocation</span>
          <h2>Target weights</h2>
        </div>
        <div className="seg" role="group" aria-label="Allocation method">
          {METHODS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={method === option.id}
              onClick={() => setMethod(option.id)}
              title={option.explain}
            >
              {option.id === "inverse_vol" ? "Inv. vol" : "Equal risk"}
            </button>
          ))}
        </div>
      </div>

      <p className="sub">{selected.explain}</p>

      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Current and proposed weight per position, with the drift between them.
          </caption>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Current</th>
              <th scope="col">Target</th>
              <th scope="col">Notional now</th>
              <th scope="col">Notional target</th>
              <th scope="col">Drift</th>
            </tr>
          </thead>
          <tbody>
            {proposal.targets.map((target) => (
              <tr key={target.symbol}>
                <td>
                  {target.symbol}
                  {target.clippedBy && (
                    <small className="muted"> · capped by {target.clippedBy}</small>
                  )}
                </td>
                <td className="num">{pct(target.currentWeight, 1)}</td>
                <td className="num">{pct(target.targetWeight, 1)}</td>
                <td className="num">{usd(target.currentNotional)}</td>
                <td className="num">{usd(target.targetNotional)}</td>
                <td className={`num ${Math.abs(target.drift) >= driftBand ? (target.drift > 0 ? "pos" : "neg") : "muted"}`}>
                  {target.drift > 0 ? "+" : ""}{pct(target.drift, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
        <small className="muted">
          Positions inside the band are left alone. Correcting a small deviation costs more in fees
          and slippage than the deviation costs in risk.
        </small>
      </div>

      {trades.length === 0 ? (
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
            from {usd(proposal.grossBefore)} to {usd(proposal.grossAfter)}.
            {proposal.clipped && " Some targets were capped by a risk limit, so the weights below no longer sum to one."}
          </p>
        </>
      )}

      <p className="research-note">
        No expected return is forecast anywhere in this proposal. It answers &quot;how should the
        risk be spread&quot;, never &quot;what should we own&quot;. Measured over{" "}
        {fmt(model.observations, 0)} observations.
      </p>
    </div>
  );
}
