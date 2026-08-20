import { consolidatedMid, smartRoute, walkBook } from "./fill-tolerance";
import { Dislocation, ExecutionEstimate, Side, TcaReport, VenueBook } from "./types";

// --------------------------------------------------------------------------- //
// Report
// --------------------------------------------------------------------------- //
/**
 * Is the consolidated book crossed?
 *
 * The routing engine already asks which single venue fills a given order best.
 * This asks a different question the same two books can answer for free: is one
 * venue's *bid* above another's *ask* right now — a price that cannot persist,
 * because it pays to buy on one and sell on the other simultaneously.
 *
 * Three things this refuses to do, each because the naive version misleads:
 *
 *  - **It will not call a single venue's own spread a dislocation.** If the same
 *    venue holds both the high bid and the low ask, that is a bid-ask spread,
 *    which every book has and none of which is free money.
 *  - **It sizes to `min(bid size, ask size)`, never the larger or the sum.**
 *    Both legs have to fill for the edge to be real, so the tradeable size is
 *    whichever leg runs out first.
 *  - **It reports gross, and says so.** Two taker fees and the transfer between
 *    venues routinely exceed a few basis points of edge. Presenting a gross
 *    number as profit is the single most common way this analysis lies.
 *
 * Mirrors `quant_risk.find_dislocation` in the Python gateway.
 */
export function findDislocation(books: VenueBook[], symbol: string): Dislocation | null {
  const live = books.filter((b) => b.ok && b.bestBid !== null && b.bestAsk !== null);
  if (live.length < 2) return null; // one venue cannot cross itself

  const topBid = live.reduce((a, b) => (b.bestBid! > a.bestBid! ? b : a));
  const topAsk = live.reduce((a, b) => (b.bestAsk! < a.bestAsk! ? b : a));

  const base = {
    symbol: symbol.toUpperCase(),
    buyVenue: null,
    sellVenue: null,
    buyPrice: null,
    sellPrice: null,
    edgeUsdPerUnit: 0,
    edgeBps: 0,
    executableSize: 0,
    executableNotional: 0,
    grossEdgeUsd: 0,
  };

  if (topBid.venue === topAsk.venue) {
    return {
      ...base,
      crossed: false,
      note: `${topBid.venue} holds both sides of the touch — that is its own spread, not a cross-venue dislocation.`,
    };
  }

  const bid = topBid.bestBid!;
  const ask = topAsk.bestAsk!;
  const mid = (bid + ask) / 2;

  if (bid <= ask || mid <= 0) {
    return {
      ...base,
      crossed: false,
      note: `Touch spans ${topAsk.venue} (ask) and ${topBid.venue} (bid) without crossing — the normal state of a working market.`,
    };
  }

  // Both legs must fill, so the size is whichever runs out first.
  const askSize = topAsk.asks[0]?.[1] ?? 0;
  const bidSize = topBid.bids[0]?.[1] ?? 0;
  const size = Math.min(askSize, bidSize);
  const edge = bid - ask;

  return {
    symbol: symbol.toUpperCase(),
    crossed: true,
    buyVenue: topAsk.venue,
    sellVenue: topBid.venue,
    buyPrice: ask,
    sellPrice: bid,
    edgeUsdPerUnit: edge,
    edgeBps: (edge / mid) * 1e4,
    executableSize: size,
    executableNotional: size * mid,
    grossEdgeUsd: edge * size,
    note: `Buy ${topAsk.venue} at ${ask}, sell ${topBid.venue} at ${bid}. Gross of fees — two taker legs and the transfer routinely cost more than this.`,
  };
}

export function buildTcaReport(
  symbol: string,
  side: Side,
  notional: number,
  books: VenueBook[],
): TcaReport {
  const live = books.filter((b) => b.ok && b.mid !== null);
  const cmid = consolidatedMid(live);

  const perVenue = live.map((b) =>
    walkBook(side === "BUY" ? b.asks : b.bids, side, notional, b.mid, b.venue),
  );
  const { legs, vwap } = smartRoute(live, side, notional);

  let blendedSlip: number | null = null;
  if (vwap && cmid) {
    blendedSlip = side === "BUY" ? ((vwap - cmid) / cmid) * 1e4 : ((cmid - vwap) / cmid) * 1e4;
  }

  const fillable = perVenue.filter((e) => e.fillable && e.vwap !== null);
  let bestSingleVenue: string | null = null;
  let savingBps: number | null = null;
  let savingUsd: number | null = null;

  if (fillable.length) {
    // Ties keep the FIRST element, matching Python's min()/max(). Written as
    // `a.vwap < b.vwap ? a : b` the later element wins a tie, so the two
    // implementations named different venues on the ~20% of probes that tie.
    const cmp = (a: ExecutionEstimate, b: ExecutionEstimate) =>
      side === "BUY" ? (b.vwap! < a.vwap! ? b : a) : b.vwap! > a.vwap! ? b : a;
    const inv = (a: ExecutionEstimate, b: ExecutionEstimate) =>
      side === "BUY" ? (b.vwap! > a.vwap! ? b : a) : b.vwap! < a.vwap! ? b : a;
    const best = fillable.reduce(cmp);
    const worst = fillable.reduce(inv);
    bestSingleVenue = best.venue;
    if (vwap && worst.vwap) {
      const diff = side === "BUY" ? worst.vwap - vwap : vwap - worst.vwap;
      savingBps = (diff / worst.vwap) * 1e4;
      savingUsd = (diff / worst.vwap) * notional;
    }
  }

  return {
    symbol: symbol.toUpperCase(),
    side,
    targetNotional: notional,
    generatedAt: new Date().toISOString(),
    consolidatedMid: cmid,
    perVenue,
    bestSingleVenue,
    smartRoute: legs,
    smartRouteVwap: vwap,
    smartRouteSlippageBps: blendedSlip,
    savingVsWorstBps: savingBps,
    savingVsWorstUsd: savingUsd,
    venuesOnline: live.map((b) => b.venue),
    dislocation: findDislocation(books, symbol),
  };
}
