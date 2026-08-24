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
 * Two events per series, not four. Each event costs two round trips even read
 * concurrently, and `callGateway` gives up at eight seconds — four took 10.1s
 * before the reads were parallelised and 6.4s after, which is inside the
 * deadline but not comfortably. Two answers in about four and a half.
 */
export const universeRoute = (maxEvents = 2) => `${COHERENCE}/universe?max_events=${maxEvents}`;

export const booksRoute = () => `${COHERENCE}/books`;

export const certifyRoute = (eventTicker: string) =>
  `${COHERENCE}/certify?event_ticker=${encodeURIComponent(eventTicker)}`;

export const surfaceRoute = (eventTicker: string) =>
  `${COHERENCE}/surface?event_ticker=${encodeURIComponent(eventTicker)}`;

export const stakeRoute = (eventTicker: string) =>
  `${COHERENCE}/stake?event_ticker=${encodeURIComponent(eventTicker)}`;

export const feesRoute = (price: string | number, contracts: string | number, fills: string | number) =>
  `${COHERENCE}/fees?price=${price}&contracts_fp=${contracts}&fills=${fills}`;

/** The largest read on the tab, and the reason Ablation is gated on its view. */
export const replayRoute = (limit = 20_000) => `${COHERENCE}/replay?limit=${limit}`;

export const indexRoute = (limit = 2_000) => `${COHERENCE}/index?limit=${limit}`;

export const combosRoute = (limit = 6) => `${COHERENCE}/combos?limit=${limit}`;

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

export const episodesRoute = (limit = 500) => `${COHERENCE}/episodes?limit=${limit}`;

export const absorptionRoute = (limit = 400) => `${DIFFUSION}/absorption?limit=${limit}`;

export const findingsRoute = () => `${DIFFUSION}/findings`;
