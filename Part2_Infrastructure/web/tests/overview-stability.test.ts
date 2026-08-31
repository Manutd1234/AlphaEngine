/**
 * The Overview tab's stability under a flapping gateway.
 * ======================================================
 *
 * The audit ledger was the tab's one self-polling surface, and it carried the
 * cockpit's defect in miniature: a failed poll — or a poll that answered
 * without an audit feed — replaced a table of REAL orders with the generated
 * sandbox ledger, and the next good poll swapped the real ones back. At the
 * panel's 30s cadence against a gateway dropping one poll in three, that is a
 * ledger visibly alternating between orders the gateway recorded and orders
 * nothing recorded, every few polls, with the provenance line flipping under
 * it.
 *
 * `DeskSourceMachine` (lib/desk-source.ts) makes that alternation
 * unrepresentable — measured data is never replaced by generated data, and
 * promotion back to `live` needs a streak — so the fix is to route the panel
 * through it rather than to invent a second hysteresis. The panel's own
 * decisions, `auditProbeOutcome` (what a settled probe means) and `auditView`
 * (what the machine's state renders as), live in
 * `components/overview/audit-trail-state.ts` precisely so this suite can drive
 * a pass/fail/pass script with no DOM and no renderer — the same argument
 * `desk-source.test.ts` makes for the machine itself.
 *
 * The other panels on the tab render `useBook` and `useSystemHealth`, which
 * already retain their last good reading; the wiring block at the bottom pins
 * the component files to the shared sources so the panels cannot drift back to
 * private copies.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { auditProbeOutcome, auditView } from "../components/overview/audit-trail-state";
import { DeskSourceMachine, PROMOTION_STREAK } from "../lib/desk-source";
import type { AuditRow } from "../lib/audit";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

// ---------------------------------------------------------------------------
// Harness: the panel's decision path, with a clock the test controls
// ---------------------------------------------------------------------------

/** The wording the component passes for a gateway that answered without rows. */
const MISSING_FEED = "The gateway answered without an audit feed.";

/** A measured row, minimal but wire-shaped. */
const row = (id: string): AuditRow => ({
  ts: "2026-08-21T09:30:00Z",
  order_id: id,
  strategy: "ma-crossover",
  symbol: "AAPL",
  side: "BUY",
  order_type: "MARKET",
  quantity: 12,
  notional: 2_400,
  accepted: true,
  rejected_by: null,
  reason: null,
  latency_ms: 1.4,
  fill_price: 200,
  fee_usd: 1.2,
});

/** What probeGateway settles to when the route answers with rows. */
const measured = (rows: AuditRow[]) => ({ ok: true as const, payload: { rows } });
/** A refused, hung or 500ing route. */
const refused = (message = "the audit route could not be reached.") => ({
  ok: false as const,
  failure: { message, timedOut: false },
});
/** HTTP 200 with no rows array — a gateway without the feed. */
const feedless = () => ({ ok: true as const, payload: {} });

function panel(start = 1_000) {
  let now = start;
  const machine = new DeskSourceMachine<AuditRow[]>({ now: () => now });
  return {
    observe: (raw: Parameters<typeof auditProbeOutcome>[0]) =>
      machine.observe(auditProbeOutcome(raw, MISSING_FEED)),
    view: () => auditView(machine.state),
    tier: () => machine.state.tier,
    tick: (ms: number) => { now += ms; },
  };
}

const ids = (rows: AuditRow[]) => rows.map((r) => r.order_id);

// ---------------------------------------------------------------------------
// 1. Measured audit rows are never replaced by generated ones
// ---------------------------------------------------------------------------

describe("one failed poll does not swap the measured ledger for the generated one", () => {
  it("the rows stay, demoted to cached rather than replaced", () => {
    const p = panel();
    p.observe(measured([row("real-1")]));
    assert.equal(p.view().kind, "ready");

    p.tick(30_000);
    p.observe(refused());
    const after = p.view();
    assert.equal(after.kind, "ready", "a failure with data behind it must stay a table");
    assert.deepEqual(after.kind === "ready" ? ids(after.rows) : [], ["real-1"]);
    assert.equal(p.tier(), "cached", "demotion is immediate; the tier says the numbers aged");
  });

  it("the provenance stamp is the last good read's, not the failed poll's", () => {
    const p = panel(50_000);
    p.observe(measured([row("real-1")]));
    p.tick(30_000);
    p.observe(refused());
    const after = p.view();
    assert.equal(
      after.kind === "ready" ? after.fetchedAt.getTime() : null,
      50_000,
      "cached rows carry the age of the reading, not a fresher-looking one",
    );
  });

  it("an alternating pass/fail gateway never renders the generated ledger", () => {
    const p = panel();
    p.observe(measured([row("real-1")]));
    const kinds: string[] = [];
    const script = [
      refused(),
      measured([row("real-2")]),
      refused(),
      measured([row("real-3")]),
      refused(),
    ];
    let expected = "real-1";
    for (const raw of script) {
      p.observe(raw);
      if (raw.ok && Array.isArray(raw.payload.rows) && raw.payload.rows[0]) {
        expected = raw.payload.rows[0].order_id;
      }
      const view = p.view();
      kinds.push(view.kind);
      if (view.kind === "ready") assert.deepEqual(ids(view.rows), [expected]);
    }
    assert.ok(
      !kinds.includes("generated"),
      `the ledger alternated into generated: ${kinds.join(" -> ")}`,
    );
  });

  it("returning to live needs the promotion streak, so one good poll cannot flip it back", () => {
    const p = panel();
    p.observe(measured([row("real-1")]));
    p.observe(refused());
    p.observe(measured([row("real-2")]));
    assert.equal(p.tier(), "cached", "one success after a failure is not yet a recovered gateway");
    for (let i = 1; i < PROMOTION_STREAK; i += 1) p.observe(measured([row("real-3")]));
    assert.equal(p.tier(), "live");
  });

  it("a gateway answering without an audit feed is a failure, and keeps the measured rows", () => {
    const p = panel();
    p.observe(measured([row("real-1")]));
    p.observe(feedless());
    const after = p.view();
    assert.equal(after.kind, "ready", "a 200 with no rows array replaced real rows before");
    assert.deepEqual(after.kind === "ready" ? ids(after.rows) : [], ["real-1"]);
    assert.equal(p.tier(), "cached");
  });
});

// ---------------------------------------------------------------------------
// 2. A missing live ledger remains explicitly unavailable
// ---------------------------------------------------------------------------

describe("the panel never substitutes rows when nothing was measured", () => {
  it("a failure before any reading is unavailable, with the reason", () => {
    const p = panel();
    p.observe(refused("the audit route could not be reached."));
    const view = p.view();
    assert.equal(view.kind, "unavailable");
    assert.equal(
      view.kind === "unavailable" ? view.detail : null,
      "the audit route could not be reached.",
    );
  });

  it("a feedless gateway before any reading names the missing feed", () => {
    const p = panel();
    p.observe(feedless());
    const view = p.view();
    assert.equal(view.kind, "unavailable");
    assert.equal(view.kind === "unavailable" ? view.detail : null, MISSING_FEED);
  });

  it("before the first probe settles the panel is loading, not a table of inventions", () => {
    assert.equal(panel().view().kind, "loading");
  });

  it("a measured empty ledger renders empty — generated rows must not pad it", () => {
    const p = panel();
    p.observe(measured([]));
    const view = p.view();
    assert.equal(view.kind, "ready");
    assert.equal(view.kind === "ready" ? view.rows.length : -1, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. The wiring: the component reads the machine, and only the machine
// ---------------------------------------------------------------------------

describe("AuditTrail routes through the house machinery", () => {
  const source = read("../components/overview/AuditTrail.tsx");

  it("holds its source decision in useDeskSource, not a local useState", () => {
    assert.ok(source.includes("useDeskSource"), "the panel no longer reads the shared machine");
    assert.ok(
      source.includes("audit-trail-state"),
      "the render decision left the sequence-testable module",
    );
    // The old shape: `useState<AuditState>` flipping between ready and
    // generated on each poll. No local state at all is the strongest pin —
    // everything the panel renders derives from the machine's snapshot.
    assert.ok(
      !/\buseState\b/.test(source),
      "a local useState reappeared beside the machine — two owners for one decision",
    );
  });

  it("asks for the same window and contains no generated ledger dependency", () => {
    assert.ok(source.includes("limit=40"), "the audit window changed size silently");
    assert.ok(
      !source.includes("sandboxAuditRows") && !source.includes("fallbacks/audit"),
      "the overview audit panel regained a generated data dependency",
    );
    assert.ok(
      !read("../components/WorkspaceOverview.tsx").includes("seed={book.seed}"),
      "the overview still hands a generation seed to its audit ledger",
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Panels stating one fact state it from one derivation
// ---------------------------------------------------------------------------

describe("the hero band and the KPI deck spell the research candidate identically", () => {
  // Both derive from the same props, but the formula is written twice; if one
  // spelling changes without the other, the same run reads as two candidates.
  const candidate = "`${STRATEGY_LABELS[shown.request.strategy]} ${shown.best.fast}/${shown.best.slow}`";
  const shown = "result ?? staleResult";

  for (const file of ["../components/WorkspaceOverview.tsx", "../components/overview/KpiDeck.tsx"]) {
    it(`${file.replace("../components/", "")} builds it from the shared run, in the shared form`, () => {
      const text = read(file);
      assert.ok(text.includes(candidate), "the candidate label's formula drifted");
      assert.ok(text.includes(shown), "the veiled previous run stopped feeding the label");
    });
  }
});
