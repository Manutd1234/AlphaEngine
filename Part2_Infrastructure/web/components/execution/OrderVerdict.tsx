"use client";

/**
 * The gateway's answer, both ways round.
 *
 * The point of the order ticket is not that it sends orders — it is that it
 * renders the whole check vector for an acceptance AND a refusal. A panel that
 * says only "rejected" teaches a trader nothing; one that names the gate that
 * fired, with the number that tripped it, turns a refusal into information.
 * This is that panel, split out of `OrderTicket` when the file passed the
 * length ceiling.
 *
 * Nothing is inferred here. A missing latency prints nothing rather than a
 * zero, an absent fill is simply absent, and a LIMIT fill says which side of
 * the spread it crossed rather than leaving the reader to assume.
 *
 * WHY THIS IS A TABLE AND NOT A GRID OF LIST ITEMS
 * ------------------------------------------------------------------------
 * It was `<ol class="cockpit-checks">` under `repeat(auto-fill, minmax(230px,
 * 1fr))`, and a $25k buy on a desk-width ticket put that grid into two ~230px
 * columns for content that does not fit in 230px. Measured on the reported
 * screenshots: `symbol_whitelist BTCUSDT in the live L2 universe or backed by
 * a trusted paper-equity quote` wrapped over SEVEN lines beside a cell holding
 * the four words `kill_switch disengaged`, and because a wrapped flex item
 * grows its row while its neighbour does not, `duplicate_order
 * client_order_id=` ran into `rate_limit 1.0/s observed` — in the rejected
 * case directly over the word `rate_limit`, which is the single most important
 * word on the panel.
 *
 * A twelve-row table cannot produce either failure. Cells cannot overlap, one
 * column of gate names is as wide as the longest gate name rather than as wide
 * as 1/nth of the panel, and the figures land in a column of their own where
 * `tabular-nums` (inherited from the base `table` rule) makes them compare by
 * eye. Rejected alternatives, both tried on paper first:
 *
 *   - keeping the grid and widening the track to ~420px: one column at desk
 *     width, so twelve gates become twelve full-width rows with the number
 *     floating wherever the prose ended — the alignment complaint unanswered;
 *   - truncating the long details to one line each: the gates whose detail is
 *     the whole measurement (`$25,000 vs $500,000 cap`) are exactly the ones a
 *     reader is here for, and clipping a limit is the defect this file exists
 *     to avoid.
 *
 * Wide content scrolls INSIDE `.table-wrap`, never the page, and that wrapper
 * carries `tabIndex={0}` so a keyboard reaches the scroll — the same fix
 * OrderBlotter, SpreadDecomposition, RouteEstimate and VenueMixDonut already
 * carry.
 */

import { type CSSProperties } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { fmt, formatDuration, usd } from "@/lib/format";
import type { Decision } from "@/components/execution/ticket-model";

interface OrderVerdictProps {
  /** Every decision from the last submit — a burst preset produces twelve. */
  decisions: Decision[];
  /** The animation key: bumped per submit, so settled rows do not replay. */
  sequence: number;
}

/** One gate's detail, read as the comparison it already contains. */
export interface GateReading {
  /** The measured side of a comparison, e.g. `$25,000`. */
  observed: string | null;
  /** The threshold it was measured against, e.g. `$500,000 cap`. */
  limit: string | null;
  /** A detail that is a statement rather than a comparison. */
  prose: string | null;
}

/**
 * The two separators the gateway itself writes between an observation and the
 * limit it was judged against.
 *
 * `modules/risk_proxy/decision.py` builds every numeric gate's detail as one
 * sentence: `f"${notional:,.0f} vs ${max:,.0f} cap"`, `f"{dd:.2%} used of
 * {max:.2%}"`. So the comparison is already there — this splits the sentence
 * the gateway wrote, it never composes a number of its own.
 *
 * WHY NOT READ THE NUMERIC FIELDS. `CheckResult` in modules/schemas_trading.py
 * carries `observed: float | None` and `limit: float | None` beside the
 * detail, and they reach the browser on a live decision. They are deliberately
 * not used: the float is unitless. `3.0` is orders per second, `0.03` is a
 * fraction of the drawdown budget and `500000.0` is dollars, and this
 * component cannot tell which from the value — it would have to keep a second
 * table of units keyed by gate name, which is a copy of the gateway's
 * formatting that drifts the first time a gate is added. The units live in the
 * string; splitting the string keeps them. It also means the sandbox judge,
 * which publishes no numeric fields at all, gets the identical treatment.
 *
 * ` of ` alone is NOT a separator here. `est_slippage` writes "only $12,000 of
 * $25,000 routable across BINANCE+OKX", where the second half is not a limit —
 * it is the order, and the venue names would end up under a column headed
 * Limit. That check stays prose, which is the honest reading of it.
 */
const COMPARISON = /^(.+?)\s+(?:vs|used of)\s+(.+)$/;

export function readGate(detail: string | null | undefined): GateReading {
  const text = detail?.trim();
  if (!text) return { observed: null, limit: null, prose: null };
  const split = COMPARISON.exec(text);
  if (!split) return { observed: null, limit: null, prose: text };
  return { observed: split[1], limit: split[2], prose: null };
}

/**
 * The gates that refused the order, named.
 *
 * `rejected_by` is the gateway's own list and is authoritative; the fall back
 * to the failed checks is for a decision that carries a vector but no list
 * (the sandbox judge builds one, an older payload may not). Both are read
 * because a rejection whose reason cannot be named is the state this panel
 * exists to prevent.
 */
export function blockingGates(decision: Decision): string[] {
  if (decision.rejected_by?.length) return decision.rejected_by;
  return (decision.checks ?? []).filter((check) => !check.passed).map((check) => check.name);
}

export default function OrderVerdict({ decisions, sequence }: OrderVerdictProps) {
  const latest = decisions[decisions.length - 1];
  const burstAccepted = decisions.filter((decision) => decision.accepted).length;
  // Nothing to answer for: the ticket mounts this only once a submit has
  // returned, and an empty list is not a rejection.
  if (!latest) return null;
  const blocked = latest.accepted ? [] : blockingGates(latest);

  return (
    <div className={`cockpit-verdict ${latest.accepted ? "is-accepted" : "is-rejected"}`}>
      <div className="cockpit-verdict__headline">
        <strong>
          <span aria-hidden>{latest.accepted ? "✓" : "✗"}</span>{" "}
          {latest.accepted ? "ACCEPTED" : "REJECTED"}
        </strong>
        {/* The gate that fired is the headline of a rejection, not a detail of
            it. It used to be findable only by scanning twelve rows for the red
            one, which is colour doing the work of a word — and on the reported
            screenshot the word it was doing the work of was overlapped by the
            cell before it. Named here, in the same line as the verdict. */}
        {blocked.length ? (
          <strong className="cockpit-verdict__gate">blocked by {blocked.join(", ")}</strong>
        ) : null}
        {decisions.length > 1 ? (
          <span className="muted">{burstAccepted} of {decisions.length} accepted</span>
        ) : null}
        {latest.latency_ms != null ? (
          // Counting up to a sub-millisecond figure is the honest flex. The
          // wire unit is ms and formatDuration picks the rung the magnitude
          // earns — a 0.219ms decision prints as 219 µs. This is the DECISION
          // plane; the compiled core's ns and the network's ms are different
          // measurements and are never converted into one another.
          <span className="muted">
            decided in <NumberTicker value={latest.latency_ms} format={(v) => formatDuration(v, "ms")} />
          </span>
        ) : null}
      </div>

      {latest.reason ? <p>{latest.reason}</p> : null}

      {latest.fill ? (
        <p className="muted">
          Filled {fmt(latest.fill.quantity, 6)} @ {usd(latest.fill.price, 2)} on {latest.fill.venue};
          slippage {fmt(latest.fill.slippage_bps, 1)} bps, fee {usd(latest.fill.fee_usd, 2)}
          {latest.order_type === "LIMIT"
            // A marketable limit crosses the spread and pays for it; one that
            // rests is filled by someone crossing to reach it and takes its
            // own price. Naming which happened is the difference between a
            // cost the desk paid and one it collected.
            ? <>; marketable limit — crossed the spread at route VWAP</>
            : null}
        </p>
      ) : null}

      {latest.checks?.length ? (
        <div className="table-wrap" tabIndex={0}>
          {/* Keyed per decision so every submit replays the assembly of the
              gate vector — and only a submit: re-renders and resizes leave
              the settled rows alone. The stagger delay caps at 480ms so a
              gate vector never makes a reader wait on the tail. */}
          <table className="cockpit-gates" key={sequence}>
            <caption className="sr-only">
              Pre-trade gate results, in the order the gateway evaluated them
            </caption>
            <thead>
              <tr>
                <th scope="col">Gate</th>
                <th scope="col" className="cockpit-gates__state">Result</th>
                <th scope="col">Observed</th>
                <th scope="col" className="cockpit-gates__limit">Limit</th>
              </tr>
            </thead>
            <tbody>
              {latest.checks.map((check, index) => {
                const reading = readGate(check.detail);
                return (
                  <tr
                    key={check.name}
                    className={`stagger-reveal ${check.passed ? "is-pass" : "is-fail"}`}
                    style={{ "--stagger-i": Math.min(index, 12) } as CSSProperties}
                  >
                    {/* The gate name is the row's identity, so it is the row
                        header and it never wraps or clips: a truncated
                        `symbol_concentr…` is a gate a reader cannot look up. */}
                    <th scope="row">{check.name}</th>
                    <td className="cockpit-gates__state">
                      <span className="cockpit-gates__mark" aria-hidden>{check.passed ? "✓" : "✗"}</span>{" "}
                      {check.passed ? "PASS" : "FAIL"}
                    </td>
                    {reading.observed !== null ? (
                      <>
                        <td>{reading.observed}</td>
                        <td className="cockpit-gates__limit">
                          <span className="muted">vs </span>{reading.limit}
                        </td>
                      </>
                    ) : (
                      /* A statement, not a measurement, so it spans the two
                         measurement columns rather than putting a dash in each
                         — twelve gates would otherwise show a wall of dashes
                         where seven of them simply have nothing to compare.
                         It wraps inside its own column and is never clipped:
                         nothing here is recoverable from a tooltip a touch
                         device cannot open. */
                      <td className="cockpit-gates__prose" colSpan={2}>
                        {reading.prose ?? (
                          // Not a zero, not a blank. The gateway sends a detail
                          // with every gate it evaluates, so a missing one is a
                          // payload this component cannot explain — and it says
                          // exactly that instead of implying an empty result.
                          <span className="muted">— no detail recorded for this gate</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        // An absent vector is reported, never hidden. A decision with no checks
        // is a decision nobody can audit, and a panel that quietly renders the
        // headline alone reads as though the gates all passed.
        <p className="muted">
          This decision arrived without a check vector, so no gate can be shown here. The blotter
          holds what the gateway recorded.
        </p>
      )}
    </div>
  );
}
