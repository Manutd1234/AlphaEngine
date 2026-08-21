import { bandImbalance, depthUsd, depthWithinBps } from "./book-maths";
import { buildTcaReport, findDislocation } from "./report";
import { ExecutionEstimate, Level, RoutingLeg, Side, VenueBook } from "./types";

// --------------------------------------------------------------------------- //
// Fill tolerance — the mirror of `FILL_TOLERANCE` in modules/tca_engine.py
// --------------------------------------------------------------------------- //
/**
 * A ladder walk reaches the requested notional by subtracting one level at a
 * time, so the total lands a few ULPs either side of the request rather than
 * exactly on it. Deciding `fillable` with a bare `>=` therefore reports "this
 * book cannot absorb the order" for orders the book demonstrably absorbs: the
 * gateway rejected a SELL of 99.95002498750625 at a limit of 101 with "only
 * $10,095 of $10,095 routable" — the two figures identical to the dollar —
 * while the same order at a quantity of exactly 99.95 went through.
 *
 * The tolerance is *relative* because this engine prices instruments from cents
 * to tens of thousands. A fixed dollar epsilon is wrong at one end or the other:
 * one loose enough to cover accumulation drift on a $50M block would swallow a
 * complete miss on a $2 order, and one tight enough for the $2 order rejects the
 * block outright. That is not hypothetical — the absolute `1e-6` this replaced
 * called a $10,000 order fully filled when it was half a thousandth of a cent
 * short, and called a $1.0000005 order fully filled against $1.00 of depth.
 * 1e-9 of the request sits several orders of magnitude above the drift even a
 * thousand-level ladder can accumulate (~1e-13 relative) and still forgives only
 * a single cent on a $10M order.
 *
 * The direction of the error matters more than its size. `fillable` is a
 * pre-trade risk gate, so a false *accept* releases an order into a book that
 * cannot fill it, whereas a false *reject* is a cosmetic annoyance. This
 * tolerance is therefore sized to absorb arithmetic noise and nothing else — it
 * must never be widened far enough to hide a real partial fill, and no caller
 * may substitute the requested notional for the measured one to make it pass.
 *
 * The literal has to stay equal to the Python one. Two engines answering the
 * same question about the same book with different boundaries is worse than
 * either boundary alone: the portal says routable, the gateway refuses the
 * order, and nothing in either log explains the disagreement. `venues-fill-tolerance.test.ts`
 * reads both files and fails if the two literals drift.
 */
export const FILL_TOLERANCE = 1e-9;

/**
 * Did a walk that measured `filled` actually cover `requested`?
 *
 * `filled` must be the honest measured figure. Clamping it to `requested`
 * upstream would make this function a tautology and disarm the gate.
 */
export function absorbs(filled: number, requested: number): boolean {
  if (requested <= 0) return true;
  return filled >= requested - requested * FILL_TOLERANCE;
}

/**
 * Residual below which a walk is finished rather than one level short.
 *
 * Same tolerance, applied to the loop exit: without it a sub-ULP remainder
 * consumes an extra level, inflating `levelsConsumed` and reporting a
 * `worstPrice` (or, in the router, an extra venue leg) the order never actually
 * reaches. The Python-private underscore is kept on the port so the two files
 * diff cleanly; nothing outside this module may need it.
 */
function _dust(targetNotional: number): number {
  return Math.max(targetNotional, 0) * FILL_TOLERANCE;
}

/*
 * Everything else in this file that compares against zero was audited against
 * the tolerance above and deliberately left exact, so the next reader does not
 * have to re-derive it:
 *
 *  - `take <= 0`, `filledQty > 0`, `totalQty <= 0`, `b + a > 0`, `mid > 0` are
 *    presence and divide-by-zero guards. They ask "is there anything here at
 *    all", not "is this close enough to what was asked", so there is no request
 *    for a tolerance to be relative *to*, and a tolerance would let a negative
 *    or absent level through the very guard that exists to stop it.
 *  - `depthWithinBps` and `bandImbalance` measure resting notional inside a
 *    price band. Nothing is being compared to a target, so the fill tolerance
 *    has no meaning there; the band edge itself is an exact price bound on
 *    purpose, because "within 10 bps" has to mean the same thing on every venue.
 *  - `findDislocation`'s `bid <= ask` stays a strict cross test. Loosening it
 *    would manufacture an arbitrage out of a merely touching book, which is the
 *    one error in this file that costs real money.
 *  - `buildTcaReport` makes no epsilon comparison of its own. It consumes the
 *    `fillable` verdicts decided here, which is exactly why they are decided in
 *    one place.
 */

/**
 * Walk a ladder for `targetNotional` USD. A BUY consumes asks.
 *
 * Returns the volume-weighted average price actually achievable and the
 * slippage against mid in basis points — the number that decides whether a
 * signal's edge survives being executed.
 */
export function walkBook(
  levels: Level[],
  side: Side,
  targetNotional: number,
  mid: number | null,
  venue = "MERGED",
): ExecutionEstimate {
  let remaining = targetNotional;
  let filledNotional = 0;
  let filledQty = 0;
  let consumed = 0;
  let worst: number | null = null;
  const dust = _dust(targetNotional);

  for (const [price, size] of levels) {
    if (remaining <= dust) break;
    const take = Math.min(price * size, remaining);
    if (take <= 0) continue;
    filledNotional += take;
    filledQty += take / price;
    remaining -= take;
    consumed += 1;
    worst = price;
  }

  const vwap = filledQty > 0 ? filledNotional / filledQty : null;
  let slippageBps: number | null = null;
  if (vwap && mid) {
    slippageBps = side === "BUY" ? ((vwap - mid) / mid) * 1e4 : ((mid - vwap) / mid) * 1e4;
  }

  return {
    venue,
    // Judged on what the walk measured, not on the residual counter: the two
    // carry the same drift, and reading the measurement directly is what keeps
    // the reported `filledNotional` and the verdict in step.
    fillable: absorbs(filledNotional, targetNotional),
    // Rounded for display only, and only after the verdict is decided — a
    // partial fill still reports the depth it truly found.
    filledNotional: Math.round(filledNotional * 100) / 100,
    filledQty,
    vwap,
    mid,
    slippageBps,
    levelsConsumed: consumed,
    worstPrice: worst,
  };
}

/**
 * Depth-weighted mid across venues.
 *
 * A single venue's mid is unstable when that venue is thin; weighting by
 * top-of-book depth gives a reference price that does not jump when one book
 * momentarily crosses.
 */
export function consolidatedMid(books: VenueBook[]): number | null {
  let num = 0;
  let den = 0;
  for (const b of books) {
    if (!b.mid) continue;
    const w = Math.max(1, depthUsd(b.bids, 5) + depthUsd(b.asks, 5));
    num += b.mid * w;
    den += w;
  }
  return den ? num / den : null;
}

/**
 * What-if constraints for the routing probe. Client-side presentation aids
 * with NO Python counterpart: they narrow or annotate the same maths, they
 * route nothing, and the gateway's pre-trade gates stay the only authority
 * on what may be sent.
 */
export interface SmartRouteOptions {
  /** Cap on BLENDED slippage vs `mid`, in bps. Needs a resolvable mid. */
  maxSlippageBps?: number;
  /** Include-list of venue names. Omitted = every book routes; [] = none. */
  venues?: string[];
  /** Reference price for the cap. Defaults to consolidatedMid(books). */
  mid?: number | null;
}

export interface SmartRouteResult {
  legs: RoutingLeg[];
  vwap: number | null;
  /**
   * What the walk measured, rounded for display only — deliberately NOT the sum
   * of the rounded legs, which loses up to half a cent each.
   */
  filledNotional: number;
  /** Present only when the measured walk did not `absorbs` the request. */
  cappedBy?: "slippage" | "liquidity";
}

/**
 * Greedy price-time allocation across the *merged* ladder.
 *
 * The consolidated book is every venue's levels sorted by price; walking it
 * yields the lowest achievable blended VWAP, and the per-venue split of that
 * walk is the routing instruction.
 *
 * With no `opts` the walk is the historical one, byte for byte — the Python
 * parity claim covers exactly that path. The slippage cap answers "what is
 * the largest notional routable with blended slippage ≤ cap": a boundary
 * level is partially consumed via the closed form (BUY, running notional N
 * and qty Q against bound vmax): t = p·(vmax·Q − N)/(p − vmax). A cap with
 * no resolvable mid routes nothing — enforcing a cap without a reference
 * price would be a lie.
 */
export function smartRoute(
  books: VenueBook[],
  side: Side,
  notional: number,
  opts?: SmartRouteOptions,
): SmartRouteResult {
  const usable = opts?.venues ? books.filter((b) => opts.venues!.includes(b.venue)) : books;

  const capActive = Number.isFinite(opts?.maxSlippageBps);
  let bound: number | null = null;
  if (capActive) {
    const mid = opts?.mid ?? consolidatedMid(usable);
    if (mid == null) return { legs: [], vwap: null, filledNotional: 0, cappedBy: "slippage" };
    const capFrac = (opts!.maxSlippageBps as number) / 1e4;
    bound = side === "BUY" ? mid * (1 + capFrac) : mid * (1 - capFrac);
  }

  const merged: Array<[number, number, string]> = [];
  for (const b of usable) {
    const levels = side === "BUY" ? b.asks : b.bids;
    for (const [p, q] of levels) merged.push([p, q, b.venue]);
  }
  merged.sort((a, z) => (side === "BUY" ? a[0] - z[0] : z[0] - a[0]));

  let remaining = notional;
  let runN = 0;
  let runQ = 0;
  let cappedBySlippage = false;
  const dust = _dust(notional);
  const perVenue = new Map<string, { notional: number; qty: number }>();
  for (const [price, size, venue] of merged) {
    if (remaining <= dust) break;
    let take = Math.min(price * size, remaining);
    if (bound != null) {
      const inside = side === "BUY" ? price <= bound : price >= bound;
      if (!inside) {
        // Partial take up to where the blend meets the bound; the ladder is
        // sorted, so every later level is worse and the walk ends here.
        const t = side === "BUY"
          ? (price * (bound * runQ - runN)) / (price - bound)
          : (price * (runN - bound * runQ)) / (bound - price);
        const allowed = Math.max(0, t);
        if (allowed < take) {
          take = allowed;
          cappedBySlippage = true;
        }
      }
    }
    if (take > 0) {
      const slot = perVenue.get(venue) ?? { notional: 0, qty: 0 };
      slot.notional += take;
      slot.qty += take / price;
      perVenue.set(venue, slot);
      runN += take;
      runQ += take / price;
      remaining -= take;
    }
    if (cappedBySlippage) break;
  }

  const totalNotional = [...perVenue.values()].reduce((a, v) => a + v.notional, 0);
  const totalQty = [...perVenue.values()].reduce((a, v) => a + v.qty, 0);
  // Decided on the unrounded total, the same rule `walkBook` uses and for the
  // same reason: the legs below quantise to cents because they are an
  // instruction a human reads and a venue receives, and summing rounded legs
  // loses up to half a cent *per leg* against a request that is not itself on a
  // cent boundary. Judging the cap on that sum is what made the gateway report
  // "$10,095 of $10,095" as a shortfall.
  const cappedBy: SmartRouteResult["cappedBy"] = absorbs(totalNotional, notional)
    ? undefined
    : cappedBySlippage ? "slippage" : "liquidity";
  if (totalQty <= 0) {
    return { legs: [], vwap: null, filledNotional: 0, ...(cappedBy ? { cappedBy } : {}) };
  }

  const legs = [...perVenue.entries()]
    .sort((a, z) => z[1].notional - a[1].notional)
    .map(([venue, v]) => ({
      venue,
      notional: Math.round(v.notional * 100) / 100,
      qty: v.qty,
      vwap: v.notional / v.qty,
      sharePct: Math.round((v.notional / totalNotional) * 10000) / 100,
    }));

  return {
    legs,
    vwap: totalNotional / totalQty,
    filledNotional: Math.round(totalNotional * 100) / 100,
    ...(cappedBy ? { cappedBy } : {}),
  };
}

export interface PassiveQuote {
  venue: string;
  /** The touch you would join: best bid for a BUY, best ask for a SELL. */
  price: number;
  /** Half-spread earned vs mid IF the resting order fills. Positive = earned. */
  spreadCaptureBps: number | null;
}

/**
 * The passive alternative to crossing: join the touch and wait. No queue
 * position, no adverse-selection model, no fill guarantee — this is a price
 * "if filled", full stop, and the UI must say so beside it.
 */
export function passiveQuote(
  books: VenueBook[],
  side: Side,
  mid: number | null,
): PassiveQuote | null {
  let best: { venue: string; price: number } | null = null;
  for (const b of books) {
    const touch = side === "BUY" ? b.bids[0]?.[0] : b.asks[0]?.[0];
    if (touch == null) continue;
    if (!best || (side === "BUY" ? touch > best.price : touch < best.price)) {
      best = { venue: b.venue, price: touch };
    }
  }
  if (!best) return null;
  const spreadCaptureBps = mid
    ? (side === "BUY" ? ((mid - best.price) / mid) : ((best.price - mid) / mid)) * 1e4
    : null;
  return { venue: best.venue, price: best.price, spreadCaptureBps };
}
