/**
 * The twitch, pinned.
 *
 * Every assertion here corresponds to a state the desk actually reached. The
 * headline one is `a flapping gateway never alternates live and sandbox`: the
 * cockpit called `setBook(null)` on a failed probe, so its `mode` fell to
 * `"sandbox"` and the whole surface — blotter, alerts, P&L strip — swapped to
 * a generated desk, then swapped back on the next good poll, at a 4s cadence.
 *
 * None of this was reachable by the unit suite before, because the decision
 * lived inside a hook: seeing it required mounting React and simulating a
 * network that fails intermittently. Against the machine it is a scripted list
 * of outcomes and a read of `.state`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DeskSourceMachine, PROMOTION_STREAK, type ProbeOutcome } from "../lib/desk-source";

interface Book { equity: number }

const ok = (equity: number): ProbeOutcome<Book> => ({ ok: true, payload: { equity } });
const down = (code?: string): ProbeOutcome<Book> => ({
  ok: false,
  failure: { code, message: "gateway did not answer" },
});

/** A machine with a clock the test controls, so `lastGoodAt` is assertable. */
function machine(options: { promotionStreak?: number } = {}) {
  let now = 1_000;
  const m = new DeskSourceMachine<Book>({ ...options, now: () => now });
  return { m, tick: (ms: number) => { now += ms; }, at: () => now };
}

/** Replay a string of outcomes and collect the tier after each. */
function tiers(m: DeskSourceMachine<Book>, script: ProbeOutcome<Book>[]): string[] {
  return script.map((outcome) => {
    m.observe(outcome);
    return m.state.tier;
  });
}

describe("measured data is never replaced by generated data", () => {
  it("a failure after a good reading is cached, not sandbox", () => {
    const { m } = machine();
    m.observe(ok(100));
    m.observe(down());
    const { showing, tier } = m.state;
    assert.equal(tier, "cached");
    assert.equal(showing.kind, "measured");
    // The point: the numbers on screen are still the ones the gateway sent.
    assert.deepEqual(showing.kind === "measured" ? showing.payload : null, { equity: 100 });
  });

  it("no run of failures, however long, reaches the sandbox once a reading exists", () => {
    const { m } = machine();
    m.observe(ok(100));
    for (let i = 0; i < 50; i += 1) m.observe(down());
    assert.equal(m.state.tier, "cached");
    assert.equal(m.state.showing.kind, "measured");
  });

  it("the cockpit's flap — live, sandbox, live, sandbox — is now unreachable", () => {
    const { m } = machine();
    // The exact sequence a gateway dropping every other poll produces.
    const observed = tiers(m, [ok(100), down(), ok(101), down(), ok(102), down()]);
    assert.ok(!observed.includes("sandbox"), `tier reached sandbox: ${observed.join(" → ")}`);
  });
});

describe("demotion is immediate, promotion is not", () => {
  it("one failure demotes at once", () => {
    const { m } = machine();
    m.observe(ok(100));
    assert.equal(m.state.tier, "live");
    m.observe(down());
    assert.equal(m.state.tier, "cached", "demotion must not wait — writes lock in cached");
  });

  it("a flapping gateway settles at cached and stays there", () => {
    const { m } = machine();
    const observed = tiers(m, [
      ok(1), down(), ok(2), down(), ok(3), down(), ok(4), down(), ok(5), down(),
    ]);
    // Only the very first reading is live; everything after the first failure
    // is cached, with no alternation. That is the anti-twitch property.
    assert.deepEqual(observed, [
      "live", "cached", "cached", "cached", "cached",
      "cached", "cached", "cached", "cached", "cached",
    ]);
  });

  it("a genuinely recovered gateway returns to live after the streak", () => {
    const { m } = machine();
    m.observe(ok(100));
    m.observe(down());
    for (let i = 1; i < PROMOTION_STREAK; i += 1) {
      m.observe(ok(100 + i));
      assert.equal(m.state.tier, "cached", `promoted after only ${i} success(es)`);
    }
    m.observe(ok(999));
    assert.equal(m.state.tier, "live");
  });

  it("a failure inside the streak restarts it", () => {
    const { m } = machine({ promotionStreak: 3 });
    m.observe(ok(1));
    m.observe(down());
    m.observe(ok(2));
    m.observe(ok(3));
    m.observe(down());     // two-thirds of the way back, and it drops again
    m.observe(ok(4));
    m.observe(ok(5));
    assert.equal(m.state.tier, "cached", "the streak must count from the last failure");
    m.observe(ok(6));
    assert.equal(m.state.tier, "live");
  });

  it("a healthy gateway is live from its first reading and never leaves", () => {
    const { m } = machine();
    const observed = tiers(m, [ok(1), ok(2), ok(3), ok(4)]);
    assert.deepEqual(observed, ["live", "live", "live", "live"]);
  });
});

describe("the sandbox is reachable only with no reading, or by choice", () => {
  it("a first probe that fails with no gateway generates, and says so", () => {
    const { m } = machine();
    m.observe(down("gateway_not_configured"));
    const { showing, tier, cause } = m.state;
    assert.equal(tier, "sandbox");
    assert.equal(showing.kind, "generated");
    assert.equal(cause, "not-configured");
  });

  it("a first probe that fails for any other reason is an incident, not a configuration", () => {
    const { m } = machine();
    m.observe(down());
    assert.equal(m.state.cause, "incident");
  });

  it("an explicit sandbox choice outranks a perfectly healthy gateway", () => {
    const { m } = machine();
    m.observe(ok(100));
    assert.equal(m.state.tier, "live");
    m.choose("sandbox");
    assert.equal(m.state.tier, "sandbox");
    assert.equal(m.state.cause, "chosen");
    // And no amount of successful polling takes it back.
    m.observe(ok(101));
    m.observe(ok(102));
    assert.equal(m.state.cause, "chosen");
  });

  it("an incident sandbox leaves on its own once a reading arrives", () => {
    const { m } = machine();
    m.observe(down());
    assert.equal(m.state.showing.kind, "generated");
    m.observe(ok(100));
    assert.equal(m.state.tier, "live");
    assert.equal(m.state.showing.kind, "measured");
  });

  it("pressing Live on a desk with no reading gets a card, never a fiction", () => {
    const { m } = machine();
    m.choose("live");
    m.observe(down());
    const { showing } = m.state;
    assert.equal(showing.kind, "empty", "a chosen Live desk must not generate");
    assert.equal(showing.kind === "empty" ? showing.failure?.message : null, "gateway did not answer");
  });

  it("a restored choice binds exactly as a fresh click does", () => {
    const { m } = machine();
    m.restore("sandbox");
    m.observe(ok(100));
    assert.equal(m.state.cause, "chosen");
    m.release();
    assert.equal(m.state.tier, "live", "released, the probe decides again");
  });
});

describe("nothing is asserted before the first probe settles", () => {
  it("settled is false, and there is nothing to show", () => {
    const { m } = machine();
    assert.equal(m.state.settled, false);
    assert.equal(m.state.showing.kind, "empty");
    // The badge previously read "Sandbox; no gateway here" here — a conclusion
    // with no evidence, contradicted a moment later when the probe landed.
    assert.equal(m.state.cause, null);
  });

  it("settled turns true on the first outcome, success or failure", () => {
    const { m } = machine();
    m.observe(down());
    assert.equal(m.state.settled, true);
  });

  it("an unsettled desk cannot write", () => {
    const { m } = machine();
    // `writesEnabled` is live-only, and an empty desk reports sandbox for
    // exactly this reason.
    assert.notEqual(m.state.tier, "live");
  });
});

describe("lastGoodAt is the age cached data is carried with", () => {
  it("stamps the moment the backend actually answered, not the moment it failed", () => {
    const { m, tick, at } = machine();
    m.observe(ok(100));
    const good = at();
    tick(40_000);
    m.observe(down());
    assert.equal(m.state.lastGoodAt?.getTime(), good);
  });

  it("moves forward on every success", () => {
    const { m, tick, at } = machine();
    m.observe(ok(100));
    tick(15_000);
    m.observe(ok(101));
    assert.equal(m.state.lastGoodAt?.getTime(), at());
  });

  it("is null until something has answered", () => {
    const { m } = machine();
    m.observe(down());
    assert.equal(m.state.lastGoodAt, null);
  });
});

/**
 * Source-pinned, in the house style: the machine makes the twitch
 * unrepresentable, but only for a hook that actually routes through it. A
 * surface that grew its own copy of the decision would pass every test above
 * and reintroduce the defect.
 */
describe("both desk surfaces read the one machine", () => {
  const read = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  /** Comments stripped: a comment explaining a removal must not fail its own test. */
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

  const cockpit = code(read("../components/execution/use-cockpit-feed.ts"));
  const book = code(read("../lib/use-book.ts"));

  it("neither hook discards its last good payload on a failed probe", () => {
    // The defect verbatim: a failed poll called `setBook(null)`, which dropped
    // `mode` to "sandbox" and swapped the whole cockpit to a generated desk at
    // the 4s poll cadence — and with it the ticket's `judge`, so which order
    // path a click took was decided by the last packet.
    assert.doesNotMatch(cockpit, /setBook\(\s*null\s*\)/);
    assert.doesNotMatch(book, /setPortfolio\(\s*null\s*\)/);
  });

  it("both reach the machine through the shared hook, not a private copy", () => {
    for (const [name, source] of [["cockpit", cockpit], ["book", book]] as const) {
      assert.match(source, /useDeskSource|DeskSourceMachine/, `${name} bypasses the machine`);
    }
  });

  it("the sandbox seed is not resolved while the session probe is still out", () => {
    // Seeding on a not-yet-known identity generated a guest desk and then
    // replaced it with the account's, changing every number under the reader.
    assert.match(book, /session\.status === "loading"/);
  });

  it("the cockpit does not stamp a sync time from a failed probe", () => {
    // `setLastSyncAt(new Date())` ran at the end of every refresh, so the one
    // figure that could reveal a stale desk was the one guaranteed to look
    // fresh. It reads the machine's `lastGoodAt` now.
    assert.doesNotMatch(cockpit, /setLastSyncAt/);
  });
});
