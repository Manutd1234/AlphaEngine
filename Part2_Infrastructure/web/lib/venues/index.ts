/**
 * Live market data — venue adapters and execution-cost maths.
 * ===========================================================
 *
 * A TypeScript port of Module A from the Python gateway
 * (`Part2_Infrastructure/modules/tca_engine.py`), reduced to what a serverless
 * function can actually do.
 *
 * What lives where, and why
 * -------------------------
 * A serverless function cannot hold a WebSocket subscription open between
 * invocations, so the *streaming* L2 book stays on the always-on gateway. What a
 * function does well is a **snapshot**: fetch each venue's REST order book,
 * merge the ladders, and price a target order across them. That is what these
 * routes serve, and it is genuinely live — every call hits the exchange.
 *
 * For tick-by-tick updates the browser connects straight to the exchanges'
 * public WebSocket feeds (see `lib/livebook.ts`), which needs no backend at all.
 *
 * The arithmetic is identical to the gateway's, so a slippage number from this
 * portal and one from the gateway agree.
 *
 * The what-if extras — `smartRoute`'s optional `opts` (venue include-list,
 * blended-slippage cap) and `passiveQuote` — are client-side presentation aids
 * with no Python counterpart. They narrow or annotate the same maths; they
 * route nothing, and the gateway's pre-trade gates remain the only authority
 * on what may be sent. With `opts` omitted the walk is the parity path.
 */

export { SYMBOLS } from "./types";
export type { Dislocation, ExecutionEstimate, Level, RoutingLeg, Side, TcaReport, VenueBook, VenueName } from "./types";
export { DEPTH_BAND_BPS, bandImbalance, depthUsd, depthWithinBps, spreadBps } from "./book-maths";
export { FILL_TOLERANCE, absorbs, consolidatedMid, passiveQuote, smartRoute, walkBook } from "./fill-tolerance";
export type { PassiveQuote, SmartRouteOptions, SmartRouteResult } from "./fill-tolerance";
export { fetchBinanceBook, fetchBinanceTickers, fetchBooks, fetchBybitBook } from "./adapters";
export type { Ticker } from "./adapters";
export { buildTcaReport, findDislocation } from "./report";
