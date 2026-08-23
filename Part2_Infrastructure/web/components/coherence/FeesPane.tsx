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
 *
 * Two of the section's three views are drawn here, both off the one `fees` read
 * `FeesSection` owns. The worked-example picker renders INSIDE the worked
 * example rather than under the section's view rail: two `.seg` controls in a
 * row read as one broken rail, so the heading and the framing chips stand
 * between them.
 */

import type { CoherenceFees } from "@/lib/coherence/types";
import FeeParabola from "./FeeParabola";

/** One row of the picker: the query it asks, and what it demonstrates. */
export interface FeeExample {
  id: string;
  label: string;
  price: string;
  contracts: string;
  fills: number;
}

export const EXAMPLES: readonly FeeExample[] = [
  { id: "kalshi", label: "Kalshi's own example", price: "0.3301", contracts: "0.09", fills: 3 },
  { id: "middle", label: "100 contracts at 50c", price: "0.5000", contracts: "100", fills: 1 },
  { id: "tail", label: "100 contracts at 3c", price: "0.0300", contracts: "100", fills: 1 },
  { id: "picked", label: "100 contracts, 40 fills", price: "0.5000", contracts: "100", fills: 40 },
];

/** The two views this pane draws. The third — Ablation — is `AblationPane`. */
export type FeesView = "example" | "shape";

const HEADINGS: Record<FeesView, string> = {
  example: "What one worked position pays, fill by fill",
  shape: "The cost curve, and the threshold it moves",
};

/** True when the net fee is larger than the notional it was charged on. */
export function feesExceedNotional(share: string | null): boolean {
  return share != null && Number(share) > 1;
}

export default function FeesPane({
  fees,
  error,
  view,
  example,
  onExample,
}: {
  /** The worked example as the gateway priced it, or null until it answers. */
  fees: CoherenceFees | null;
  error: string | null;
  view: FeesView;
  example: FeeExample;
  onExample: (next: FeeExample) => void;
}) {
  const heading = <h4>{HEADINGS[view]}</h4>;

  if (error && !fees) {
    return (
      <>
        {heading}
        <p className="console-empty">
          <span aria-hidden="true">✕</span> The fee model could not be read: {error}
        </p>
      </>
    );
  }
  if (!fees) {
    return (
      <>
        {heading}
        <p className="console-empty muted">Working the example…</p>
      </>
    );
  }

  if (view === "shape") {
    return (
      <>
        {heading}
        <FeeParabola multiplier={fees.multiplier} feeAwareThreshold={fees.fee_aware_threshold} />
        {/* This belongs in the figure's own `missing` line. `FeeParabola` takes
            no `missing` prop and is not this slice's file, so the fact is said
            here rather than left unsaid. */}
        <p className="coh-event__note">
          <span aria-hidden="true">◌</span> The curve is drawn at the taker rate of 0.07 times the series multiplier. It
          models no maker fee, so a resting order&rsquo;s cost is not on it.
        </p>

        <dl className="coh-status__facts">
          <div>
            <dt>Minimum clip for a 2c edge</dt>
            <dd>{fees.minimum_clip ?? "—"}</dd>
          </div>
          <div>
            <dt>Balance precision</dt>
            <dd>{fees.balance_precision}</dd>
          </div>
          <div>
            <dt>Series fee multiplier</dt>
            <dd>{fees.multiplier}</dd>
          </div>
          <div>
            <dt>Fee-aware no-arbitrage bound</dt>
            <dd>{fees.fee_aware_threshold ?? "—"}</dd>
          </div>
        </dl>

        <p className="coh-event__note">{fees.minimum_clip_note}</p>
        {fees.notes.map((note, index) => (
          <p className="coh-event__note" key={`${index}-${note}`}>
            {note}
          </p>
        ))}
      </>
    );
  }

  const overNotional = feesExceedNotional(fees.net_as_fraction_of_notional);

  return (
    <>
      {heading}

      {overNotional ? (
        <p className="coh-event__note">
          <span aria-hidden="true">▲</span> These fees exceed the position: at this size the rounding component alone is
          larger than the trade, which is what a minimum clip size exists to prevent.
        </p>
      ) : null}

      <div className="seg coh-books__picker" role="group" aria-label="Choose a worked example">
        {EXAMPLES.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={item.id === example.id}
            onClick={() => onExample(item)}
          >
            {item.label}
          </button>
        ))}
      </div>

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
            {fees.per_fill.map((fill, index) => (
              <tr key={`${fill.trade_fee}-${index}`}>
                <th scope="row">{index + 1}</th>
                <td className="num">{fill.trade_fee}</td>
                <td className="num">{fill.rounding_fee}</td>
                <td className="num">{fill.rebate}</td>
                <td className="num">{fill.net}</td>
                <td className="num">{fill.notional}</td>
              </tr>
            ))}
            {fees.total ? (
              <tr className="coh-table__total">
                <th scope="row">Total</th>
                <td className="num">{fees.total.trade_fee}</td>
                <td className="num">{fees.total.rounding_fee}</td>
                <td className="num">{fees.total.rebate}</td>
                <td className="num">{fees.total.net}</td>
                <td className="num">{fees.total.notional}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </>
  );
}
