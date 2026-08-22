/**
 * Measure the header's priority ladder.
 * ====================================
 *
 * `.workspace-header__utility` is `overflow-x: clip`, so a header row wider
 * than the viewport silently loses its rightmost controls. The ladder in
 * globals.css ("The header's priority ladder") is a set of `@media (max-width:
 * N)` rungs, each folding one small thing just before the next clip. Those N
 * are MEASUREMENTS of the row at its chrome type size, and every time that
 * size changes they must be re-measured, not guessed. This script is how.
 *
 * It drives a real Chrome over CDP against the local dev server as a guest
 * (the widest the row gets), injects the widest production strings into the
 * chips, and for every viewport width reports the row's slack — the px
 * between the last control's right edge and the row's inner edge — plus
 * which labels the ladder has folded there. A negative slack is a clip.
 *
 * Usage:
 *   PORT=3100 npm run dev
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
 *   node scripts/header-ladder-measure.mjs                     # 2000 → 1080, step 2
 *   node scripts/header-ladder-measure.mjs --from=1900 --to=1100 --step=10
 *   node scripts/header-ladder-measure.mjs --text-size=large   # must match the default run
 *   node scripts/header-ladder-measure.mjs --all               # every width, not just changes
 *
 * Method for a re-measure (two passes, both with this script):
 *   A. Raise every rung by ~60px in the CSS so nothing folds early, sweep, and
 *      within each band note the width at which slack first goes negative —
 *      that is where the NEXT rung must sit (round up to a multiple of 10).
 *   B. Set the rungs, sweep again, and confirm slack ≥ 0 and one row at every
 *      width down to the wrap. Then run with --text-size=large: the numbers
 *      must be identical, which is the proof the header ignores the Text-size
 *      preference (it uses the fixed --fs-chrome-* tokens).
 */

const ORIGIN = process.env.SWEEP_ORIGIN ?? "http://localhost:3100";
const CDP = process.env.SWEEP_CDP ?? "http://127.0.0.1:9222";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const FROM = Number(args.from ?? 2000);
const TO = Number(args.to ?? 1080);
const STEP = Number(args.step ?? 2);
const TEXT_SIZE = args["text-size"] ?? "";

async function connect() {
  const targets = await (await fetch(`${CDP}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target — is Chrome running with --remote-debugging-port=9222?");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", () => reject(new Error("could not attach to Chrome")));
  });
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (res.result?.exceptionDetails) throw new Error(res.result.exceptionDetails.text ?? "evaluate threw");
    return res.result?.result?.value;
  };
  return { ws, send, evaluate };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The widest strings the production header can carry, injected as a guest. */
const INJECT = `
(() => {
  const set = (sel, text) => { const el = document.querySelector(sel); if (el) el.textContent = text; };
  const chip = document.querySelector(".latency-chip__copy strong");
  if (chip) chip.innerHTML = '15.0 µs<em class="latency-chip__core"> · core 352 ns</em>';
  set(".latency-chip__state", "within budget");
  set(".system-health__label", "12/12 providers routable");
  set(".system-health__label--short", "12/12 providers");
  set(".data-tier__label", "Live data");
  return true;
})()`;

const MEASURE = `
(() => {
  const row = document.querySelector(".workspace-header__utility");
  if (!row) return { error: "no utility row" };
  // Slack is the room the flex spacer has left to absorb; overflow is what
  // \`overflow-x: clip\` is hiding (scrollWidth still counts it). Wrapping
  // (below the last rung) shows as the row growing past one control's height.
  const rect = row.getBoundingClientRect();
  const spacer = row.querySelector(".header-spacer");
  const spacerPx = spacer ? spacer.getBoundingClientRect().width : 0;
  // The tab strip is flex: 1 and its buttons flex: 1, so it swallows spare
  // room before the spacer does; the room it can still give back is its
  // width minus its buttons' natural widths and gaps.
  const tabs = document.querySelector(".workspace-tabs");
  let tabsSpare = 0;
  if (tabs) {
    const buttons = [...tabs.querySelectorAll(":scope > button, :scope > a")];
    const gap = parseFloat(getComputedStyle(tabs).columnGap || getComputedStyle(tabs).gap || "0") || 0;
    // A flex-grown button's scrollWidth is its grown width; its natural width
    // is the word inside it plus its own padding.
    const natural = buttons.reduce((sum, b) => {
      const cs = getComputedStyle(b);
      const word = [...b.children].reduce((w, c) => w + c.getBoundingClientRect().width, 0) || b.scrollWidth;
      return sum + word + parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + parseFloat(cs.columnGap || "0") * Math.max(0, b.children.length - 1);
    }, 0) + gap * Math.max(0, buttons.length - 1);
    tabsSpare = Math.max(0, tabs.clientWidth - natural);
  }
  const overflowPx = row.scrollWidth - row.clientWidth;
  const slackValue = overflowPx > 0 ? -overflowPx : spacerPx + tabsSpare;
  const rows = rect.height > 60 ? 2 : 1;
  const folded = [];
  const check = (name, sel) => {
    const el = document.querySelector(sel);
    if (!el) return;
    const s = getComputedStyle(el);
    if (s.display === "none" || el.getBoundingClientRect().width === 0 || s.fontSize === "0px") folded.push(name);
  };
  check("search-label", ".header-command-button__label");
  check("chip-state", ".latency-chip__state");
  check("settings-label", ".workspace-header__utility > .header-anchor > .header-settings span");
  check("tier-label", ".data-tier__label");
  // The Connect label is a Tailwind arbitrary max-width hidden span, where the
  // breakpoint is a rung. The class is NOT written out here on purpose: Tailwind
  // v4 scans .mjs for class names and cannot tell a comment from markup, so a
  // literal `max-[` + placeholder + `]:hidden` in this line was extracted as a
  // real utility and emitted `@media (width < Npx)` into app/tailwind.css —
  // invalid CSS, a build warning today and a build failure the moment warnings
  // become fatal. Rejected alternative: a Tailwind ignore comment, which does
  // not exist for source scanning; the scanner takes the file, not the syntax.
  check("connect-label", ".workspace-header__utility span[class*='max-[1']");

  check("providers-label", ".system-health__label");
  check("providers-short", ".system-health__label--short");
  check("brand-tagline", ".brand-copy small");
  check("chip-copy", ".latency-chip__copy");
  check("kill-label", ".header-kill-label");
  const chip = document.querySelector(".latency-chip");
  // Zero slack with no overflow can mean the tab strip (flex: 1, nowrap) is
  // being squeezed before anything clips — the ladder's contract is that the
  // tabs never lose their words either, so that squeeze counts as a clip.
  const tabButtons = [...document.querySelectorAll(".workspace-tabs button")];
  const tabsSqueezed = tabButtons.some((b) => b.scrollWidth > b.clientWidth + 1);
  return {
    slack: Math.round(slackValue * 10) / 10,
    tabsSqueezed,
    rows,
    chipHeight: chip ? Math.round(chip.getBoundingClientRect().height * 10) / 10 : null,
    folded,
    tab: getComputedStyle(document.querySelector(".workspace-tabs button span") ?? document.body).fontSize,
    chipFont: getComputedStyle(document.querySelector(".data-tier") ?? document.body).fontSize,
  };
})()`;

const cdp = await connect();
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Emulation.setDeviceMetricsOverride", { width: FROM, height: 900, deviceScaleFactor: 1, mobile: false });
await cdp.send("Page.navigate", { url: `${ORIGIN}/login` });
await sleep(3000);
// Guest in.
await cdp.evaluate(`(() => { const b = [...document.querySelectorAll("button")].find((x) => /guest|open the workspace/i.test(x.textContent || "")); if (b) b.click(); return !!b; })()`);
await sleep(4000);
const ready = await cdp.evaluate(`!!document.querySelector(".workspace-header")`);
if (!ready) throw new Error("the workspace did not open — is the dev server on " + ORIGIN + "?");
await cdp.evaluate(`document.fonts.ready.then(() => true)`);
if (TEXT_SIZE) await cdp.evaluate(`(document.documentElement.dataset.textSize = ${JSON.stringify(TEXT_SIZE)}, true)`);
await cdp.evaluate(INJECT);

console.log(`width  slack  rows  chip   tab/chip  folded`);
let previous = null;
for (let width = FROM; width >= TO; width -= STEP) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(60);
  await cdp.evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
  await cdp.evaluate(INJECT);
  const m = await cdp.evaluate(MEASURE);
  if (m.error) throw new Error(m.error);
  const clip = m.slack < 0 || m.tabsSqueezed;
  const line = `${String(width).padEnd(6)} ${String(m.slack).padStart(6)}${m.tabsSqueezed ? "!" : " "} ${m.rows}     ${String(m.chipHeight).padEnd(6)} ${m.tab}/${m.chipFont}  ${m.folded.join(",")}`;
  // Print every row where something changed, plus every clip ("!" = tabs squeezed).
  const key = `${m.rows}|${m.folded.join(",")}|${clip}`;
  if ("all" in args || key !== previous || clip || width % 100 === 0) console.log(line);
  previous = key;
}
cdp.ws.close();
