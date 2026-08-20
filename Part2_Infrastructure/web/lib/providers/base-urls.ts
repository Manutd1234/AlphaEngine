/**
 * The host each vendor is reached at when no `*_BASE_URL` override is set.
 *
 * Data, not behaviour, and lifted out of `runtime.ts` because that file is over
 * the size ceiling and a table of six constants is the cheapest thing in it to
 * move. Re-exported from `runtime.ts`, which is where every caller imports it
 * from today.
 */

/** Falls back to the vendor's documented host when no override is set. */
export const DEFAULT_BASE_URL: Record<string, string> = {
  alphavantage: "https://www.alphavantage.co",
  tiingo: "https://api.tiingo.com",
  // Polygon.io became Massive in Oct 2025; api.polygon.io still resolves, but
  // the new host is the one under active development.
  massive: "https://api.massive.com",
  fmp: "https://financialmodelingprep.com",
  firecrawl: "https://api.firecrawl.dev",
  // OpenBB is a Python provider runtime, not a shared public API. This points
  // at the independently deployed, stateless OpenBB_Service.
  openbb: "http://127.0.0.1:8010",
};
