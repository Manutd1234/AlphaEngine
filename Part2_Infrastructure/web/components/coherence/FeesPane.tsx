"use client";

/**
 * The three-component fee, worked through on the exchange's own example.
 *
 * The defaults reproduce Kalshi's documented case — 0.09 contracts at $0.3301
 * bought in three lots by an ordinary account — because that is where the
 * component nobody models is nineteen times larger than the one everybody does,
 * and where the net fee exceeds the notional traded outright.
 *
 * The per-fill table is the argument. Read down the rounding column and the
 * rebate column together and the accumulator's job is visible: it gives back
 * whole cents, which is why fragmentation is very nearly free and why what it
 * cannot give back — the sub-cent remainder — is what sets a floor under any
 * clip worth trading.
 */

import { useState } from "react";

import type { CoherenceFees } from "@/lib/coherence/types";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FeeParabola from "./FeeParabola";
import { StateChip } from "./Figure";

const EXAMPLES = [
  { id: "kalshi", label: "Kalshi's own example", price: "0.3301", contracts: "0.09", fills: 3 },
  { id: "middle", label: "100 contracts at 50c", price: "0.5000", contracts: "100", fills: 1 },
  { id: "tail", label: "100 contracts at 3c", price: "0.0300", contracts: "100", fills: 1 },
  { id: "picked", label: "100 contracts, 40 fills", price: "0.5000", contracts: "100", fills: 40 },
];

export default function FeesPane({ active }: { active: boolean }) {
  const [example, setExample] = useState(EXAMPLES[0]);
  const query = `price=${example.price}&contracts_fp=${example.contracts}&fills=${example.fills}`;
  const { data, error } = useCoherenceRead<CoherenceFees>(`/api/gateway/coherence/fees?${query}`, active);

  if (error && !data) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">✕</span> The fee model could not be read: {error}
      </p>
    );
  }
  if (!data) return <p className="console-empty muted">Working the example…</p>;

  const overNotional = data.net_as_fraction_of_notional && Number(data.net_as_fraction_of_notional) > 1;

  return (
    <div className="coh-fees">
      <div className="seg coh-books__picker" role="group" aria-label="Choose a worked example">
        {EXAMPLES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === example.id}
            onClick={() => setExample(item)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="coh-status__chips">
        <StateChip
          mark={overNotional ? "▲" : "●"}
          word="Net fee"
          value={data.total?.net ?? "—"}
          tone={overNotional ? "critical" : "muted"}
        />
        <StateChip mark="◇" word="Notional traded" value={data.total?.notional ?? "—"} tone="muted" />
        <StateChip
          mark={overNotional ? "▲" : "◇"}
          word="Fee as a share of notional"
          value={data.net_as_fraction_of_notional ?? "—"}
          tone={overNotional ? "critical" : "muted"}
        />
      </div>

      {overNotional ? (
        <p className="coh-event__note">
          <span aria-hidden="true">▲</span> The fees on this position exceed the position. At this size the rounding
          component alone is larger than the trade, which is what a minimum clip size exists to prevent.
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Every fill, component by component. The rebate column is the accumulator giving back whole cents.
          </caption>
          <thead>
            <tr>
              <th scope="col">Fill</th>
              <th scope="col" className="num">Trade fee</th>
              <th scope="col" className="num">Rounding fee</th>
              <th scope="col" className="num">Rebate</th>
              <th scope="col" className="num">Net</th>
              <th scope="col" className="num">Notional</th>
            </tr>
          </thead>
          <tbody>
            {data.per_fill.map((fill, index) => (
              <tr key={`${fill.trade_fee}-${index}`}>
                <th scope="row">{index + 1}</th>
                <td className="num">{fill.trade_fee}</td>
                <td className="num">{fill.rounding_fee}</td>
                <td className="num">{fill.rebate}</td>
                <td className="num">{fill.net}</td>
                <td className="num">{fill.notional}</td>
              </tr>
            ))}
            {data.total ? (
              <tr className="coh-table__total">
                <th scope="row">Total</th>
                <td className="num">{data.total.trade_fee}</td>
                <td className="num">{data.total.rounding_fee}</td>
                <td className="num">{data.total.rebate}</td>
                <td className="num">{data.total.net}</td>
                <td className="num">{data.total.notional}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <FeeParabola multiplier={data.multiplier} feeAwareThreshold={data.fee_aware_threshold} />

      <dl className="coh-status__facts">
        <div>
          <dt>Minimum clip for a 2c edge</dt>
          <dd>{data.minimum_clip ?? "—"}</dd>
        </div>
        <div>
          <dt>Balance precision</dt>
          <dd>{data.balance_precision}</dd>
        </div>
        <div>
          <dt>Series fee multiplier</dt>
          <dd>{data.multiplier}</dd>
        </div>
        <div>
          <dt>Fee-aware no-arbitrage bound</dt>
          <dd>{data.fee_aware_threshold ?? "—"}</dd>
        </div>
      </dl>

      <p className="coh-event__note">{data.minimum_clip_note}</p>
      {data.notes.map((note, index) => (
        <p className="coh-event__note" key={`${index}-${note}`}>
          {note}
        </p>
      ))}
    </div>
  );
}
