/**
 * Does a keyboard reader arriving at a figure get told anything?
 *
 * Every geometric and behavioural claim in this repository is DERIVED rather
 * than observed — CLAUDE.md fact 6 — because `npm test` is plain Node with no
 * DOM. "The plot announces its first mark on arrival" is a behavioural claim,
 * so it owes a measurement rather than an assertion. This is that measurement,
 * modelled on `tab-switch-measure.mjs` and `section-density-measure.mjs`.
 *
 * WHY IT EXISTS. A report reached this tree on 2026-08-26 saying the live
 * region stayed empty on arrival while the cursor was demonstrably set. It was
 * not reproducible on any figure that could be drawn that day, and the sibling
 * path was verified working — but "not reproducible" is worth exactly as much
 * as the harness that failed to reproduce it, so the harness is committed.
 *
 * WHAT IT REPORTS, per focusable plot on each named location:
 *
 *   before    the figure's own live region before focus (must be empty)
 *   ARRIVAL   the same region ~900ms after `focus()` — the whole question
 *   +arrow    after one ArrowRight, which proves the instrument is live at all
 *
 * A figure that is silent on ARRIVAL but speaks on +arrow is the defect: the
 * reader tabbed in, was told nothing, and had to guess that arrows do something.
 *
 * FOUR TRAPS, each of which produced a confidently wrong reading here first:
 *
 *  1. `Page.bringToFront` BEFORE any `focus()`. In a headless tab `focus()`
 *     sets `document.activeElement` and fires NO focus events without it, so a
 *     working readout reads as broken. Verified: the same figure reports
 *     "silent" without it and "speaks" with it.
 *  2. Scope every selector to ONE figure. Panels stay mounted behind `hidden`,
 *     so a page-wide `document.querySelector('.coh-plot__live')` returns some
 *     OTHER figure's region — an empty one — while the figure under test is
 *     speaking correctly. That mistake reproduces the reported symptom exactly.
 *  3. Filter on `offsetParent !== null`. Same reason: hidden sections' figures
 *     are in the DOM and are not focusable.
 *  4. Wait for the figure to DRAW. A figure whose data has not arrived renders
 *     its empty branch with no `<svg>` at all, which is correct behaviour and
 *     looks identical to a broken instrument. The script reports the empty
 *     reason rather than counting it as silence.
 *  5. Press the segs a reader would. A figure behind a pane seg (`Shape` on
 *     Positions) or behind a substitute book (`Sandbox` on Risk) is NOT in the
 *     DOM until the seg is pressed — switched-away panes unmount — so the hash
 *     alone cannot reach it, and "0 visible figures" there is the pane, not
 *     hydration. `tab/section!Label!Label` presses the visible buttons with
 *     exactly those labels, in that order, after the settle. Found 2026-08-26:
 *     `#risk/diagram` and `#portfolio/positions` both read 0 on a flat book
 *     while `#markets/books` spoke on the same server.
 *
 * Run against a PRODUCTION build, for the reason `section-density-measure.mjs`
 * records: `next dev` returns 403 for every JS chunk under Next's
 * `allowedDevOrigins` guard on 127.0.0.1, so nothing hydrates and no console
 * error names the cause. Use `localhost`.
 *
 *   npm run build
 *   NODE_ENV=development npx next start -p 3210 &
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9341 --disable-gpu about:blank &
 *   ARRIVAL_CDP=http://127.0.0.1:9341 ARRIVAL_ORIGIN=http://localhost:3210 \
 *     node scripts/figure-arrival-measure.mjs
 *
 * Use your OWN ports: 3100 and 9222 usually belong to another session.
 */

const CDP = process.env.ARRIVAL_CDP ?? "http://127.0.0.1:9341";
const ORIGIN = process.env.ARRIVAL_ORIGIN ?? "http://localhost:3210";
const LOCATIONS = (process.env.ARRIVAL_LOCATIONS ?? "markets/books,markets/lattice,markets/stake,coherence/corpus,coherence/calibration").split(",");
/** Long enough for a live exchange read; `/universe` carries a 28s deadline. */
const SETTLE_MS = Number(process.env.ARRIVAL_SETTLE_MS ?? 16000);

const target = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id;
  pending.set(n, resolve);
  ws.send(JSON.stringify({ id: n, method, params }));
});
await new Promise((resolve) => { ws.onopen = resolve; });
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message.result);
    pending.delete(message.id);
  }
};
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", { expression, returnByValue: true });
  return result?.exceptionDetails ? `ERR ${result.exceptionDetails.text}` : result?.result?.value;
};
const press = async (key, code, keyCode) => {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode });
  }
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1720, height: 1100, deviceScaleFactor: 1, mobile: false });
// `/dashboard` 307s to `/login` without a pass; minted here rather than by logging in.
await send("Network.setCookie", { name: "ae_desk", value: "guest:arrival", domain: "localhost", path: "/" });

/** Only figures that are VISIBLE and have drawn — see traps 3 and 4. */
const COLLECT = `(() => {
  const figures = [...document.querySelectorAll('figure.coh-figure')].filter((f) => f.offsetParent !== null);
  window.__plots = figures
    .map((f) => ({ f, svg: f.querySelector('svg[tabindex="0"]'), own: f.querySelector(':scope > .coh-plot__live') }))
    .filter((x) => x.svg);
  return JSON.stringify({
    visible: figures.length,
    focusable: window.__plots.length,
    undrawn: figures
      .filter((f) => !f.querySelector('svg[tabindex="0"]'))
      .map((f) => ({
        caption: f.querySelector('.coh-figure__caption')?.textContent?.slice(0, 48) ?? null,
        empty: f.querySelector('.coh-figure__empty')?.textContent?.trim().slice(0, 72) ?? null,
      })),
  });
})()`;

let silent = 0;
let spoke = 0;

for (const spec of LOCATIONS) {
  const [location, ...presses] = spec.split("!");
  await send("Page.navigate", { url: `${ORIGIN}/dashboard#${location}` });
  // TRAP 1. Without this, focus() fires no focus events and every plot reads silent.
  await send("Page.bringToFront");
  await wait(SETTLE_MS);
  // TRAP 5. A pane behind a seg is not in the DOM until the seg is pressed.
  for (const label of presses) {
    const hit = await evaluate(`(() => {
      const wanted = ${JSON.stringify(label)};
      const b = [...document.querySelectorAll('button')]
        .find((el) => el.offsetParent !== null && el.textContent.trim() === wanted);
      if (!b) return "missing";
      b.click();
      return "ok";
    })()`);
    console.log(`   press "${label}": ${hit === "ok" ? "ok" : "NO VISIBLE BUTTON WITH THAT LABEL"}`);
    await wait(2500);
  }

  let state = JSON.parse(await evaluate(COLLECT));
  for (let attempt = 0; attempt < 4 && state.focusable === 0; attempt++) {
    await wait(4000);
    state = JSON.parse(await evaluate(COLLECT));
  }

  console.log(`\n#${spec} — ${state.focusable} focusable of ${state.visible} visible figure(s)`);
  for (const undrawn of state.undrawn) {
    console.log(`   (not drawn) ${undrawn.caption} — ${undrawn.empty ?? "no empty reason given"}`);
  }

  for (let i = 0; i < state.focusable; i++) {
    // TRAP 2. Every read below is scoped to THIS figure's own region.
    await evaluate(`window.__one = window.__plots[${i}]`);
    const meta = JSON.parse(await evaluate(`JSON.stringify({
      caption: window.__one.f.querySelector('.coh-figure__caption')?.textContent?.slice(0, 50),
      marks: window.__one.svg.querySelectorAll('title').length,
      ownRegion: !!window.__one.own,
      regionsInThisFigure: window.__one.f.querySelectorAll('.coh-plot__live').length,
    })`));
    const read = async (at) => JSON.parse(await evaluate(`JSON.stringify({
      at: ${JSON.stringify(at)},
      text: (window.__one.own ? window.__one.own.textContent : '(no region)').slice(0, 72),
      focused: document.activeElement === window.__one.svg,
    })`));

    const before = await read("before");
    await evaluate(`window.__one.svg.focus()`);
    await wait(900);
    const arrival = await read("ARRIVAL");
    await press("ArrowRight", "ArrowRight", 39);
    await wait(350);
    const arrowed = await read("+arrow");

    const verdict = arrival.text.trim() !== "" ? "speaks on arrival"
      : arrowed.text.trim() !== "" ? "SILENT ON ARRIVAL"
      : "silent throughout";
    if (verdict === "speaks on arrival") spoke++; else silent++;

    console.log(`  [${i}] ${meta.caption}`);
    console.log(`       marks=${meta.marks} regionsInThisFigure=${meta.regionsInThisFigure}`);
    console.log(`       before  focused=${before.focused} "${before.text}"`);
    console.log(`       ARRIVAL focused=${arrival.focused} "${arrival.text}"`);
    console.log(`       +arrow  focused=${arrowed.focused} "${arrowed.text}"`);
    console.log(`       >>> ${verdict}`);
  }
}

console.log(`\n${spoke} plot(s) speak on arrival, ${silent} do not.`);
await send("Target.closeTarget", { targetId: target.id });
process.exit(silent > 0 ? 1 : 0);
