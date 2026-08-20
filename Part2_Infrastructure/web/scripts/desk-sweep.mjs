/**
 * The desk sweep: every tab, every section, under every backend failure.
 * =====================================================================
 *
 * The claim this pass makes is "no surface can dead-end". That claim is not
 * checkable by the unit suite, because the failures it describes are layout and
 * data-flow states that only exist in a browser talking to a backend that is
 * refusing. So this walks all 43 rail sections across all 8 tabs under six
 * fault profiles and asserts, per cell, that the panel is populated and honest.
 *
 * WHY CDP FAULT INJECTION rather than restarting the dev server with different
 * env: because one of the six profiles cannot be produced any other way. A
 * gateway that *hangs* — accepts the connection and never answers — is the state
 * a redeploying container is actually in, and it is the state that left "book
 * connecting" on screen forever when the fetch had no deadline. Interception can
 * hold a request open indefinitely; an env var cannot. The same mechanism gives
 * the other five profiles for free and keeps one dev server for the whole run.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: that Reliability and Data show green. Those
 * two tabs exist to *report* infrastructure truth — a health matrix that invents
 * a passing probe is the one lie this codebase must not tell. On those tabs the
 * rule is inverted: they must render a complete, populated, legible report of the
 * degradation, and the degraded vocabulary is expected there rather than banned.
 * See TRUTH_TABS below.
 *
 * Usage:
 *   PORT=3100 npm run dev                     # in one shell
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
 *     --headless=new --remote-debugging-port=9222 --disable-gpu about:blank
 *   node scripts/desk-sweep.mjs               # in another
 *   node scripts/desk-sweep.mjs --profile=gateway-hang --tab=portfolio
 */

const ORIGIN = process.env.SWEEP_ORIGIN ?? "http://localhost:3100";

/**
 * The desk, which is `/dashboard` since sign-in-first shipped.
 *
 * This swept `/#tab/section` and every cell reported "never hydrated" the moment
 * the root became a signpost: the sweep was landing on the login page, which has
 * no workspace shell to measure. Worth stating rather than just fixing, because a
 * harness that silently measures the wrong page is the failure mode this file's
 * own header warns about.
 *
 * On a deployment with no Supabase credentials the guard admits the sweep as a
 * guest, so no cookie setup is needed here. Against a deployment WITH auth, run
 * it with a desk cookie already in the browser profile.
 */
const DESK = `${ORIGIN}/dashboard`;
const CDP = process.env.SWEEP_CDP ?? "http://127.0.0.1:9222";

/** Every rail section, from lib/sections.ts. Kept in sync by hand — a missing
 *  section here is a section nobody swept, so the count is asserted below. */
const TABS = {
  overview: ["loop", "desks", "audit"],
  research: ["summary", "parameters", "walkforward", "attribution", "lineage", "decision", "runs", "fitted", "codex"],
  live: ["trade", "liquidity", "routing", "quality", "activity"],
  portfolio: ["overview", "equity", "positions", "allocation", "performance"],
  risk: ["limits", "model", "drivers", "montecarlo", "oraclevar", "scenarios", "controls"],
  data: ["overview", "feeds", "quality", "incidents", "lineage", "providers", "queue"],
  reliability: ["overview", "planes", "services", "events", "controls"],
  developer: ["overview", "readiness", "quality", "apis", "codebase", "work"],
};

const EXPECTED_SECTIONS = 47;

/**
 * The two tabs whose job is to report infrastructure truth.
 *
 * Everywhere else, "unreachable" is a dead end to be removed. Here it is the
 * correct answer, and replacing it with generated green would be the failure.
 * What they must still never do is render an empty panel or a bare spinner.
 */
const TRUTH_TABS = new Set(["reliability", "data"]);

/**
 * Phrases that mean "this panel gave up".
 *
 * Deliberately narrow. "Pending" and "connecting" appear legitimately in
 * transient states and in prose about how the desk works, so they are matched
 * only as a whole-panel verdict — see `deadEnded`, which requires the panel to
 * be BOTH substantially empty AND carrying one of these.
 */
const DEAD_END_PHRASES = [
  "unavailable",
  "unreachable",
  "could not reach",
  "could not load",
  "no audit rows",
  "needs price history",
  "book connecting",
  "temporarily unavailable",
  // Added after reading the panels rather than guessing at them. Each of these
  // is a real surface's exact wording, and none matched the list above — the
  // fill-quality card ("nothing to measure without a source") sailed through a
  // sweep that was looking for the word "unavailable".
  "nothing to measure",
  "nothing to list",
  "no decision history",
  "is reachable in this deployment",
  "refuses to invent",
  "no completed run",
];

/** Fault profiles. Each maps a URL predicate to what should happen to it. */
const PROFILES = {
  /** No interception. Locally the gateway is already absent, which is the
   *  deployed workspace's own normal state. */
  "as-deployed": null,

  /** The public deployment: a same-origin route that reports no gateway. */
  "gateway-absent": {
    match: (url) => url.includes("/api/gateway/"),
    action: { fulfill: { status: 503, body: { code: "gateway_not_configured", error: "No gateway is configured for this deployment." } } },
  },

  /** The state a redeploying container is in. Never answers; the client's 2.5s
   *  deadline is the only thing that can end it. */
  "gateway-hang": {
    match: (url) => url.includes("/api/gateway/"),
    action: { hang: true },
  },

  /** A gateway that is up and unwell. */
  "gateway-503": {
    match: (url) => url.includes("/api/gateway/"),
    action: { fulfill: { status: 503, body: { error: "upstream risk gateway returned 503" } } },
  },

  /** The Always-Free Autonomous Database auto-stopping, which is routine. */
  "oracle-down": {
    match: (url) => url.includes("/api/oracle"),
    action: { fail: "ConnectionRefused" },
  },

  /** No provider API keys, and no bars to derive anything from. */
  "providers-keyless": {
    match: (url) => url.includes("/api/ohlcv") || url.includes("/api/providers") || url.includes("/api/quote"),
    action: { fail: "ConnectionRefused" },
  },
};

// ---------------------------------------------------------------------------
// CDP plumbing
// ---------------------------------------------------------------------------

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
  const listeners = new Set();
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++seq;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evaluate = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      throw new Error(res.result.exceptionDetails.text ?? "evaluate threw");
    }
    return res.result?.result?.value;
  };

  return { ws, send, evaluate, on: (fn) => listeners.add(fn), off: (fn) => listeners.delete(fn) };
}

/**
 * Install a fault profile.
 *
 * Held requests are tracked so they can be released at teardown: leaving them
 * paused wedges the next profile's navigation, which presents as a run that
 * mysteriously stalls after the hang profile.
 */
async function installProfile(cdp, profile) {
  const held = [];
  if (!profile) {
    await cdp.send("Fetch.disable");
    return { held, release: async () => {} };
  }
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });

  const onEvent = async (msg) => {
    if (msg.method !== "Fetch.requestPaused") return;
    const { requestId, request } = msg.params;
    if (!profile.match(request.url)) {
      await cdp.send("Fetch.continueRequest", { requestId });
      return;
    }
    const action = profile.action;
    if (action.hang) {
      // Held, never answered. This is the point of the profile.
      held.push(requestId);
      return;
    }
    if (action.fail) {
      await cdp.send("Fetch.failRequest", { requestId, errorReason: action.fail });
      return;
    }
    const body = JSON.stringify(action.fulfill.body);
    await cdp.send("Fetch.fulfillRequest", {
      requestId,
      responseCode: action.fulfill.status,
      responseHeaders: [{ name: "content-type", value: "application/json" }],
      body: Buffer.from(body).toString("base64"),
    });
  };

  cdp.on(onEvent);
  return {
    held,
    release: async () => {
      cdp.off(onEvent);
      for (const requestId of held) {
        await cdp.send("Fetch.failRequest", { requestId, errorReason: "Aborted" }).catch(() => {});
      }
      await cdp.send("Fetch.disable");
    },
  };
}

const HYDRATED = `new Promise((resolve) => {
  const ready = () => {
    const shell = document.querySelector('main.workspace-shell');
    const probe = document.querySelector('button.header-settings');
    return shell && probe && Object.keys(probe).some((k) => k.startsWith('__reactProps'));
  };
  if (ready()) return resolve(true);
  const timer = setInterval(() => { if (ready()) { clearInterval(timer); resolve(true); } }, 60);
  setTimeout(() => { clearInterval(timer); resolve(false); }, 25000);
})`;

/**
 * What one section looks like right now.
 *
 * MEASURE THE SECTION BODY, NOT THE TAB. `.view-panel` includes the page
 * heading, its KPI chips and the section rail — about 780 characters of chrome
 * that are present whether or not the section rendered anything. Measuring that
 * produced a confident 43/43 pass over an Execution tab whose fill-quality body
 * was empty and stayed empty: the cockpit's own fetch has no deadline, so under
 * a hung gateway it never left loading, and the harness was reading the heading
 * above it. `.workspace-subtab-panel:not([hidden])` is the active section's own
 * box. Tabs without a rail fall back to the view panel.
 */
const INSPECT = (phrases) => `(() => {
  const shell = document.querySelector('main.workspace-shell');
  const view = shell && shell.querySelector('.view-panel');
  if (!view) return { missing: true };
  const panel = view.querySelector('.workspace-subtab-panel:not([hidden])') || view;
  const bodyOnly = panel !== view;
  const text = (panel.innerText || '').replace(/\\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  const cards = panel.querySelectorAll('.card, [class*="card"]').length;
  const controls = panel.querySelectorAll('button, input, select, a[href]').length;
  const numbers = (text.match(/[0-9]/g) || []).length;

  /**
   * Data actually on screen, which is the only thing that distinguishes a
   * populated panel from a furnished empty one.
   *
   * Counting cards and controls was not enough in either direction. The KPI deck
   * on overview/loop renders through the Tailwind bridge with no .card class and
   * no controls at all, and was reported empty while showing six live metrics.
   * The blotter on live/activity has three cards and seven controls — filters, an
   * export menu — above a table with no rows, and was reported populated while
   * listing nothing. So: count table rows, tabular figures (.num is the house
   * class for them) and chart marks.
   */
  const tables = panel.querySelectorAll('table').length;
  const rows = panel.querySelectorAll('tbody tr').length;
  const figures = panel.querySelectorAll('.num, [class*="metric"] strong, [class*="kpi"] strong').length;
  const marks = panel.querySelectorAll('svg path, svg rect, svg circle, svg line').length;
  // Digits in prose are not data: "273.0y of history" inside an explanation of
  // why there is none should not make a panel look populated. Only counted when
  // something structural carries them.
  const dataPoints = rows + figures + (marks > 3 ? 3 : 0)
    + (rows === 0 && figures === 0 && marks === 0 && numbers > 12 ? 2 : 0);
  const badge = document.querySelector('.data-tier');
  return {
    chars: text.length,
    cards, controls, numbers, bodyOnly, tables, rows, figures, marks, dataPoints,
    phrases: ${JSON.stringify(phrases)}.filter((p) => lower.includes(p)),
    provenance: badge ? (badge.getAttribute('aria-label') || '').replace(/\\s+/g, ' ') : null,
    // A body that is still announcing a wait is a dead end that has not
    // finished admitting it. Checked without a character floor, because the
    // failure mode is an empty body, not a chatty one.
    stillWaiting: /^(loading|connecting|checking|waiting)\\b/.test(lower) || (text.length < 40 && /loading|connecting|…/.test(lower)),
    head: text.slice(0, 90),
  };
})()`;

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

/**
 * Rendering axes, orthogonal to the fault profiles.
 *
 * A dead end is a data-flow state and shows up under any of these; what these
 * catch is the other half of the claim — that the desk stays legible while it is
 * degraded. Forced-colors is the sharpest of them, because it discards every
 * colour the app chose, so anything that carried meaning in colour alone stops
 * carrying it at all.
 */
const MEDIA = {
  "dark": [{ name: "prefers-color-scheme", value: "dark" }],
  "light": [{ name: "prefers-color-scheme", value: "light" }],
  "reduce": [{ name: "prefers-reduced-motion", value: "reduce" }],
  "forced": [{ name: "forced-colors", value: "active" }],
};

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name) => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  return {
    profile: get("profile"), tab: get("tab"),
    media: get("media"), verbose: args.includes("--verbose"),
  };
}

async function main() {
  const { profile: onlyProfile, tab: onlyTab, media: onlyMedia, verbose } = parseArgs();

  const declared = Object.values(TABS).reduce((n, list) => n + list.length, 0);
  if (declared !== EXPECTED_SECTIONS) {
    console.error(`section list drift: this file declares ${declared}, expected ${EXPECTED_SECTIONS}.`);
    console.error("If a section was added, add it here too — an unswept section is an unverified one.");
    process.exitCode = 1;
    return;
  }

  const cdp = await connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  if (onlyMedia) {
    const features = MEDIA[onlyMedia];
    if (!features) {
      console.error(`unknown media "${onlyMedia}". known: ${Object.keys(MEDIA).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    await cdp.send("Emulation.setEmulatedMedia", { features });
  }

  let consoleErrors = [];
  cdp.on((msg) => {
    if (msg.method === "Runtime.exceptionThrown") {
      consoleErrors.push(msg.params.exceptionDetails.exception?.description
        ?? msg.params.exceptionDetails.text ?? "exception");
    }
  });

  const profiles = onlyProfile ? [onlyProfile] : Object.keys(PROFILES);
  const rows = [];

  for (const profileName of profiles) {
    if (!(profileName in PROFILES)) {
      console.error(`unknown profile "${profileName}". known: ${Object.keys(PROFILES).join(", ")}`);
      process.exitCode = 1;
      return;
    }
    const installed = await installProfile(cdp, PROFILES[profileName]);
    process.stdout.write(`\n${profileName}\n`);

    for (const [tab, sections] of Object.entries(TABS)) {
      if (onlyTab && tab !== onlyTab) continue;

      // One navigation per tab; sections switch by hash, which the workspace
      // listens for. Reloading 43 times per profile turned a 2-minute run into
      // 20 and told us nothing extra.
      consoleErrors = [];
      await cdp.send("Page.navigate", { url: `${DESK}#${tab}/${sections[0]}` });
      const ready = await cdp.evaluate(HYDRATED);
      if (!ready) {
        rows.push({ profile: profileName, tab, section: sections[0], verdict: "NOT-READY", notes: "never hydrated" });
        continue;
      }

      for (const section of sections) {
        /**
         * Wait for the panel to stop waiting, not for a fixed beat.
         *
         * A 550ms sleep reported live/trade and live/quality as permanently
         * stuck under the hang profile when they were merely inside the client's
         * 2.5s deadline — the panels populate at ~2.6s and the sweep looked at
         * 0.6s. Fixed sleeps in a harness whose whole subject is timeouts are
         * how you get confident wrong answers in both directions.
         *
         * `aria-busy="true"` is what the placeholders carry, so it is the app's
         * own statement that it is still working. The 7s cap is above every
         * client deadline in the app (2.5s) plus a retry, so hitting the cap is
         * itself a finding rather than a timing accident.
         */
        await cdp.evaluate(`(async () => {
          if (location.hash !== '#${tab}/${section}') {
            location.hash = '#${tab}/${section}';
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          // Both signals: aria-busy is the app's own statement, and a bare
          // .skeleton is what a panel that forgot to say so still renders. The
          // audit trail was the second kind, and measuring it mid-probe reported
          // a 121-character dead end that resolved a second later.
          const settled = () => !document.querySelector(
            'main.workspace-shell [aria-busy="true"], main.workspace-shell .skeleton');
          const started = Date.now();
          while (!settled() && Date.now() - started < 7000) {
            await new Promise((r) => setTimeout(r, 120));
          }
          // A beat after settling, for the render that follows the state change.
          await new Promise((r) => setTimeout(r, 260));
          return settled();
        })()`);

        const seen = await cdp.evaluate(INSPECT(DEAD_END_PHRASES));
        const problems = [];

        if (seen.missing) {
          problems.push("no panel rendered");
        } else if (!seen.bodyOnly && seen.chars < 120) {
          // No rail on this tab, so the view panel IS the body.
          problems.push(`thin panel (${seen.chars} chars)`);
        } else {
          /**
           * Four rules, each derived from reading a panel this sweep got wrong.
           *
           * Not every section is a data panel, and treating them all as one
           * produced three false failures in a row: the KPI deck renders no
           * .card and no controls but six live metrics; the risk controls panel
           * is two buttons and a paragraph explaining that this workspace holds
           * no gateway credential, which is the design rather than a failure;
           * and the delivery-workflow panel mentions "unavailable" in passing
           * inside 1500 characters of real pipeline state. Meanwhile the blotter
           * had three cards and seven controls above a table with no rows, and
           * looked populated by every crude measure.
           */
          if (seen.chars < 60) problems.push(`empty section body (${seen.chars} chars)`);

          // 1 — nothing to read and nothing to do. A panel with neither data nor
          // an action is not serving any purpose, whatever it says.
          if (seen.dataPoints === 0 && seen.controls === 0) {
            problems.push(`nothing to read and nothing to do (${seen.chars} chars)`);
          }

          // 2 — a table is a promise of rows. An empty one is the blotter case:
          // filters, export menu, column headers, and nothing listed.
          if (seen.tables > 0 && seen.rows === 0) {
            problems.push(`table with no rows (${seen.tables} table(s))`);
          }

          // 3 — a dead-end phrase in a panel that is mostly that phrase. Long
          // panels carrying real data may mention a degraded feed in passing;
          // that is the honest behaviour wanted, not a failure.
          if (seen.phrases.length && seen.dataPoints < 3 && seen.chars < 600 && !TRUTH_TABS.has(tab)) {
            problems.push(`dead end: "${seen.phrases.join('", "')}"`);
          }

          // 4 — still announcing a wait. Under a hung gateway this is the one
          // that matters: a body reading "Connecting to the risk gateway…" after
          // eight seconds is not loading, it is never going to load.
          if (seen.stillWaiting) problems.push(`still waiting (${seen.head.slice(0, 40)})`);

          if (!seen.provenance) problems.push("no provenance badge in the header");
        }

        if (consoleErrors.length) {
          problems.push(`${consoleErrors.length} js error(s): ${consoleErrors[0]?.slice(0, 60)}`);
          consoleErrors = [];
        }

        rows.push({
          profile: profileName, tab, section,
          verdict: problems.length ? "FAIL" : "ok",
          chars: seen.chars ?? 0, cards: seen.cards ?? 0,
          notes: problems.join("; "),
          head: verbose ? seen.head : undefined,
        });
        process.stdout.write(problems.length ? "x" : ".");
      }
    }
    await installed.release();
  }

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  console.log("\n");
  const failed = rows.filter((r) => r.verdict !== "ok");
  const byProfile = new Map();
  for (const row of rows) {
    const key = row.profile;
    const entry = byProfile.get(key) ?? { total: 0, bad: 0 };
    entry.total += 1;
    if (row.verdict !== "ok") entry.bad += 1;
    byProfile.set(key, entry);
  }

  console.log("profile             cells  failing");
  console.log("-".repeat(40));
  for (const [name, { total, bad }] of byProfile) {
    console.log(`${name.padEnd(20)}${String(total).padStart(5)}${String(bad).padStart(9)}`);
  }

  if (failed.length) {
    console.log(`\n${failed.length} failing cells:`);
    for (const row of failed) {
      console.log(`  ${row.profile} · ${row.tab}/${row.section} — ${row.notes}`);
      if (row.head) console.log(`      panel: ${row.head}`);
    }
  }

  console.log(
    `\n${failed.length ? "FAIL" : "PASS"} — ${rows.length - failed.length}/${rows.length} cells`
    + ` across ${byProfile.size} profile(s)`
    + (onlyMedia ? ` under ${onlyMedia}` : "")
    + (onlyTab ? ` on ${onlyTab}` : ""),
  );
  // Never report a pass over a run that measured nothing: the panel walk in this
  // repo once reported PASS across 27 cells it had never opened.
  if (rows.length === 0) {
    console.log("INCONCLUSIVE — no cells were measured");
    process.exitCode = 1;
  } else if (failed.length) {
    process.exitCode = 1;
  }

  cdp.ws.close();
}

await main();
