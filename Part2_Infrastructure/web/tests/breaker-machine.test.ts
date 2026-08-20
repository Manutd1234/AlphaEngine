/**
 * The state-machine diagram, and the edge that must never be drawn.
 *
 * A diagram is the easiest place in a codebase to assert something false,
 * because it looks like documentation rather than a claim. The last one on this
 * desk drew a FIX protocol engine that does not exist, with four hardcoded
 * latencies, and it was deleted. So the properties here are about the gap
 * between the textbook breaker and this one: the canonical
 * `half_open → open` arrow is WRONG for this implementation, and drawing it
 * would be the same defect wearing a different picture.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const machine = read("../components/systems/BreakerStateMachine.tsx");
const ledger = read("../components/systems/RemediationLedger.tsx");
/**
 * `OperatorPanel` passed the length ceiling and was cut along the blast-radius
 * seam its two group headings already drew: the five guarded server mutations
 * moved to `OperatorControls`, the browser-only ones to `SessionControls`. The
 * panel kept authorisation, the confirmation state and the dispatch.
 *
 * So the assertions below read the file their subject is now in, and the ones
 * that forbid a sentence ANYWHERE on the pane read `operatorSurface`: scoped to
 * the shell alone they would pass by scanning a file that no longer contains
 * what they guard, which is the exact failure this suite has been bitten by.
 */
const operator = read("../components/systems/OperatorPanel.tsx");
const operatorControls = read("../components/systems/OperatorControls.tsx");
const sessionControls = read("../components/systems/SessionControls.tsx");
const operatorSurface = [operator, operatorControls, sessionControls].join("\n");
/**
 * Re-anchored when `lib/providers/runtime.ts` was split into one file per
 * mechanism. `runtime.ts` is now a re-export barrel, so a scan left pointing
 * at it would match nothing and pass — the exact failure this suite has been
 * bitten by. Every assertion below re-checks that it is reading the real
 * implementation before it checks anything else.
 */
const breaker = read("../lib/providers/breaker.ts");

const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

/**
 * What a reader sees before opening anything: every `<details>` block removed.
 * This is the check that matters for the P1 rule — the desk sweep measures
 * `innerText`, which does not include collapsed content, so anything that has
 * to be read must survive this.
 */
const uncollapsed = (source: string) =>
  code(source).replace(/<details[\s\S]*?<\/details>/g, "");

describe("the diagram matches the implementation, not the textbook", () => {
  it("still has no half-open to open transition in the runtime", () => {
    /**
     * The guard for the whole diagram. `breakerOpen` zeroes the failure count
     * when the cooldown elapses, so a failed probe re-counts from one and three
     * fresh failures are needed to re-open. If that ever changes, this test
     * fails and the diagram must gain an edge — rather than the diagram
     * quietly describing a machine the code stopped being.
     */
    assert.match(breaker, /export function breakerOpen\(/, "the scan is reading the wrong file");
    assert.match(breaker, /failures: 0, openedAt: null, probing: true/);
    // Whitespace-tolerant: the sentence wraps across a comment line break.
    assert.match(breaker, /re-counts[\s\S]{0,24}from one/);
  });

  it("emits the exact state words the remediation ledger filters on", () => {
    /**
     * `lib/remediation.ts` pairs breaker events into incidents by matching
     * `fields.state` against the literals "open" and "closed". Emitter and
     * filter are in different files with no shared type between them, so a
     * rename on either side is silent: the breaker keeps working, every event
     * keeps being written, and the ring renders empty. Both halves are pinned
     * here, together, because neither is a check on its own.
     */
    const writers = breaker.match(/fields: \{ provider: id, state: "/g) ?? [];
    assert.equal(writers.length, 4, "a breaker writer site stopped emitting fields.state");
    assert.match(breaker, /fields: \{ provider: id, state: "open", failures: st\.failures \}/);
    assert.match(breaker, /fields: \{ provider: id, state: "closed" \}/);
    assert.match(breaker, /fields: \{ provider: id, state: "closed", by: "operator" \}/);
    assert.match(breaker, /fields: \{ provider: id, state: "half_open" \}/);

    const remediation = read("../lib/remediation.ts");
    assert.match(remediation, /state === "open"/);
    assert.match(remediation, /state === "closed"/);
  });

  it("states the missing edge instead of leaving it as a gap", () => {
    assert.match(machine, /no half-open → open edge/);
    assert.match(machine, /restarts the count from one/);
  });

  it("reads the threshold off the wire rather than compiling in a constant", () => {
    // `lib/providers/runtime` owns the in-memory store and the emitter; a
    // client component importing its constants would also drift from whatever
    // the gateway is actually enforcing.
    assert.doesNotMatch(machine, /BREAKER_THRESHOLD|BREAKER_COOLDOWN_MS/);
    assert.match(machine, /breaker\?\.threshold/);
  });

  it("draws its edges as strokes so high contrast keeps them", () => {
    // `<marker>` fills do not reliably follow currentColor, and the single
    // permitted forced-colors rule only reaches `path[stroke]`.
    assert.doesNotMatch(code(machine), /<marker/);
    assert.match(machine, /stroke="var\(--axis\)"/);
  });

  it("says why half-open will usually read zero", () => {
    // A permanent zero there is correct, not a broken counter — and a reader
    // who is not told that concludes the opposite.
    assert.match(machine, /Half-open is a moment, not a resting state/);
  });
});

describe("the cooldown ring never invents its denominator", () => {
  it("withholds the arc when the elapsed time is unknown", () => {
    // Only `cooldownRemainingMs` is published; the total is reconstructed from
    // `openedAt`. With no `openedAt` there is no fraction, and a ring drawn to
    // an assumed total would be a guess wearing a measurement's clothes.
    assert.match(machine, /fraction != null &&/);
    assert.match(machine, /elapsed unknown/);
  });

  it("does the arithmetic in server time, never the browser's clock", () => {
    assert.match(machine, /observedAt \? Date\.parse\(observedAt\) : NaN/);
  });
});

describe("the outcome ring respects the floor that withholds the rate", () => {
  it("is gated on the same constant, not a second one", () => {
    /**
     * `DonutChart` prints a rounded share beside every legend row. Ungated at
     * one trip it would print "100%" — the exact figure `MIN_TRIPS_FOR_RATE`
     * exists to refuse a few lines below it.
     */
    assert.match(ledger, /model\.trips >= MIN_TRIPS_FOR_RATE && \(/);
    assert.doesNotMatch(code(ledger), /trips >= [0-9]/);
  });

  it("keeps the refusal headline out of every disclosure", () => {
    /**
     * Position alone proves nothing here — the panel has several disclosures
     * and the refusal sits between two of them. What matters is that the
     * headline survives with every `<details>` block removed.
     */
    assert.match(uncollapsed(ledger), /No MTTR trend is drawn/);
    // And the reasoning genuinely did move.
    assert.doesNotMatch(uncollapsed(ledger), /biased toward incidents|shares with dispatch, cache/);
  });

  it("keeps the truncation warning visible, since it changes what the counts mean", () => {
    assert.match(uncollapsed(ledger), /counts above are a floor/);
  });
});

describe("operator costs stay beside the buttons", () => {
  it("keeps the quota warning uncollapsed", () => {
    /**
     * `OperatorControls`'s own header: costs are rendered next to the buttons
     * and not buried, because the person clicking is usually the person who will
     * be surprised by the bill. This one is the strongest warning on the tab —
     * it is the difference between clearing our count and clearing the vendor's.
     */
    const warn = operatorControls.indexOf("console-warn");
    const disclosure = operatorControls.indexOf('<details className="disclosure"');
    assert.ok(warn > 0 && disclosure > 0);
    assert.ok(warn < disclosure, "the billing warning was moved behind a disclosure");
  });

  it("still states a spend and a destruction inline", () => {
    const disclosure = operatorControls.indexOf('<details className="disclosure"');
    const above = operatorControls.slice(0, disclosure);
    assert.match(above, /spends a real call/);
    assert.match(above, /Destroys this instance/);
  });

  it("collapses scope into two group notes rather than seven separate ones", () => {
    /**
     * One group note per group, and the groups are now files: the server
     * mutations' disclosure lives in `OperatorControls`, the session controls'
     * in `SessionControls`. Counted across the whole pane, so a third cannot
     * appear in whichever of the two a narrower scan is not reading.
     */
    const summaries = [...operatorSurface.matchAll(/<summary>([\s\S]*?)<\/summary>/g)];
    assert.equal(summaries.length, 2, "seven disclosure triangles is as noisy as seven paragraphs");
    for (const [, text] of summaries) {
      assert.ok(text.trim().length > 12);
      assert.doesNotMatch(text.trim(), /^(Advanced|More|Details)$/i);
    }
  });

  it("keeps a sentence inline or in the disclosure, never both", () => {
    /**
     * The panel's rule, applied without exception: the line under a button is
     * the bill or the warning; what a control touches, or is for, lives in a
     * `dd`. Each of these sentences used to be printed in both places, so a
     * reader met it twice on one pane — and the pane read as twice its length.
     */
    assert.doesNotMatch(uncollapsed(operatorSurface), /Re-evaluates the environment/);
    assert.doesNotMatch(uncollapsed(operatorSurface), /Behaviour survives\./);
    // Moved, not deleted: the disclosure still owns the scope sentence.
    assert.match(code(operatorControls), /Re-evaluates the environment this process already holds/);
    // And the caveat that stayed behind is readable without opening anything.
    assert.match(uncollapsed(operatorControls), /Cannot import a changed/);
  });

  it('frames "browser only" once, on the session heading, not per row', () => {
    // The heading says "This browser only. No server state is mutated." for the
    // whole group; a "Browser-side." prefix on every row under it was that
    // heading restated two words at a time. The forbidding half reads the whole
    // pane, so the prefix cannot come back in a sibling file unseen.
    assert.match(code(sessionControls), /No server state is mutated/);
    assert.doesNotMatch(code(operatorSurface), /Browser-side\./);
  });
});
