/**
 * Execution under a flapping gateway and a flapping realtime channel.
 *
 * The cockpit's own twitch — `setBook(null)` on a failed probe — is pinned in
 * `desk-source.test.ts`, machine and wiring both. This suite covers the rest
 * of the tab with the same question that found that defect: what happens to
 * each panel on one failed poll, and on an alternating pass/fail sequence?
 *
 * Two findings, both fixed against the tests here:
 *
 *  1. The decision tape gated its whole table on `state === "live"`, so a
 *     dropped Supabase channel replaced every decision already on the tape
 *     with a one-line banner — and the client reconnects on its own cadence,
 *     so a flapping socket alternated table and banner every few seconds.
 *     The rows are measured data (decisions Postgres really committed, each
 *     carrying its own timestamp); a transport state may add a sentence, it
 *     must not unmount a reading. `tapeSurface` is the pure decision, replayed
 *     here with no DOM.
 *
 *  2. The order write existed twice: the pinned submit inside `OrderTicket`
 *     and a byte-for-byte extraction in `order-submit.ts` that nothing ever
 *     imported. Two copies of one POST contract drift silently — an edit to
 *     the payload in one leaves the other agreeing with history instead of
 *     with the gateway — so the dead copy is gone and the count is pinned.
 *
 * Everything else in the suite is a pin: it passed on first run and exists so
 * the property has to be broken deliberately rather than by a refactor.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { tapeSurface } from "../components/execution/tape-view";
import type { TapeState } from "../lib/use-desk-tape";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(webRoot, relative), "utf8");

/**
 * Comment bodies stripped before any keyword scan. These files argue in prose
 * about what they deliberately do not do — the cockpit feed's header quotes
 * `setBook(null)` as the defect it ended — so scanning raw text finds the
 * explanation and reports the safeguard as the violation.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

// --------------------------------------------------------------------------
// The decision tape: rows survive the channel that delivered them
// --------------------------------------------------------------------------

describe("rows already on the tape survive a channel drop", () => {
  it("a drop with rows in hand keeps the table and adds the sentence", () => {
    const surface = tapeSurface("unavailable", 5);
    assert.equal(surface.table, true, "a dropped channel unmounted measured rows");
    assert.equal(surface.notice, true, "a dropped channel must say rows are being missed");
  });

  it("a flapping channel never unmounts the table", () => {
    // The exact sequence a reconnecting socket produces: live, drop, the
    // client's own resubscribe, live again, another drop. Rows stay in hand
    // throughout — the hook never discards them — so the table must too.
    const script: Array<[TapeState, number]> = [
      ["live", 3],
      ["unavailable", 3],
      ["connecting", 3],
      ["live", 4],
      ["unavailable", 4],
    ];
    const shown = script.map(([state, rows]) => tapeSurface(state, rows).table);
    assert.deepEqual(
      shown,
      [true, true, true, true, true],
      `the table flickered: ${shown.join(" → ")}`,
    );
  });

  it("the notice appears exactly when the stream is not simply live", () => {
    const script: Array<[TapeState, number]> = [
      ["live", 3],
      ["unavailable", 3],
      ["connecting", 3],
      ["live", 4],
    ];
    const notices = script.map(([state, rows]) => tapeSurface(state, rows).notice);
    assert.deepEqual(notices, [false, true, true, false]);
  });

  it("an empty tape is a sentence, never an empty table", () => {
    for (const state of ["unconfigured", "connecting", "live", "unavailable"] as TapeState[]) {
      const surface = tapeSurface(state, 0);
      assert.equal(surface.table, false, `${state}: an empty table was rendered`);
      assert.equal(surface.notice, true, `${state}: an empty tape said nothing`);
    }
  });

  it("the panel renders through the decision, not around it", () => {
    const panel = code(read("components/execution/DeskTape.tsx"));
    assert.match(panel, /tapeSurface\(state, rows\.length\)/);
    assert.match(panel, /surface\.notice &&/);
    assert.match(panel, /surface\.table &&/);
    // The old gate, spelt out so it cannot come back: rendering the table only
    // while live is what made a transport flap unmount measured rows.
    assert.doesNotMatch(panel, /state !== "live" \|\| rows\.length === 0\s*\?/);
  });
});

// --------------------------------------------------------------------------
// One write path: the order POST has exactly one copy
// --------------------------------------------------------------------------

describe("the order write exists once", () => {
  it("exactly one file in the tab posts to /api/gateway/orders", () => {
    const dir = join(webRoot, "components/execution");
    const owners: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      const source = code(readFileSync(join(dir, entry), "utf8"));
      if (/fetch\("\/api\/gateway\/orders"/.test(source)) owners.push(entry);
    }
    // Two copies of one POST contract drift silently: an edit to the payload
    // in one leaves the other agreeing with history rather than the gateway.
    assert.deepEqual(owners, ["OrderTicket.tsx"], `order write owners: ${owners.join(", ")}`);
  });
});

// --------------------------------------------------------------------------
// One source per fact: the panels render the feed, they do not re-fetch it
// --------------------------------------------------------------------------

describe("every cockpit panel is a pure function of the one feed", () => {
  /**
   * `OrderTicket` is deliberately absent: it carries the tab's one write,
   * exempted by name in `no-dead-ends.test.ts`. `DeskTape` is absent because
   * its Supabase channel is the panel's whole subject, owned by its own hook.
   * Everything else renders props — a second fetch in any of them would be a
   * second moment of the same desk, which is the disagreement the cockpit's
   * single poll exists to prevent.
   */
  const PANELS = [
    "AlertFeed.tsx",
    "BlotterViews.tsx",
    "CockpitChrome.tsx",
    "ExecutionQuality.tsx",
    "FillQualityHeatmap.tsx",
    "LatencyHistogram.tsx",
    "LiquidityBook.tsx",
    "MarketWatchlist.tsx",
    "OrderBlotter.tsx",
    "OrderTicketForm.tsx",
    "OrderVerdict.tsx",
    "PnlStrip.tsx",
    "RouteEstimate.tsx",
    "RoutingProbe.tsx",
    "SpreadDecomposition.tsx",
    "VenueMixDonut.tsx",
  ];

  it("no panel fetches, probes or polls on its own", () => {
    for (const panel of PANELS) {
      const source = code(read(join("components/execution", panel)));
      assert.doesNotMatch(source, /\bfetch\(/, `${panel} fetches for itself`);
      assert.doesNotMatch(source, /probeGateway/, `${panel} probes for itself`);
      assert.doesNotMatch(source, /usePolling/, `${panel} polls for itself`);
    }
  });

  it("exactly one DeskSourceMachine decides what the cockpit shows", () => {
    const dir = join(webRoot, "components/execution");
    const owners: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) continue;
      const source = code(readFileSync(join(dir, entry), "utf8"));
      if (/new DeskSourceMachine/.test(source)) owners.push(entry);
    }
    assert.deepEqual(owners, ["use-cockpit-feed.ts"]);
  });

  it("mode, staleness and the sync time all read the machine's one state", () => {
    const feed = code(read("components/execution/use-cockpit-feed.ts"));
    assert.match(feed, /const \{ showing \} = source;/);
    assert.match(feed, /const mode: CockpitMode = showing\.kind === "measured"/);
    assert.match(feed, /const stale = showing\.kind === "measured" && showing\.tier === "cached"/);
    assert.match(feed, /lastSyncAt: source\.lastGoodAt/);
  });

  it("the local judge is handed over only on a generated desk", () => {
    // Which of the two order paths a click takes must be the machine's stable
    // decision, never whichever way the last probe happened to land — the
    // machine cannot re-enter "sandbox" once a reading exists, so neither can
    // the judge hand-off.
    const cockpit = code(read("components/execution/ExecutionCockpit.tsx"));
    assert.match(cockpit, /judge=\{mode === "sandbox" \? judge : undefined\}/);
  });

  it("a failed audit read keeps the blotter and alert rows in hand", () => {
    const feed = code(read("components/execution/use-cockpit-feed.ts"));
    assert.match(feed, /if \(orderOutcome\?\.ok\)/);
    assert.match(feed, /if \(eventOutcome\?\.ok\)/);
    assert.doesNotMatch(feed, /setOrders\(\[\]\)/, "a failed poll cleared the blotter");
    assert.doesNotMatch(feed, /setEvents\(\[\]\)/, "a failed poll cleared the alert feed");
  });

  it("the venue strip renders decided statuses and holds no second stopwatch", () => {
    // The hysteresis lives in `VenueLiveness`, inside the one `useLiveBook`
    // subscription. A panel recomputing staleness from timestamps would be a
    // second opinion that flips when the first does not.
    const strip = code(read("components/execution/MarketWatchlist.tsx"));
    assert.match(strip, /venue\.status/);
    assert.doesNotMatch(strip, /VenueLiveness|setInterval|Date\.now|STALE_AFTER/);
  });

  it("the P&L strip reads the transport from the shared stream store", () => {
    // A label describing a connection is only trustworthy if it comes from the
    // same place the connection does; a prop would be a copy that can be stale
    // exactly when it matters.
    const strip = code(read("components/execution/PnlStrip.tsx"));
    assert.match(strip, /useDeskStream\(mode === "live"\)/);
    assert.match(strip, /transportLabel\(stream\.state\)/);
  });

  it("one sandbox seed builds one generated desk", () => {
    const feed = code(read("components/execution/use-cockpit-feed.ts"));
    assert.match(feed, /const sandboxState = useMemo\(/);
    assert.match(feed, /sandboxBook\(undefined, seed\)/);
  });
});

// --------------------------------------------------------------------------
// Width economy: the tape and the alert feed each get the whole panel
// --------------------------------------------------------------------------

describe("the stream panes spend their width", () => {
  it("gives each feed the panel alone, never half of it", () => {
    // They shared `.cockpit-grid` for a while, to spare a scroll past mostly
    // empty tape. At half a desk the alert table's six columns broke
    // "research" and "web:token" mid-word and stacked event names two lines
    // deep (2026-08-23), so the two streams are two panes now, each at full
    // width, and the reader pays a click instead of reading broken words.
    const cockpit = code(read("components/execution/ExecutionCockpit.tsx"));
    assert.match(cockpit, /activityPane === "tape" && <DeskTape symbol=\{symbol\} \/>/);
    assert.match(cockpit, /activityPane === "alerts" && <AlertFeed events=\{effectiveEvents\} source=\{feedSource\} \/>/);
    assert.doesNotMatch(cockpit, /<div className="cockpit-grid">\s*<DeskTape/);
  });
});
