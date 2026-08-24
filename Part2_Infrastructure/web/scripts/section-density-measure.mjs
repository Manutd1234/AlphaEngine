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
const DEFAULT_WIDTHS = "1440,1100";
/** Desk, and the breakpoint where the engine drops to one column. Override with
 *  `MEASURE_WIDTHS=760` to ask a narrower question without editing this. */
const REQUESTED = process.env.MEASURE_WIDTHS ?? DEFAULT_WIDTHS;
const WIDTHS = REQUESTED.split(",").map(Number);

/**
 * An exploratory run must not overwrite the committed baseline.
 *
 * It did once: two `MEASURE_WIDTHS=760` runs replaced the two-width fixture with
 * a 760-only one, and the next `git add -A` swept it into an unrelated commit —
 * a baseline silently narrowed to a width nothing else in the repository refers
 * to. Only the default widths write `section-density.json`; anything else writes
 * beside it under the widths it measured, which is also more useful, since a
 * narrow sweep is a different question rather than a newer answer.
 */
const OUT = fileURLToPath(new URL(
  REQUESTED === DEFAULT_WIDTHS
    ? "../tests/fixtures/section-density.json"
    : `../tests/fixtures/section-density-${REQUESTED.replace(/,/g, "-")}.json`,
  import.meta.url,
));

/** The two tabs this pass is about. The other eight are another sweep's. */
const MEASURED = ["markets", "coherence"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for a view to STOP being a loading state before measuring it.
 *
 * The first baseline measured Universe's Baskets at 239px with no figures, and
 * that number was a lie of timing rather than of geometry: the universe read is
 * a live call on a 28-second deadline, and the probe measured the pane while it
 * still said "Reading the families this engine prices…". Every data-backed view
 * on both tabs was understated the same way.
 *
 * So: poll until the panel's height has been unchanged twice in a row AND no
 * `.console-empty.muted` — this engine's "still reading" line, as opposed to its
 * failed and answered-with-nothing lines, which are settled states worth
 * measuring — remains on screen. Give up after `budget` and record what is
 * there, flagged, rather than blocking the sweep on one slow venue call.
 */
async function settle(cdp, tab, section, budget = 9000) {
  const id = JSON.stringify(`${tab}-subpanel-${section}`);
  let previous = -1;
  let stable = 0;
  const started = Date.now();
  while (Date.now() - started < budget) {
    const state = await cdp.evaluate(`(() => {
      const panel = document.getElementById(${id});
      if (!panel) return null;
      return {
        height: Math.round(panel.scrollHeight),
        loading: !!panel.querySelector(".console-empty.muted"),
      };
    })()`);
    if (!state) return { settled: false, reason: "panel missing" };
    if (!state.loading && state.height === previous) {
      stable += 1;
      if (stable >= 2) return { settled: true };
    } else {
      stable = 0;
    }
    previous = state.height;
    await sleep(300);
  }
  return { settled: false, reason: `still reading after ${budget}ms` };
}

/**
 * What one view looks like, measured in the page rather than derived from source.
 *
 * `scrollHeight` of the panel rather than of the document: the document carries
 * the header and the rail, which are constant, and including them would flatter
 * every section by the same amount and hide the differences this is for.
 */
const MEASURE = (tab, section) => `(() => {
  // BY ID, not by ":not([hidden])". Three tabpanels are un-hidden at once — the
  // tab's own panel, the section's, and Overview's — so "the first visible one"
  // measured Overview on every row of the first run and reported 0px for the
  // whole desk.
  const panel = document.getElementById(${JSON.stringify(`${tab}-subpanel-${section}`)});
  if (!panel) return null;
  const card = panel.querySelector(".console-card") ?? panel;
  const segs = [...card.querySelectorAll(":scope > .seg")];
  const nested = [...card.querySelectorAll(".seg")].length - segs.length;
  const row = segs[0];
  const button = row?.querySelector("button");
  return {
    stillReading: !!card.querySelector(".console-empty.muted"),
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

const BUTTONS = (tab, section, selector) => `(() => {
  const panel = document.getElementById(${JSON.stringify(`${tab}-subpanel-${section}`)});
  const card = panel?.querySelector(".console-card");
  const row = card?.querySelector("${selector}");
  return row ? [...row.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
})()`;

const CLICK = (tab, section, selector, label) => `(() => {
  const panel = document.getElementById(${JSON.stringify(`${tab}-subpanel-${section}`)});
  const card = panel?.querySelector(".console-card");
  const row = card?.querySelector("${selector}");
  const button = row && [...row.querySelectorAll("button")]
    .find((b) => b.textContent.trim() === ${JSON.stringify(label)});
  if (!button) return false;
  button.click();
  return true;
})()`;

/**
 * Click the tab, then the rail. Not `location.hash`.
 *
 * The rail reads the hash on mount; assigning to it afterwards moved the URL and
 * left the rendered section where it was, so the first run reported Universe's
 * five views for every Prices section. Clicking is also what a reader does.
 */
async function openTab(cdp, tab, section) {
  await cdp.evaluate(`document.getElementById(${JSON.stringify(`tab-${tab}`)})?.click(); true`);
  await sleep(350);
  const opened = await cdp.evaluate(
    `(() => { const b = document.getElementById(${JSON.stringify(`${tab}-subtab-${section}`)});`
    + ` if (!b) return false; b.click(); return true; })()`,
  );
  await sleep(400);
  return opened;
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
    await sleep(1200);
    // Chrome serves a stale chunk after a rebuild otherwise, which presents as
    // a desk rendering last week's labels with no error anywhere.
    await cdp.send("Page.reload", { ignoreCache: true });
    await sleep(4000);

    for (const tab of MEASURED) {
      for (const section of TABS[tab]) {
        const opened = await openTab(cdp, tab, section);
        const key = `${tab}/${section}`;
        report.tabs[key] ??= {};
        if (!opened) {
          report.tabs[key][`@${width}`] = { "(rail button not found)": null };
          continue;
        }
        const groups = await cdp.evaluate(BUTTONS(tab, section, ":scope > .seg"));

        if (!groups.length) {
          await settle(cdp, tab, section);
          const measured = await cdp.evaluate(MEASURE(tab, section));
          report.tabs[key][`@${width}`] = { "(no control)": measured };
          continue;
        }

        const perWidth = {};
        for (const group of groups) {
          await cdp.evaluate(CLICK(tab, section, ":scope > .seg", group));
          await sleep(250);
          await settle(cdp, tab, section);
          // A grouped section draws its views in a child control; measure each,
          // because a group that is cheap on its first view can be expensive on
          // its third and the point is to find those.
          const views = await cdp.evaluate(BUTTONS(tab, section, ".coh-views > .seg"));
          if (!views.length) {
            perWidth[group] = await cdp.evaluate(MEASURE(tab, section));
            continue;
          }
          for (const view of views) {
            await cdp.evaluate(CLICK(tab, section, ".coh-views > .seg", view));
            await sleep(250);
            await settle(cdp, tab, section);
            perWidth[`${group} — ${view}`] = await cdp.evaluate(MEASURE(tab, section));
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
          + `fig ${m.figures} tab ${m.tables} det ${m.disclosures} p ${m.paragraphs}`
          + `${m.stillReading ? "  STILL READING" : ""}`,
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
