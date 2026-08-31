/**
 * The Data tab against a flapping gateway: what a failed poll may change.
 *
 * The house rule is `DeskSourceMachine`'s pair — measured data is never
 * replaced by generated data, and demotion is immediate while promotion needs
 * a streak — plus `PollingController`'s: a failing loop backs off instead of
 * hammering. Every polled surface on this tab is asked the same two
 * questions here: what happens on one failed poll, and what happens on an
 * alternating pass/fail sequence.
 *
 * Verdict-level flapping is NOT asserted against, deliberately.
 * `deriveDataTrust`'s "Evidence unreachable" on `healthError` is the
 * failure-banner class — `desk-source.ts` documents that `failure` is cleared
 * by any success so it describes the current condition — and
 * `data-trust.test.ts` pins that behaviour by name ("treats a failed health
 * refresh as unreachable even with a retained snapshot"). The tier-like
 * states are what must not track the last packet.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeskSourceMachine, PROMOTION_STREAK } from "../lib/desk-source";
import { PollingController } from "../lib/polling";

import { fakeClock } from "./helpers/fake-clock";
import { readSource, stripCode } from "./helpers/source-files";

const panel = readSource("components/data/ReplayBackfillPanel.tsx");
const dataConsole = readSource("components/DataConsole.tsx");
const queueHook = readSource("lib/use-data-work-queue.ts");

// --------------------------------------------------------------------------
// Replay & backfill: the poll must hear its own failures
// --------------------------------------------------------------------------

describe("the replay/backfill poll backs off on a dead gateway and recovers", () => {
  it("fail, fail, pass: the cadence stretches and then snaps back", async () => {
    // The panel's own numbers: the console's default 30s cadence and the
    // panel's 300s ceiling. The tick follows the panel's contract — a load
    // that reached the gateway resolves, one that found it dead rejects.
    const script = [false, false, true, true];
    const h = fakeClock();
    const loop = new PollingController({
      intervalMs: 30_000,
      maxBackoffMs: 300_000,
      tick: () => {
        if (!script.shift()) throw new Error("gateway down");
      },
      environment: h.environment,
    });
    loop.start();

    await h.advance(30_000);
    assert.equal(loop.consecutiveFailures, 1);
    assert.equal(loop.nextDelayMs(), 60_000, "one failure did not slow the loop");

    await h.advance(60_000);
    assert.equal(loop.consecutiveFailures, 2);
    assert.equal(loop.nextDelayMs(), 120_000, "the backoff is not geometric");

    await h.advance(120_000);
    assert.equal(loop.consecutiveFailures, 0);
    assert.equal(loop.nextDelayMs(), 30_000, "a recovered gateway stayed slow");
    loop.stop();
  });

  it("the panel's tick reports a total read failure instead of swallowing it", () => {
    /**
     * `PollingController` counts a REJECTION as the failure that drives its
     * backoff. A tick that catches everything and files it into state leaves
     * `maxBackoffMs: 300_000` configured but unreachable, so a dead gateway
     * is polled at full cadence — 1s on the console's debugging cadence —
     * for the life of the tab. The wrapper pattern is `useSystemHealth`'s:
     * `load` itself stays quiet so the mount read and the post-submit
     * re-read cannot become unhandled rejections; only the poll tick throws.
     */
    const stripped = stripCode(panel);
    assert.match(stripped, /return j\.ok \|\| s\.ok;/,
      "load no longer reports whether the gateway answered");
    assert.match(
      stripped,
      /tick:\s*async \(\) => \{\s*if \(!\(await load\(\)\)\) throw new Error/,
      "the poll tick swallows failures, so the configured backoff never engages",
    );
    assert.match(stripped, /maxBackoffMs:\s*300_000/);
  });

  it("one failed poll never discards the measured job and schedule tables", () => {
    // Rule 1, panel-shaped: the failure branches set the error strings and
    // nothing else. Clearing either table on failure would swap a measured
    // list for an empty state on every dropped poll.
    const stripped = stripCode(panel);
    assert.doesNotMatch(stripped, /setJobs\(null\)/,
      "a failed poll clears the measured job table");
    assert.doesNotMatch(stripped, /setSchedules\(null\)/,
      "a failed poll clears the measured schedule table");
    // And the retained-table case still names what the failure does not
    // prove, beside the data it kept.
    assert.match(panel, /Nothing here says the queue is empty\./);
  });
});

// --------------------------------------------------------------------------
// The work-queue source pill: the tier-like state on this tab
// --------------------------------------------------------------------------

describe("the work-queue source pill must not alternate with its gateway", () => {
  it("the machine the pill needs settles at demoted under an alternating gateway", () => {
    // The board pill reads "Persisted on the gateway" or "Gateway
    // unreachable — edits held locally", and the Persistence tile and scope
    // paragraph repeat it. That is a tier badge, and this is the sequence it
    // must survive: demotion on the first failure, no promotion on a single
    // success, stability while the gateway answers every other poll.
    const machine = new DeskSourceMachine<string[]>({ now: () => 0 });

    machine.observe({ ok: true, payload: ["WQ-1"] });
    assert.equal(machine.state.tier, "live");

    machine.observe({ ok: false, failure: { message: "gateway unreachable" } });
    assert.equal(machine.state.tier, "cached", "demotion must be immediate");
    assert.equal(machine.state.showing.kind, "measured",
      "the held list itself must survive the failed load");

    machine.observe({ ok: true, payload: ["WQ-1"] });
    assert.equal(machine.state.tier, "cached",
      "one success promoted the pill — this is the once-a-minute flap");

    machine.observe({ ok: false, failure: { message: "gateway unreachable" } });
    machine.observe({ ok: true, payload: ["WQ-1"] });
    assert.equal(machine.state.tier, "cached",
      "an alternating gateway must settle at demoted, not oscillate");

    machine.observe({ ok: true, payload: ["WQ-1"] });
    assert.equal(PROMOTION_STREAK, 2);
    assert.equal(machine.state.tier, "live",
      "a genuine recovery must promote after the streak");
  });

  it("lib/use-data-work-queue routes its source decision through the machine", () => {
    const source = stripCode(queueHook);
    assert.match(source, /useDeskSource<DataWorkItem\[\]>/,
      "the work queue bypasses the shared anti-flap source machine");
    assert.match(source, /sourceState\.tier === "live" && gatewaySource/,
      "one successful probe can promote the visible source directly");
    assert.match(source, /return pollingFailure\(result\.reason\)/,
      "a failed load resolves as success, so maxBackoffMs is unreachable");
    assert.match(source, /tick: loadOnce/,
      "the polling loop does not receive the typed load failure");
    assert.match(source, /immediate: true/,
      "the first failed load happens outside the controller and cannot start backoff");
  });

  it("a failed first read leaves the browser queue empty instead of seeding facts", () => {
    const source = stripCode(queueHook);
    assert.match(source, /useState<DataWorkItem\[\]>\(\[\]\)/,
      "the browser still starts from a populated queue before the gateway answers");
    assert.doesNotMatch(source, /createInitialDataWorkItems|DATA_WORK_SEEDS/);
    assert.doesNotMatch(stripCode(readSource("lib/data-work-queue.ts")), /BUG-091|REQ-184/,
      "the production data client still embeds the fallback queue");
  });
});

// --------------------------------------------------------------------------
// One probe identity on the Data console
// --------------------------------------------------------------------------

describe("every panel reads the same, symbol-gated probe evidence", () => {
  const stripped = stripCode(dataConsole);

  it("the probe trio is gated on the symbol it was fetched for", () => {
    // Effects run after render: during the render between a symbol change
    // and the effect that clears the probe, the raw state still belongs to
    // the previous symbol. The gate is what stops a BTC heading briefly
    // inheriting AAPL's contract result.
    assert.match(stripped, /const currentProbe = probeSymbol === workspaceSymbol \? probe : null;/);
    assert.match(stripped, /const currentProbeError = probeSymbol === workspaceSymbol \? probeError : null;/);
    assert.match(stripped, /const currentProbeLoading = probeSymbol !== workspaceSymbol \|\| probeLoading;/);
  });

  it("no consumer reads the raw probe state past the gate", () => {
    // Both DataTrustOverview mounts, the verdict derivation and the metrics
    // all take the gated trio. A second consumer of the raw state is how two
    // panels come to disagree about the same fact.
    assert.doesNotMatch(stripped, /probe=\{probe\}/);
    assert.doesNotMatch(stripped, /probeError=\{probeError\}/);
    assert.doesNotMatch(stripped, /probeLoading=\{probeLoading\}/);
    const gatedMounts = stripped.match(/probe=\{currentProbe\}/g) ?? [];
    assert.equal(gatedMounts.length, 2,
      "both DataTrustOverview mounts must read the gated probe");
    assert.match(stripped, /probe: currentProbe/,
      "the verdict derivation must read the gated probe");
  });

  it("a superseded probe answer can never win the state", () => {
    // The sequence guard and the unmount abort: a slow answer for the old
    // symbol resolving after a new request must be dropped, not rendered.
    assert.match(stripped, /if \(sequence !== probeSequence\.current\) return;/);
    assert.match(stripped, /activeProbeRequest\.current\?\.abort\(\);/);
    // And the payload's own identity is checked against the request, so a
    // proxy answering with the wrong instrument is an error, not evidence.
    assert.match(stripped, /next\.symbol !== workspaceSymbol \|\| next\.capability !== "quote"/);
  });
});
