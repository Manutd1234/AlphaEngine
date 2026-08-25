/**
 * Count what the desk asks the network for, and when.
 * ===================================================
 *
 * `tab-switch-measure.mjs` measures main-thread time and says so in its own
 * header: "not how many requests". Nothing measured that. The one figure the
 * latency budget quotes — "0-4 requests per switch with a single duplicate
 * across all eight" — was taken by hand, so nothing would catch it regressing,
 * and the two most expensive polling defects this codebase has hit (1,542
 * doomed requests in ten seconds from an idle guest tab; a poll running behind
 * a subtab nobody is reading) are both invisible to every other harness here.
 *
 * Two measurements:
 *
 *   per switch   requests issued in the 3s after each tab click, by route,
 *                with duplicates called out
 *   idle         requests issued over IDLE_MS with the desk sitting still,
 *                which is the number that goes wrong when a loop forgets
 *                `document.hidden` or drops its backoff
 *
 * Data-URL, blob and extension requests are ignored; only same-origin /api is
 * counted, because that is what costs a lambda invocation and a provider call.
 *
 * Usage (a PRODUCTION build — reactStrictMode double-invokes effects in dev,
 * which doubles exactly the number being measured):
 *
 *   npm run build && PORT=3100 npm run start
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
 *   node scripts/request-count-measure.mjs
 */
const CDP = "http://127.0.0.1:9222";
const ORIGIN = process.env.DESK_ORIGIN ?? "http://localhost:3100";
const IDLE_MS = Number(process.env.IDLE_MS ?? 60_000);
const SETTLE_MS = 3_000;

const TABS = ["overview", "research", "live", "portfolio", "risk", "data", "reliability", "developer", "markets", "coherence", "diffusion"];

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const i = ++id;
  pending.set(i, resolve);
  ws.send(JSON.stringify({ id: i, method, params }));
});

/** Every /api request seen since the last reset, in order. */
let seen = [];
await new Promise((resolve) => (ws.onopen = resolve));
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
    return;
  }
  if (message.method === "Network.requestWillBeSent") {
    const url = message.params?.request?.url ?? "";
    if (url.startsWith(ORIGIN) && url.includes("/api/")) {
      // Path AND query. Stripping the query counted the cockpit's
      // `/api/gateway/audit?feed=orders` and `?feed=events` as one route asked
      // for twice — two different questions reported as a duplicate. A
      // duplicate figure that cannot tell those apart is worse than none.
      seen.push(url.slice(ORIGIN.length));
    }
  }
};

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1720, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: `${ORIGIN}/dashboard#overview/loop` });
await new Promise((resolve) => setTimeout(resolve, 9_000));

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const click = (tab) => send("Runtime.evaluate", {
  expression: `document.querySelector('#tab-${tab}')?.click()`,
  awaitPromise: false,
});

/** Routes asked for more than once in one window — the duplicate figure. */
const duplicates = (routes) => {
  const counts = new Map();
  for (const route of routes) counts.set(route, (counts.get(route) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 1).map(([route, n]) => `${route} x${n}`);
};

/** Path only, for the readable per-route idle summary. */
const pathOf = (route) => route.split("?")[0];

console.log(`per switch (requests in ${SETTLE_MS / 1000}s after the click)\n`);
const perSwitch = [];
for (const tab of TABS) {
  seen = [];
  await click(tab);
  await wait(SETTLE_MS);
  const routes = [...seen];
  perSwitch.push({ tab, count: routes.length, dupes: duplicates(routes) });
  const dupe = duplicates(routes);
  console.log(
    `  ${tab.padEnd(12)} ${String(routes.length).padStart(3)}`
    + (dupe.length ? `   duplicated: ${dupe.join(", ")}` : ""),
  );
}
const worst = Math.max(...perSwitch.map((row) => row.count));
console.log(`\n  worst switch: ${worst} requests`);

console.log(`\nidle (${IDLE_MS / 1000}s, desk sitting still on Overview)\n`);
await click("overview");
await wait(SETTLE_MS);
seen = [];
await wait(IDLE_MS);
const idle = [...seen];
const byRoute = new Map();
for (const route of idle) {
  const key = pathOf(route);
  byRoute.set(key, (byRoute.get(key) ?? 0) + 1);
}
for (const [route, n] of [...byRoute].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${route}   (${(n / (IDLE_MS / 60_000)).toFixed(1)}/min)`);
}
console.log(`\n  ${idle.length} requests in ${IDLE_MS / 1000}s — ${(idle.length / (IDLE_MS / 60_000)).toFixed(1)}/min\n`);

ws.close();
process.exit(0);
