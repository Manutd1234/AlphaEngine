"use client";

/**
 * The three-component fee, worked through on the exchange's own example.
 *
 * The defaults reproduce Kalshi's documented case — 0.09 contracts at $0.3301
 * bought in three lots by an ordinary account — because that is where the
 * component nobody models is nineteen times larger than the one everybody
 * does, and where the net fee exceeds the notional traded outright.
 *
 * The worked example LEADS WITH A DRAWING since the third 2026-08-24 review
 * ("every subtab must have an interactive diagram"): the fee components as
 * one segmented bar against the notional beneath it, on one scale, so "the
 * fee is bigger than the position" is a picture before it is a row. The
 * per-fill table remains the proof: read the rounding and rebate columns
 * together and the accumulator's job is visible — it gives back whole cents,
 * which is why fragmentation is nearly free and why the sub-cent remainder it
 * cannot give back sets a floor under any clip worth trading.
 *
 * TWO DRAWINGS ON THE WORKED EXAMPLE SINCE THE FOURTH PASS of 2026-08-24, and
 * a folded ledger under them. `FeeTotalsBar` answers whether the fee is bigger
 * than the position; `FillStrip` answers what one more fill costs, which was
 * six columns read downwards. The per-fill table is behind a disclosure that
 * counts its rows — it is the proof, and proof is what a reader opens rather
 * than what they scroll past.
 *
 * Both views draw off the one `fees` read `FeesSection` owns. THE EXAMPLE
 * PICKER LEFT THIS FILE ON 2026-08-25 and the reversal is worth a sentence,
 * because the old arrangement was a reasonable answer to the wrong question. It
 * rendered inside the worked example so that two `.seg` controls would not
 * stack — true, and it achieved that by putting the second control one row
 * FURTHER down, under a subheading, which is the same two rows of chrome with
 * a heading between them. The fix is not where the second seg goes, it is that
 * a picker is not a seg: it is a `<select>` on the section's own control row
 * now, beside the views, which is one row in total.
 */

import type { CoherenceFeeFill, CoherenceFees } from "@/lib/coherence/types";
import FeeParabola from "./FeeParabola";
import Figure, { FigureEmpty, Plot } from "./Figure";
import ValueStrip from "./ValueStrip";

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

/** The two views this pane draws. Ablation is its own rail section now. */
export type FeesView = "example" | "shape";

const HEADINGS: Record<FeesView, string> = {
  example: "What one worked position pays, fill by fill",
  shape: "The cost curve, and the threshold it moves",
};

/** True when the net fee is larger than the notional it was charged on. */
export function feesExceedNotional(share: string | null): boolean {
  return share != null && Number(share) > 1;
}

/**
 * A wire amount as a plain number, for BAR GEOMETRY only. Kalshi's own example
 * carries sub-centicent quantities (0.09 × $0.3301 of notional), finer than
 * `toCenticents` accepts, and pixels are not a quantity a reader checks: every
 * number a reader READS is the wire string in the table below.
 */
function toAmount(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?\d*(?:\.\d*)?$/.test(raw.trim()) || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const BAR_H = 18;
const FEE_Y = 24;
const NOTIONAL_Y = 72;

/** The fee components and the notional, on one scale. */
function FeeTotalsBar({ total }: { total: CoherenceFeeFill | null }) {
  const caption = "The fee's components against the notional, one scale";
  const trade = toAmount(total?.trade_fee);
  const rounding = toAmount(total?.rounding_fee);
  const net = toAmount(total?.net);
  const notional = toAmount(total?.notional);
  if (total == null || trade == null || rounding == null || net == null || notional == null) {
    return (
      <Figure caption={caption} ariaLabel="No fee total to draw" missing="The read returned no total — a bar of the fills that did arrive would understate the position's cost.">
        <FigureEmpty reason="No total came back." />
      </Figure>
    );
  }
  const top = Math.max(trade + rounding, notional, 1e-9);
  return (
    <Figure
      caption={caption}
      ariaLabel={`Trade fee ${total.trade_fee} plus rounding fee ${total.rounding_fee}, rebate ${total.rebate}, net ${total.net}, against notional ${total.notional}`}
    >
      <Plot height={104}>
        {(width) => {
          const x = (amount: number) => (amount / top) * width;
          const netX = x(Math.max(0, net));
          return (
            <>
              <text x={0} y={FEE_Y - 8} className="coh-axis__label">fee, gross then net of rebate</text>
              <rect x={0} y={FEE_Y} width={Math.max(1, x(trade))} height={BAR_H} className="coh-dollarbar__leg is-leg-1">
                <title>{`trade fee ${total.trade_fee}`}</title>
              </rect>
              <rect x={x(trade)} y={FEE_Y} width={Math.max(1, x(trade + rounding) - x(trade))} height={BAR_H} className="coh-dollarbar__leg is-leg-2">
                <title>{`rounding fee ${total.rounding_fee}`}</title>
              </rect>
              <line x1={netX} x2={netX} y1={FEE_Y - 4} y2={FEE_Y + BAR_H + 4} className="coh-combo__price">
                <title>{`net after rebate ${total.net}`}</title>
              </line>
              <text x={Math.min(x(trade + rounding) + 6, width - 4)} y={FEE_Y + 13}
                    textAnchor={x(trade + rounding) > width * 0.8 ? "end" : "start"} className="coh-axis__label">
                {`net ${total.net}`}
              </text>

              <text x={0} y={NOTIONAL_Y - 8} className="coh-axis__label">notional traded</text>
              <rect x={0} y={NOTIONAL_Y} width={Math.max(1, x(notional))} height={BAR_H} className="coh-kelly__bar-cash">
                <title>{`notional ${total.notional}`}</title>
              </rect>
              <text x={Math.min(x(notional) + 6, width - 4)} y={NOTIONAL_Y + 13}
                    textAnchor={x(notional) > width * 0.8 ? "end" : "start"} className="coh-axis__label">
                {total.notional}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}

/**
 * What each fill cost, net of the rebate — the fragmentation half of the view.
 *
 * The totals bar answers "is the fee bigger than the position". It cannot
 * answer the second question the worked example is FOR: what one more fill
 * costs. That was six columns of a table read down, and reading down a column
 * is exactly the comparison a row of bars answers by looking.
 *
 * DRAWN ONLY ABOVE ONE FILL, and the condition is the argument. On a
 * single-fill example every bar here would be the totals bar again at a
 * different width, which is decoration; the interesting shape starts at the
 * second fill, where the accumulator has whole cents to give back.
 *
 * `ValueStrip` again, for the same reason `LegStrip` uses it: one drawing role,
 * classes that already exist, and a row that can decline its bar with a reason
 * rather than drawing a length nobody measured.
 */
function FillStrip({ fills }: { fills: CoherenceFeeFill[] }) {
  if (fills.length < 2) return null;
  const rows = fills.map((fill, index) => {
    const net = toAmount(fill.net);
    return {
      label: `fill ${index + 1}`,
      value: net,
      text: fill.net,
      title: `fill ${index + 1}: trade ${fill.trade_fee}, rounding ${fill.rounding_fee}, `
        + `rebate ${fill.rebate}, net ${fill.net} on ${fill.notional} of notional`,
      noBar: net == null ? "not a readable amount" : undefined,
    };
  });
  return (
    <ValueStrip
      caption="What each fill cost, net of the rebate"
      ariaLabel={`Net fee for each of ${fills.length} fills, against zero`}
      rows={rows}
      reading="Each bar is what the fill cost after the rebate, so a short bar is a fill the accumulator nearly repaid."
      missing={
        rows.some((row) => row.noBar)
          ? "A fill whose net did not parse keeps its row and draws no bar."
          : null
      }
    />
  );
}

export default function FeesPane({
  fees,
  error,
  view,
  parabolaAt,
  parabolaLink,
}: {
  /** The worked example as the gateway priced it, or null until it answers. */
  fees: CoherenceFees | null;
  error: string | null;
  view: FeesView;
  /** The curve's own prices and pair key, forwarded to the parabola. */
  parabolaAt?: readonly number[];
  parabolaLink?: string;
}) {
  const heading = <h4 className="console-subhead">{HEADINGS[view]}</h4>;

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
        <FeeParabola
          at={parabolaAt}
          link={parabolaLink}
          multiplier={fees.multiplier}
          feeAwareThreshold={fees.fee_aware_threshold}
        />

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

        {/* The four figures stay: they are what the curve is drawn from and
            what a reader came to the view for. What folds is the PROSE about
            them — why the clip floor sits where it does, and the gateway's own
            qualifications of this read — which is method, not measurement. */}
        <details className="disclosure">
          <summary>
            {fees.notes.length
              ? `Why the minimum clip sits where it does, and ${fees.notes.length} `
                + `${fees.notes.length === 1 ? "note" : "notes"} from the gateway`
              : "Why the minimum clip sits where it does"}
          </summary>
          <p className="coh-event__note">{fees.minimum_clip_note}</p>
          {fees.notes.map((note, index) => (
            <p className="coh-event__note" key={`${index}-${note}`}>
              {note}
            </p>
          ))}
        </details>
      </>
    );
  }

  return (
    <>
      {heading}

      <FeeTotalsBar total={fees.total} />
      <FillStrip fills={fees.per_fill} />

      {/* The two drawings answer the view; the ledger proves them. Folded on
          the fourth pass of 2026-08-24, with the count in the summary so the
          size of what is inside is known before it is opened. Nothing left the
          page: the rounding and rebate columns are the only place the
          accumulator's arithmetic can be checked fill by fill. */}
      <details className="disclosure">
        <summary>
          Every fill through all three components, {fees.per_fill.length}{" "}
          {fees.per_fill.length === 1 ? "fill" : "fills"} and the total
        </summary>
      <div className="table-wrap" tabIndex={0}>
        <table className="coh-table">
          <caption className="coh-table__caption">
            The rebate is the accumulator giving back whole cents.
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
          </tbody>
          {fees.total ? (
            <tfoot>
              <tr className="coh-table__total">
                <th scope="row">Total</th>
                <td className="num">{fees.total.trade_fee}</td>
                <td className="num">{fees.total.rounding_fee}</td>
                <td className="num">{fees.total.rebate}</td>
                <td className="num">{fees.total.net}</td>
                <td className="num">{fees.total.notional}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      </details>
    </>
  );
}
