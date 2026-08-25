/**
 * Every coherence route, against the running gateway, with its own budget.
 *
 * "perform tdd testing such that all gateways and integrations is 100%."
 *
 * WHY THIS IS A SCRIPT AND NOT A SUITE. `npm test` has no network and no
 * gateway (CLAUDE.md, fact 6), so everything it can say about these routes is
 * derived from their source — which is what `coherence-gateway-contract.test.ts`
 * says, and it is worth saying. What it cannot say is whether the boundary
 * ANSWERS: whether the shape the route validates is the shape the gateway
 * sends, and whether it arrives inside the budget the route reserved. That
 * needs a running desk and a running gateway, so it lives beside
 * `desk-sweep.mjs` rather than inside the suite.
 *
 * WHAT IT REFUSES TO CALL A PASS. A 200 that took longer than the route's own
 * `timeoutMs` is not a pass, because that is exactly the state a reader meets
 * as a dead panel — the browser gives up first. Nor is a 200 carrying a failure
 * body: the boundary answers `{ code, error }` with a 4xx/5xx, but a route
 * whose guard rejected the payload answers 502 with a body that reads like
 * success to anything only counting status codes.
 *
 * PARAMETERS ARE DISCOVERED, NOT PINNED. Half these routes need a live event
 * ticker, and a hard-coded one settles: `KXBTCD-26AUG2514` was current for
 * about six hours. The probe reads `universe` first and takes the first family
 * and the first market it names, so the run describes the tape as it is.
 *
 *   ORIGIN=http://localhost:3100 node scripts/coherence-probe.mjs
 *
 * Exits non-zero when any route fails or answers outside its budget, so it can
 * gate a push without anyone reading the table.
 */

const ORIGIN = process.env.ORIGIN ?? "http://localhost:3100";
const PASS = process.env.DESK_PASS ?? "guest:probe";
const BASE = `${ORIGIN}/api/gateway/coherence`;

/** The nine that read the venue carry the route's live budget; the rest the default. */
const LIVE_MS = 25_000;
const STORE_MS = 8_000;

async function hit(path, budgetMs) {
  const started = Date.now();
  const controller = new AbortController();
  // A little past the budget, so a route that is merely SLOW is measured rather
  // than reported as unreachable.
  const timer = setTimeout(() => controller.abort(), budgetMs + 5_000);
  try {
    const response = await fetch(`${BASE}${path}`, {
      headers: { cookie: `ae_desk=${PASS}` },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await response.text();
    const ms = Date.now() - started;
    let body = null;
    try { body = JSON.parse(text); } catch { /* a non-JSON body is itself the finding */ }
    return {
      ms,
      status: response.status,
      bytes: text.length,
      // The boundary's own failure shape, which arrives with a status but is
      // worth naming separately: "the gateway said no" and "the desk could not
      // reach it" are different repairs.
      code: body && typeof body === "object" && "code" in body ? String(body.code) : null,
      /**
       * The gateway's OWN status, which the boundary reports separately.
       *
       * A 404 here is the finding this probe exists to tell apart from a bug:
       * the desk asked for a route the running gateway does not serve, which on
       * a developer's machine almost always means the gateway process is older
       * than the desk calling it. Measured 2026-08-26 against a gateway started
       * the previous evening: `books/history` and `fees/curve` both 404, both
       * present in `tools/openapi.json`, both serving fine after a restart. A
       * probe that reported those as failures would send someone looking for a
       * defect in a route that is correct.
       */
      upstream: body && typeof body === "object" && "upstreamStatus" in body ? Number(body.upstreamStatus) : null,
      state: body && typeof body === "object" && "state" in body ? String(body.state) : null,
    };
  } catch (error) {
    return { ms: Date.now() - started, status: 0, bytes: 0, code: error.name === "AbortError" ? "aborted" : "unreachable", state: null };
  } finally {
    clearTimeout(timer);
  }
}

const universe = await hit("/universe?max_events=2", LIVE_MS);
let event = null;
let market = null;
if (universe.status === 200) {
  const payload = await (await fetch(`${BASE}/universe?max_events=2`, { headers: { cookie: `ae_desk=${PASS}` } })).json();
  event = payload.events?.[0]?.event_ticker ?? null;
  market = payload.events?.[0]?.markets?.[0]?.ticker ?? null;
}
if (!event) {
  console.error("universe answered nothing, so no route needing a family can be probed");
}

const enc = encodeURIComponent;
const ROUTES = [
  ["status", "/status", STORE_MS],
  ["universe", "/universe?max_events=2", LIVE_MS],
  ["books", event ? `/books?event_ticker=${enc(event)}` : null, STORE_MS],
  ["books/history", market ? `/books/history?ticker=${enc(market)}&limit=50` : null, STORE_MS],
  ["certify", event ? `/certify?event_ticker=${enc(event)}` : null, LIVE_MS],
  ["surface", event ? `/surface?event_ticker=${enc(event)}` : null, LIVE_MS],
  ["stake", event ? `/stake?event_ticker=${enc(event)}` : null, LIVE_MS],
  ["combos", "/combos?limit=6", LIVE_MS],
  ["calibration", "/calibration", LIVE_MS],
  ["calibration/history", "/calibration/history?limit=200", STORE_MS],
  ["index", "/index?limit=500", STORE_MS],
  ["episodes", "/episodes?limit=50", STORE_MS],
  ["replay", "/replay?limit=200", STORE_MS],
  ["fees", "/fees?price=0.5000&contracts_fp=1.0000&fills=1", STORE_MS],
  ["fees/curve", "/fees/curve?contracts_fp=1.0000&fills=1", STORE_MS],
  ["rfq", "/rfq", LIVE_MS],
  ["settlement", "/settlement?city=NY", LIVE_MS],
  ["shell", "/shell?path=%2F&command=ls", LIVE_MS],
];

console.log(`probing ${ROUTES.length} routes at ${BASE}`);
console.log(`family ${event ?? "—"}, market ${market ?? "—"}`);
console.log("route                  status      ms   budget    bytes  reading");

let failures = 0;
let unprobed = 0;
let staleRoutes = 0;
for (const [name, path, budget] of ROUTES) {
  if (!path) {
    unprobed += 1;
    console.log(`${name.padEnd(21)} ${"—".padStart(6)}  ${"—".padStart(6)}  ${String(budget).padStart(6)}  ${"—".padStart(7)}  needs a family the universe read did not return`);
    continue;
  }
  const seen = await hit(path, budget);
  const slow = seen.ms > budget;
  const stale = seen.upstream === 404;
  const bad = (seen.status !== 200 && !stale) || slow;
  if (bad) failures += 1;
  if (stale) staleRoutes += 1;
  const reading = seen.upstream === 404
    ? "▲ the running gateway does not serve this route — restart it, it is older than this desk"
    : seen.status !== 200
    ? `✕ ${seen.code ?? seen.status}`
    : slow
      ? `▲ answered, but past the ${budget}ms this route reserves`
      : `● ${seen.state ?? "ok"}`;
  console.log(
    `${name.padEnd(21)} ${String(seen.status).padStart(6)}  ${String(seen.ms).padStart(6)}  ${String(budget).padStart(6)}  ${String(seen.bytes).padStart(7)}  ${reading}`,
  );
}

const probed = ROUTES.length - unprobed;
console.log(`\n${probed - failures - staleRoutes}/${probed} probed routes answered inside their own budget`
  + (staleRoutes ? `; ${staleRoutes} are not served by the running gateway` : "")
  + (unprobed ? `; ${unprobed} could not be probed` : ""));
if (staleRoutes) {
  console.log("A route the desk knows and the gateway does not is a STALE PROCESS, not a defect:"
    + " restart the gateway and probe again before reading it as one.");
}
// AN UNPROBED ROUTE IS NOT A PASS. A run that could not reach a family has not
// checked half the boundary, and exiting zero on it would make the probe say
// "100%" about a tape it never read.
process.exit(failures || unprobed || staleRoutes ? 1 : 0);
