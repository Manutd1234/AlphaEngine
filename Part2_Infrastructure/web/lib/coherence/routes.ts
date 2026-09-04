/**
 * Every gateway URL the Kalshi engine reads, built in one place.
 *
 * Written for the warm plan and kept for the reason the warm plan exposed. A
 * section can now be read before anyone opens it, which means the URL exists
 * twice — once where the pane asks for it, once where the rail warms it — and
 * two copies of a query string are two things to keep in agreement. The first
 * time they disagree the warm silently fills a cache nobody reads and the lag
 * comes back, with every test still green.
 *
 * So the panes call these too. `tests/coherence-routes.test.ts` holds the
 * other half: no component under `components/coherence/` may spell a
 * `/api/gateway/…` path itself.
 *
 * The limits are arguments, not defaults, wherever a caller has a reason to
 * choose — and constants here wherever the number is a property of the read
 * rather than of the reader.
 */

const COHERENCE = "/api/gateway/coherence";
const DIFFUSION = "/api/gateway/diffusion";

/** The engine's own health, the one read that is not gated on a section. */
export const statusRoute = () => `${COHERENCE}/status`;

/**
 * The watched families.
 *
 * Seventy-five open event families in broad-live mode. The gateway discovers
 * them in one nested listing and hydrates books in 100-ticker bulk reads; the
 * recorder and warmer store this exact shape for every tab.
 */
export const universeRoute = (maxEvents = 6, familyLimit = 75) =>
  `${COHERENCE}/universe?max_events=${maxEvents}&family_limit=${familyLimit}`;

export const booksRoute = () => `${COHERENCE}/books`;

/**
 * One market's recorded quotes, oldest first.
 *
 * The tape rather than the venue: `book_snapshots` has a row per watched market
 * per recorder poll and nothing on the desk had ever read it as a series. So
 * this is the cheap read of the two — no exchange call, no signing, just DuckDB
 * — and it is the only route on the tab that can answer what a market has BEEN
 * quoted at rather than what it is quoted at now.
 *
 * Five thousand retained observations expose the long tape the recorder has
 * actually earned without manufacturing back-history. The API can return up to
 * twenty thousand; 5,000 keeps the browser response bounded while covering
 * days rather than a short inspection window at ordinary recorder cadences.
 */
export const booksHistoryRoute = (ticker: string, limit = 5_000) =>
  `${COHERENCE}/books/history?ticker=${encodeURIComponent(ticker)}&limit=${limit}`;

export const certifyRoute = (eventTicker: string) =>
  `${COHERENCE}/certify?event_ticker=${encodeURIComponent(eventTicker)}`;

export const surfaceRoute = (eventTicker: string) =>
  `${COHERENCE}/surface?event_ticker=${encodeURIComponent(eventTicker)}`;

export const stakeRoute = (eventTicker: string) =>
  `${COHERENCE}/stake?event_ticker=${encodeURIComponent(eventTicker)}`;

export const feesRoute = (price: string | number, contracts: string | number, fills: string | number) =>
  `${COHERENCE}/fees?price=${price}&contracts_fp=${contracts}&fills=${fills}`;

/**
 * The same fee at every price the venue quotes, for one size and fill count.
 *
 * A sibling of `feesRoute` rather than a flag on it: that one works a single
 * case through and this returns ninety-nine. It takes no price for the same
 * reason — the price is the axis.
 *
 * Pure arithmetic on the gateway, so it is the cheapest read on the tab: no
 * venue call, no tape, no signing. It exists because the alternative was
 * computing the curve in the browser, which would be a third implementation of
 * fee maths this codebase keeps in Python as its reference.
 */
export const feesCurveRoute = (contracts: string | number, fills: string | number) =>
  `${COHERENCE}/fees/curve?contracts_fp=${contracts}&fills=${fills}`;

/** The largest read on the tab, and the reason Ablation is gated on its view. */
export const replayRoute = (limit = 20_000) => `${COHERENCE}/replay?limit=${limit}`;

export const indexRoute = (limit = 2_000) => `${COHERENCE}/index?limit=${limit}`;

export const combosRoute = (limit = 6, ticker?: string | null) =>
  `${COHERENCE}/combos?limit=${limit}${ticker ? `&ticker=${encodeURIComponent(ticker)}` : ""}`;

export const calibrationRoute = () => `${COHERENCE}/calibration`;

/**
 * The settled score OVER TIME, which the snapshot above cannot answer.
 *
 * A sibling of `/calibration` rather than a flag on it: that one scores whatever
 * has settled and returns one moment, this one returns the recorded series. It
 * is also the cheaper of the two — no harvest, no venue call, just the tape.
 */
export const calibrationHistoryRoute = (limit = 2_000) =>
  `${COHERENCE}/calibration/history?limit=${limit}`;

export const settlementRoute = (city: string) => `${COHERENCE}/settlement?city=${city}`;

export const shellRoute = (path: string, command: "ls" | "cat") =>
  `${COHERENCE}/shell?path=${encodeURIComponent(path)}&command=${command}`;

/** The one signed private-channel call; it carries a 25-second budget. */
export const rfqRoute = () => `${COHERENCE}/rfq`;

export const episodesRoute = (limit = 5_000) => `${COHERENCE}/episodes?limit=${limit}`;

export const absorptionRoute = (limit = 600) => `${DIFFUSION}/absorption?limit=${limit}`;

export const findingsRoute = () => `${DIFFUSION}/findings`;

/**
 * The reads that go to the exchange rather than to a store, named once.
 *
 * WHY IT IS A LIST AND NOT A REGEX. `use-coherence.ts` chose the browser's
 * deadline with `/\/(universe|certify)/`, on the reasoning that those two are
 * the slow ones — true when it was written and false the moment a third route
 * was budgeted in seconds. NINE routes carry `timeoutMs: 25_000` on the server;
 * the browser gave two of them 28 seconds and the other seven nine.
 *
 * `combos` IS THE ONE THAT BIT. Aborted browser-side at 9s while the route was
 * still working inside its 25, the failure a reader saw came from the NEXT
 * poll joining the previous request's still-open promise — so the message named
 * 25000ms while the request that rendered it had waited five seconds, and the
 * whole thing described a poll the reader had already given up on.
 *
 * Two sides of one contract, so the contract is one list.
 * `coherence-gateway-contract.test.ts` asserts every route file whose name is
 * here declares the live budget, and every route file that declares it is here.
 */
export const LIVE_READS = [
  "calibration",
  "certify",
  "combos",
  "rfq",
  "settlement",
  "shell",
  "stake",
  "surface",
  "universe",
] as const;

/** Whether this desk URL is one of the reads that goes to the venue. */
export function isLiveRead(url: string): boolean {
  const path = url.split("?")[0];
  return LIVE_READS.some((name) => path.endsWith(`/${name}`));
}
