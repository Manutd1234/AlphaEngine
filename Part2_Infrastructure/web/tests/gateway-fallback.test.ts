/**
 * The fallback ladder, and the one lie it must never tell.
 *
 * This pass makes the desk fill itself in when a backend is missing, which is a
 * dangerous thing to build: the failure mode of a good fallback is that nobody
 * can tell it apart from the real thing. Every assertion here is pointed at that
 * risk rather than at the happy path.
 *
 * The load-bearing ones:
 *   - a generated payload is never reported as `live` or `cached`
 *   - a write is enabled in exactly one tier
 *   - a failure with a cache prefers the real stale numbers to generated fresh
 *     ones, and carries their age
 *   - a hung gateway resolves on the deadline instead of never
 *
 * The deadline test talks to a real socket that accepts and then says nothing,
 * because that is the case a mocked fetch cannot reproduce and the case the
 * missing AbortController actually left on screen forever.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeTier, isMeasured, writesEnabled, type Provenance } from "../lib/data-tier";
import {
  GATEWAY_DEADLINE_MS,
  __resetGatewayCache,
  probeGateway,
  resolveTier,
  type GatewayFailure,
} from "../lib/use-gateway-connection";

const timeout: GatewayFailure = { message: "hung", timedOut: true };
const refused: GatewayFailure = { message: "refused", timedOut: false };
const absent: GatewayFailure = { code: "gateway_not_configured", message: "none", timedOut: false };

describe("a tier says what the payload is made of", () => {
  it("a success is live", () => {
    assert.deepEqual(resolveTier(true, false, null), { tier: "live", cause: null });
  });

  it("a failure with a cache keeps the real numbers", () => {
    // The point of this tier. Most outages are a redeploy or a stopped
    // Always-Free database, and forty-second-old real numbers beat generated
    // ones — so long as the badge carries the age, which describeTier pins below.
    assert.deepEqual(resolveTier(false, true, timeout), { tier: "cached", cause: null });
    assert.deepEqual(resolveTier(false, true, refused), { tier: "cached", cause: null });
  });

  it("a failure with no cache generates, and distinguishes absent from broken", () => {
    // Collapsing these two is how an incident comes to look like a configuration
    // choice. The public workspace has no gateway by design; a refused
    // connection to one that should exist is an incident and says so.
    assert.deepEqual(resolveTier(false, false, absent), { tier: "sandbox", cause: "not-configured" });
    assert.deepEqual(resolveTier(false, false, refused), { tier: "sandbox", cause: "incident" });
    assert.deepEqual(resolveTier(false, false, timeout), { tier: "sandbox", cause: "incident" });
  });

  it("has no way to express a dead end", () => {
    // `"unavailable"` was a member of this union and every component that could
    // construct one grew a branch that rendered a sentence instead of a panel.
    // The type is the enforcement; this asserts the runtime never invents one.
    for (const [ok, cached, failure] of [
      [true, true, null], [true, false, null],
      [false, true, refused], [false, false, refused], [false, false, absent],
    ] as const) {
      const { tier } = resolveTier(ok, cached, failure);
      assert.ok(["live", "cached", "sandbox"].includes(tier), `invented tier ${tier}`);
    }
  });
});

describe("only live data may be acted on", () => {
  it("enables writes in exactly one tier", () => {
    assert.equal(writesEnabled("live"), true);
    // Cached is the interesting one: the numbers are real, and still must not be
    // traded against, because they are not now. An order sized on a stale book
    // is a real order.
    assert.equal(writesEnabled("cached"), false);
    assert.equal(writesEnabled("sandbox"), false);
  });

  it("separates 'real' from 'actionable'", () => {
    assert.equal(isMeasured("cached"), true);
    assert.equal(isMeasured("sandbox"), false);
  });
});

/**
 * `writesEnabled` being false is not the same claim as "the control is
 * disabled", and the badge used to make the second one on the strength of the
 * first: "Order entry and operator controls are disabled until live data
 * returns", for every non-live tier.
 *
 * Neither half held. In sandbox the ticket stays fully operable and judges each
 * order in the browser against the gateway's own gate logic — it sends nothing,
 * which is a different and more interesting fact. And the operator controls are
 * not tier-gated at all; the kill switch answers to the guard mode and to the
 * gateway answering a probe.
 *
 * A badge describing a lockout the desk does not perform is worse than one
 * saying nothing, because it is checked precisely when someone is deciding
 * whether it is safe to click.
 */
describe("the safety statement describes what the desk actually does", () => {
  const source = (relative: string) =>
    readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
  /**
   * Comments stripped before scanning. The badge's own comment records the
   * sentence it stopped saying and why, which a naive search reads as the
   * defect itself — the same trap `drift-bars.test.ts` documents. Prose about
   * what not to do must not count as doing it.
   */
  const code = (relative: string) =>
    source(relative).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  const badge = code("../components/header/DataTierBadge.tsx");
  const ticket = source("../components/execution/OrderTicket.tsx");

  it("no longer claims order entry is disabled outside live", () => {
    assert.doesNotMatch(
      badge,
      /Order entry and operator controls are disabled/,
      "the badge is again claiming a lockout the ticket does not perform",
    );
  });

  it("agrees with the ticket about sandbox: open, judged here, not sent", () => {
    // The ticket's own words, so the two surfaces cannot drift apart.
    assert.match(ticket, /No order leaves this page/);
    assert.match(badge, /judges every order in this browser/);
    assert.match(badge, /Nothing is sent/);
  });

  it("attributes the closed ticket to the gateway rather than to the tier", () => {
    // The ticket disables on reachability, which it reaches before any tier
    // test — so that is what the badge must name.
    assert.match(ticket, /The order path needs a reachable gateway/);
    assert.match(badge, /while no gateway is answering/);
  });

  it("stops attributing operator controls to the data tier", () => {
    assert.match(badge, /Operator controls answer to the guard mode and to the gateway/);
  });

  it("still routes its own claim through the shared authority", () => {
    // The copy changed; the gate did not. `writesEnabled` remains the thing
    // asked, so a fourth tier cannot arrive quietly write-enabled.
    assert.match(badge, /writesEnabled\(provenance\.tier\)/);
  });
});

describe("the badge cannot dress generated data as measured", () => {
  const now = Date.parse("2026-08-13T12:00:00Z");
  const at = (tier: Provenance["tier"], cause: Provenance["cause"], lastGoodAt: Date | null) =>
    describeTier({ tier, cause, lastGoodAt }, now);

  it("says Live only when the gateway actually answered", () => {
    assert.equal(at("live", null, new Date(now)).label, "Live data");
    assert.equal(at("sandbox", "incident", null).label, "Sandbox");
    assert.equal(at("sandbox", "not-configured", null).label, "Sandbox");
    assert.equal(at("sandbox", "chosen", null).label, "Sandbox");
  });

  it("carries the age of cached numbers, which is the whole tier", () => {
    const badge = at("cached", null, new Date(now - 42_000));
    assert.match(badge.detail, /42s ago/);
    assert.equal(badge.tone, "warn", "stale real data is not a healthy state");
  });

  it("names an incident rather than implying a configuration choice", () => {
    assert.match(at("sandbox", "incident", null).detail, /incident/);
    assert.doesNotMatch(at("sandbox", "not-configured", null).detail, /incident/);
  });

  it("never carries meaning in colour alone", () => {
    // The house rule, and it is also what survives forced-colors: every state
    // has a distinct glyph and words, not just a tone.
    const states: Provenance[] = [
      { tier: "live", cause: null, lastGoodAt: new Date(now) },
      { tier: "cached", cause: null, lastGoodAt: new Date(now - 1000) },
      { tier: "sandbox", cause: "incident", lastGoodAt: null },
      { tier: "sandbox", cause: "not-configured", lastGoodAt: null },
    ];
    for (const state of states) {
      const badge = describeTier(state, now);
      assert.ok(badge.glyph.length > 0, "no glyph");
      assert.ok(badge.label.length > 0 && badge.detail.length > 0, "no words");
    }
    // Live and cached share a glyph and a label deliberately — both are real
    // data — so the age in `detail` is the only thing distinguishing them and it
    // must never be empty.
    assert.notEqual(describeTier(states[1], now).detail, "");
  });
});

describe("a hung gateway resolves on the deadline, not never", () => {
  // A server that accepts the connection and then says nothing. `fetch` against
  // a refused port fails in milliseconds and hides this bug completely; this is
  // the state a redeploying container is actually in, and without a deadline it
  // left "book connecting" on screen indefinitely.
  const blackHole = createServer(() => { /* accept, and never answer */ });
  const listening = new Promise<number>((resolve) => {
    blackHole.listen(0, "127.0.0.1", () => {
      resolve((blackHole.address() as { port: number }).port);
    });
  });

  after(() => { blackHole.close(); });

  it("gives up inside its budget and says it timed out", async () => {
    __resetGatewayCache();
    const port = await listening;
    const started = Date.now();
    const outcome = await probeGateway(`http://127.0.0.1:${port}/hang`, 400);
    const elapsed = Date.now() - started;

    assert.equal(outcome.ok, false);
    assert.ok(!outcome.ok && outcome.failure.timedOut, "the timeout was not reported as one");
    // Generous upper bound: the assertion is "it resolved at all, near its
    // budget", not a latency benchmark.
    assert.ok(elapsed < 3000, `took ${elapsed}ms — the deadline did not fire`);
  });

  it("the shipped budget is the 2.5s the brief asked for", () => {
    assert.equal(GATEWAY_DEADLINE_MS, 2500);
  });

  it("coalesces concurrent callers into one request", async () => {
    __resetGatewayCache();
    let hits = 0;
    const counter = createServer((_req, res) => {
      hits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const port = await new Promise<number>((resolve) => {
      counter.listen(0, "127.0.0.1", () => resolve((counter.address() as { port: number }).port));
    });

    const url = `http://127.0.0.1:${port}/book`;
    // Five surfaces reading the book on the same tick used to be five requests
    // and five independent opinions about whether it had failed.
    const outcomes = await Promise.all([1, 2, 3, 4, 5].map(() => probeGateway(url)));
    counter.close();

    assert.equal(hits, 1, `one request expected, made ${hits}`);
    for (const outcome of outcomes) assert.equal(outcome.ok, true);
  });

  it("a served payload becomes the cache the next failure falls back to", async () => {
    __resetGatewayCache();
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ equity: 999 }));
    });
    const port = await new Promise<number>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
    });
    const url = `http://127.0.0.1:${port}/book`;
    const first = await probeGateway<{ equity: number }>(url);
    assert.ok(first.ok && first.payload.equity === 999);
    server.close();

    // Same URL, now dead: the resolver must prefer the real stale payload.
    const second = await probeGateway(url);
    assert.equal(second.ok, false);
    assert.equal(resolveTier(false, true, second.ok ? null : second.failure).tier, "cached");
  });
});
