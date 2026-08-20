/**
 * The Chrome DevTools Protocol half of the desk sweep.
 *
 * Attaching to a browser, installing a fault profile, waiting for hydration and
 * measuring one section body. None of it knows what is being swept — that is
 * `desk-sweep-plan.mjs` — and none of it decides whether a cell passed, which is
 * `desk-sweep.mjs`. Split out when the harness passed the length ceiling; the
 * seam is the one the file already had a banner for.
 *
 * The two evaluated strings are exported as source rather than as functions
 * because they run in the PAGE, not here.
 */

const CDP = process.env.SWEEP_CDP ?? "http://127.0.0.1:9222";

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

export { connect, installProfile, HYDRATED, INSPECT };
