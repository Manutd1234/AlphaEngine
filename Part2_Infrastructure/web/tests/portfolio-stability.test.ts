/**
 * The Portfolio tab's one self-polled surface, pinned against a flapping
 * gateway.
 *
 * Every other panel on the tab renders the shared book, whose anti-twitch
 * property lives in `useBook` over `DeskSourceMachine` and is pinned by
 * `desk-source.test.ts`. `WorkingOrders` is the exception: it polls
 * `/api/gateway/orders/working` itself, every five seconds, and it used to
 * hold the outcome as its own `rows` + `error` pair with no hysteresis. On a
 * gateway dropping every other poll that pair alternated — error banner on,
 * error banner off — at the poll cadence, and a live feed that had never
 * answered rendered "Nothing is resting. Every accepted order so far filled
 * at once" under the failure banner: a positive claim about a book it had
 * never read.
 *
 * The cure is the house one: the machine decides, a pure function maps the
 * machine's state plus the panel's `source` prop to the one rendered
 * decision, and the component renders that decision. Nothing here mounts
 * React — the flap is a scripted list of outcomes and a read of the decision,
 * which is the whole reason the decision is a function and not JSX.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  workingOrdersFeedView,
  type WorkingOrdersFeedView,
} from "../components/portfolio/working-orders-feed";
import { sandboxWorkingOrders, type WorkingOrderRow } from "../lib/blotter";
import { DeskSourceMachine, type ProbeOutcome } from "../lib/desk-source";
import { code, read } from "./helpers/portfolio-sources";

const ROWS = sandboxWorkingOrders();

const ok = (rows: WorkingOrderRow[] = ROWS): ProbeOutcome<WorkingOrderRow[]> =>
  ({ ok: true, payload: rows });
const down = (): ProbeOutcome<WorkingOrderRow[]> => ({
  ok: false,
  failure: { message: "/api/gateway/orders/working could not be reached." },
});

/** Replay a script of probe outcomes and read the decision after each. */
function replay(
  script: ProbeOutcome<WorkingOrderRow[]>[],
  source: "live" | "sandbox" | "unavailable" = "live",
): WorkingOrdersFeedView[] {
  const machine = new DeskSourceMachine<WorkingOrderRow[]>();
  return script.map((outcome) => {
    machine.observe(outcome);
    return workingOrdersFeedView(source, machine.state);
  });
}

describe("measured resting orders are never replaced by a claim or a fiction", () => {
  it("one failed poll keeps the rows on screen, marked stale", () => {
    const [, view] = replay([ok(), down()]);
    assert.equal(view.kind, "measured");
    if (view.kind !== "measured") return;
    assert.equal(view.stale, true);
    assert.equal(view.rows.length, ROWS.length, "a failed poll must not empty the table");
  });

  it("no run of failures, however long, reaches an empty or generated state", () => {
    const views = replay([ok(), down(), down(), down(), down(), down()]);
    for (const view of views) assert.equal(view.kind, "measured");
  });

  it("a live feed that has never answered is a failure, not a quiet desk", () => {
    // The old panel rendered "Nothing is resting. Every accepted order so far
    // filled at once" here — a positive claim from zero evidence. The decision
    // now has a distinct state for it, so the quiet-desk copy is unreachable
    // without a measured read behind it.
    const [view] = replay([down()]);
    assert.equal(view.kind, "failed");
    if (view.kind !== "failed") return;
    assert.match(view.message, /orders\/working/);
  });

  it("a measured empty book is the only state allowed to say the desk is quiet", () => {
    const [view] = replay([ok([])]);
    assert.equal(view.kind, "measured");
    if (view.kind !== "measured") return;
    assert.equal(view.rows.length, 0);
    assert.equal(view.stale, false);
  });
});

describe("an alternating gateway settles on one decision instead of flapping", () => {
  it("pass/fail/pass/fail renders stale throughout, not a banner toggling at 5s", () => {
    const views = replay([ok(), down(), ok(), down(), ok(), down(), ok()]);
    const afterFirstFailure = views.slice(1);
    const decisions = new Set(
      afterFirstFailure.map((view) => `${view.kind}:${view.kind === "measured" ? view.stale : ""}`),
    );
    assert.deepEqual(
      [...decisions],
      ["measured:true"],
      "a gateway you can only reach half the time reads as one stable stale state",
    );
  });

  it("recovery needs the promotion streak, and then sticks", () => {
    const views = replay([ok(), down(), ok(), ok(), ok()]);
    const staleness = views.map((view) => (view.kind === "measured" ? view.stale : null));
    // fail demotes at once; one success is not recovery; two are; it holds.
    assert.deepEqual(staleness, [false, true, true, false, false]);
  });

  it("a fresh success updates the reading without touching the decision", () => {
    const machine = new DeskSourceMachine<WorkingOrderRow[]>();
    machine.observe(ok());
    machine.observe(down());
    machine.observe(ok(ROWS.slice(0, 1)));
    const view = workingOrdersFeedView("live", machine.state);
    assert.equal(view.kind, "measured");
    if (view.kind !== "measured") return;
    assert.equal(view.stale, true, "one success after a failure is not yet recovery");
    assert.equal(view.rows.length, 1, "but the rows themselves are the newest reading");
  });
});

describe("the source prop maps onto the machine's vocabulary, not around it", () => {
  it("sandbox is generated whatever the probes said", () => {
    for (const view of replay([ok(), down(), down()], "sandbox")) {
      assert.equal(view.kind, "generated");
    }
  });

  it("before the first probe settles the panel is connecting, not asserting", () => {
    const machine = new DeskSourceMachine<WorkingOrderRow[]>();
    assert.equal(workingOrdersFeedView("live", machine.state).kind, "connecting");
  });

  it("unavailable with a reading behind it keeps the reading, marked stale", () => {
    const machine = new DeskSourceMachine<WorkingOrderRow[]>();
    machine.observe(ok());
    const view = workingOrdersFeedView("unavailable", machine.state);
    assert.equal(view.kind, "measured");
    if (view.kind !== "measured") return;
    assert.equal(view.stale, true, "a book that cannot be refreshed must not read as live");
  });

  it("unavailable with no reading says so, and never generates one", () => {
    const machine = new DeskSourceMachine<WorkingOrderRow[]>();
    assert.equal(workingOrdersFeedView("unavailable", machine.state).kind, "unavailable");
    machine.observe(down());
    assert.equal(workingOrdersFeedView("unavailable", machine.state).kind, "unavailable");
  });
});

describe("the component renders the machine's decision, not a second copy of it", () => {
  const orders = code(read("components/portfolio/WorkingOrders.tsx"));
  const positions = code(read("components/portfolio/PositionsSection.tsx"));

  it("routes the feed through useDeskSource and the decision function", () => {
    assert.match(orders, /useDeskSource<WorkingOrderRow\[\]>/);
    assert.match(orders, /workingOrdersFeedView\(source, feedState\)/);
  });

  it("keeps no shadow rows or feed-error state beside the machine", () => {
    // The twin `useState` pair is the twitch: whichever copy updated last wins
    // the render, and a failed poll toggled them against each other.
    assert.doesNotMatch(orders, /useState<WorkingOrderRow/);
    assert.doesNotMatch(orders, /setError\(/, "feed failures belong to the machine; only action results may keep state");
  });

  it("lets a failed poll reach the polling controller so backoff engages", () => {
    // `PollingController` backs off on a rejected tick. A tick that swallows
    // the failure polls a refusing gateway at full cadence forever.
    assert.match(orders, /if \(!outcome\.ok\) throw/);
  });

  it("the quiet-desk claim renders only from a measured read", () => {
    const claim = orders.indexOf("Nothing is resting");
    assert.notEqual(claim, -1, "the measured empty state still says the desk is quiet");
    const decision = orders.indexOf('feedView.kind === "measured"');
    assert.notEqual(decision, -1);
    assert.ok(decision < claim, "the claim must sit behind the measured branch of the decision");
  });

  it("PositionsSection hands the panel the book's own source, never a third state", () => {
    // `isStale` used to map to source="unavailable", which made the panel say
    // "No gateway in this deployment" during an outage on a deployment that
    // has one — while BookChrome, reading the same fact, said "stale". One
    // fact, one vocabulary: the book is sandbox or live, and staleness is the
    // feed machine's own finding.
    assert.match(positions, /source=\{book\.sandbox \? "sandbox" : "live"\}/);
  });
});
