/**
 * Measure a tab switch the way a reader feels it.
 * ==============================================
 *
 * Not "how many requests" — the hooks already own the shared polls and
 * workspace-routing-hook-order.test.ts holds them there — but how long the main thread is
 * busy between the click and the desk being usable again. Three numbers per
 * tab, at 4x CPU throttle so a fast laptop cannot hide a slow render:
 *
 *   click -> paint    two rAFs after the click: when the new panel is on screen
 *   click -> idle     when requestIdleCallback fires: when the work is finished
 *   longest task      the largest longtask entry in between; > 50 ms is a jank
 *   blocking          total time over 50 ms across all longtasks in the switch
 *
 * Usage (a PRODUCTION build — reactStrictMode double-invokes effects in dev and
 * doubles the request count, which is not what ships):
 *
 *   npm run build && PORT=3100 npm run start
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \\
 *     --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
 *   node scripts/tab-switch-measure.mjs
 */
const CDP = "http://127.0.0.1:9222";
const t = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1720, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setCPUThrottlingRate", { rate: 4 });
await send("Page.navigate", { url: "http://localhost:3100/dashboard#overview/loop" });
await new Promise((r) => setTimeout(r, 9000));

const measure = async (tab) => {
  const expr = `new Promise((resolve) => {
    const longs = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); });
    try { po.observe({ entryTypes: ["longtask"] }); } catch {}
    const t0 = performance.now();
    document.getElementById('tab-${tab}').click();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const painted = performance.now() - t0;
      requestIdleCallback(() => {
        po.disconnect();
        resolve(JSON.stringify({ painted: +painted.toFixed(1),
          idle: +(performance.now() - t0).toFixed(1),
          longest: +(longs.length ? Math.max(...longs) : 0).toFixed(1),
          blocking: +longs.reduce((a, b) => a + Math.max(0, b - 50), 0).toFixed(1) }));
      }, { timeout: 4000 });
    }));
  })`;
  const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
  return JSON.parse(r.result.value);
};

const tabs = ["research", "live", "portfolio", "risk", "data", "reliability", "developer", "coherence", "overview"];
console.log("tab           click→paint   click→idle   longest task   blocking");
for (const tab of tabs) {
  const m = await measure(tab);
  await new Promise((r) => setTimeout(r, 1200));
  console.log(`${tab.padEnd(13)} ${String(m.painted).padStart(8)} ms ${String(m.idle).padStart(10)} ms ${String(m.longest).padStart(11)} ms ${String(m.blocking).padStart(9)} ms`);
}
await send("Target.closeTarget", { targetId: t.id });
ws.close();
