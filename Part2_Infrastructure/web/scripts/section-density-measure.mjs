/**
 * Measure how much page each section and view actually occupies.
 *
 * Every geometric claim in this repository is DERIVED rather than observed —
 * CLAUDE.md fact 6 — because `npm test` is plain Node with no DOM. "Less
 * scrolling", "good use of space" and "the control row no longer wraps" are all
 * geometric claims, so a pass making them owes a measurement rather than an
 * assertion. This is that measurement, modelled on `header-ladder-measure.mjs`
 * and `tab-switch-measure.mjs`, which exist for the same reason.
 *
 * WHAT IT RECORDS, per tab, per section, and per view within a section:
 *
 *   scrollHeight       at 1440 and at 1100, the two widths the density pass
 *                      cares about — the desk, and the breakpoint where the
 *                      engine drops to one column
 *   control rows       how many `.seg` controls the section draws, how tall the
 *                      section-level one is, and whether it WRAPPED (its height
 *                      exceeding one row is the wrap `14r` was written to allow
 *                      and this pass was meant to make unnecessary)
 *   furniture          `.coh-figure`, `.coh-table`, `.disclosure` and top-level
 *                      `<p>` counts — the shape of a view, which is what a
 *                      consistency sweep is actually about
 *
 * RUN IT AGAINST A PRODUCTION BUILD, not `next dev`, and the reason is written
 * down because it fails in a way that looks like something else: `next dev`
 * returns 403 for every JS chunk under Next's `allowedDevOrigins` guard, so the
 * page loads, nothing hydrates, and there is no console error naming the cause.
 * `next start` in turn refuses a loopback gateway URL unless `NODE_ENV` is
 * development, because a serverless function fetching 127.0.0.1 fetches itself.
 * And `/dashboard` 307s to `/login` without an `ae_desk` cookie, which is minted
 * over CDP below rather than by logging in.
 *
 *   npm run build
 *   NODE_ENV=development npx next start -p 3100 &
 *   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
 *     --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/ae-measure &
 *   node scripts/section-density-measure.mjs
 *
 * NOT PART OF ANY SUITE, deliberately: it needs a server and a browser, and a
 * test that silently skips when its prerequisites are missing is a test nobody
 * notices has stopped running. It writes a baseline JSON that a later pass can
 * diff against, which is the point — a before and an after rather than a claim.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { connect } from "./desk-sweep-cdp.mjs";
import { TABS } from "./desk-sweep-plan.mjs";

const ORIGIN = process.env.MEASURE_ORIGIN ?? "http://127.0.0.1:3100";
const OUT = fileURLToPath(new URL("../tests/fixtures/section-density.json", import.meta.url));
const WIDTHS = [1440, 1100];

/** The two tabs this pass is about. The other eight are another sweep's. */
const MEASURED = ["markets", "coherence"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * What one view looks like, measured in the page rather than derived from source.
 *
 * `scrollHeight` of the panel rather than of the document: the document carries
 * the header and the rail, which are constant, and including them would flatter
 * every section by the same amount and hide the differences this is for.
 */
const MEASURE = `(() => {
  const panel = document.querySelector('[role="tabpanel"]:not([hidden])')
    ?? document.querySelector(".coherence-plane");
  if (!panel) return null;
  const card = panel.querySelector(".console-card") ?? panel;
  const segs = [...card.querySelectorAll(":scope > .seg")];
  const nested = [...card.querySelectorAll(".seg")].length - segs.length;
  const row = segs[0];
  const button = row?.querySelector("button");
  return {
    scrollHeight: Math.round(panel.scrollHeight),
    controlRows: segs.length,
    nestedControls: nested,
    controlHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
    buttonHeight: button ? Math.round(button.getBoundingClientRect().height) : null,
    wrapped: row && button
      ? row.getBoundingClientRect().height > button.getBoundingClientRect().height * 1.6
      : false,
    figures: card.querySelectorAll(".coh-figure").length,
    tables: card.querySelectorAll(".coh-table").length,
    disclosures: card.querySelectorAll("details.disclosure").length,
    paragraphs: [...card.children].filter((el) => el.tagName === "P").length,
  };
})()`;

const BUTTONS = (selector) => `(() => {
  const card = document.querySelector(".console-card");
  const row = card?.querySelector("${selector}");
  return row ? [...row.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
})()`;

const CLICK = (selector, label) => `(() => {
  const card = document.querySelector(".console-card");
  const row = card?.querySelector("${selector}");
  const button = row && [...row.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return false;
  button.click();
  return true;
})()`;

async function openTab(cdp, tab, section) {
  await cdp.evaluate(`location.hash = ${JSON.stringify(`#${tab}/${section}`)}; true`);
  await sleep(500);
}

async function main() {
  const cdp = await connect();
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  // `/dashboard` is guarded by `web/proxy.ts` and 307s to /login without this.
  await cdp.send("Network.setCookie", {
    name: "ae_desk", value: "guest:measure", domain: "127.0.0.1", path: "/",
  });

  const report = { origin: ORIGIN, measuredOn: new Date().toISOString().slice(0, 10), widths: WIDTHS, tabs: {} };

  for (const width of WIDTHS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width, height: 1000, deviceScaleFactor: 1, mobile: false,
    });
    await cdp.send("Page.navigate", { url: `${ORIGIN}/dashboard` });
    await sleep(2500);

    for (const tab of MEASURED) {
      for (const section of TABS[tab]) {
        await openTab(cdp, tab, section);
        const groups = await cdp.evaluate(BUTTONS(":scope > .seg"));
        const key = `${tab}/${section}`;
        report.tabs[key] ??= {};

        if (!groups.length) {
          const measured = await cdp.evaluate(MEASURE);
          report.tabs[key][`@${width}`] = { "(no control)": measured };
          continue;
        }

        const perWidth = {};
        for (const group of groups) {
          await cdp.evaluate(CLICK(":scope > .seg", group));
          await sleep(450);
          // A grouped section draws its views in a child control; measure each,
          // because a group that is cheap on its first view can be expensive on
          // its third and the point is to find those.
          const views = await cdp.evaluate(BUTTONS(".coh-views > .seg"));
          if (!views.length) {
            perWidth[group] = await cdp.evaluate(MEASURE);
            continue;
          }
          for (const view of views) {
            await cdp.evaluate(CLICK(".coh-views > .seg", view));
            await sleep(400);
            perWidth[`${group} — ${view}`] = await cdp.evaluate(MEASURE);
          }
        }
        report.tabs[key][`@${width}`] = perWidth;
      }
    }
  }

  writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);

  // The readable half. A JSON nobody reads is a measurement nobody made.
  const rows = [];
  for (const [key, widths] of Object.entries(report.tabs)) {
    for (const [width, views] of Object.entries(widths)) {
      for (const [view, m] of Object.entries(views)) {
        if (!m) continue;
        rows.push(
          `${key.padEnd(22)} ${width.padEnd(7)} ${String(view).padEnd(34)} `
          + `${String(m.scrollHeight).padStart(6)}px  segs ${m.controlRows}+${m.nestedControls}  `
          + `${m.wrapped ? "WRAPPED" : "one row"}  `
          + `fig ${m.figures} tab ${m.tables} det ${m.disclosures} p ${m.paragraphs}`,
        );
      }
    }
  }
  console.log(rows.join("\n"));
  console.log(`\nwrote ${OUT}`);
  cdp.ws.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
