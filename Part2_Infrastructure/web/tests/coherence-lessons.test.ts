/**
 * The coherence curriculum is data, and this is what keeps it honest.
 *
 * `lib/coherence/lessons.ts` claims, for each lesson, which module carries it
 * and which test would go red if it stopped being true. Those claims are the
 * reason the catalogue is worth having and also the easiest thing in it to get
 * wrong: a renamed module or a retired suite leaves a lesson pointing at
 * nothing, and the card still renders perfectly.
 *
 * The shape rules are `strategy-docs.test.ts`'s, for its reason: a failure mode
 * written in the same words as its neighbour's is a failure mode nobody
 * distinguished, and a lesson with no boundary teaches a reader to apply it
 * everywhere.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { COHERENCE_LESSONS } from "../lib/coherence/lessons";
import { read } from "./helpers/workspace-sources";

const gatewayRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("every lesson names code that exists", () => {
  it("the catalogue is populated, so an empty scan cannot pass", () => {
    assert.ok(COHERENCE_LESSONS.length >= 8, `only ${COHERENCE_LESSONS.length} lessons found`);
  });

  it("a shipped lesson's guarded module is a real file", () => {
    // Shipped only, for the reason the pinning check below is: an unbuilt
    // lesson names the module its slice WILL add, which is the plan rather
    // than a broken pointer. The flag flips when the slice lands and this
    // assertion starts holding it.
    const missing: string[] = [];
    for (const lesson of COHERENCE_LESSONS.filter((entry) => entry.shipped)) {
      for (const path of lesson.guards) {
        if (!existsSync(join(gatewayRoot, path))) missing.push(`${lesson.id} guards ${path}`);
      }
    }
    assert.deepEqual(missing, [], "a lesson points at a module that is not there");
  });

  it("a shipped lesson's pinning test is a real file", () => {
    // Only the shipped ones: an unbuilt lesson names the suite it WILL have,
    // which is the plan rather than a broken pointer. When its slice lands the
    // flag flips and this assertion starts holding it.
    const missing: string[] = [];
    for (const lesson of COHERENCE_LESSONS.filter((entry) => entry.shipped)) {
      for (const path of lesson.pinnedBy) {
        if (!existsSync(join(gatewayRoot, path))) missing.push(`${lesson.id} is pinned by ${path}`);
      }
    }
    assert.deepEqual(missing, [], "a shipped lesson points at a suite that is not there");
  });

  it("every lesson lands on a section the engine actually has", async () => {
    // BOTH rails, because the curriculum spans the whole Kalshi engine and the
    // engine has been one tab and two tabs twice each on 2026-08-24. This
    // assertion is what caught the cost of every one of those moves: `kelly`
    // named `stake`, a section the promotion pass created and the merge turned
    // back into a view of `lattice`; `index` and `frechet` named two published
    // sections the consolidation folded into `calibration` and `certificate`.
    // A lesson may only name a place a reader can reach by URL, so a demoted id
    // here is a failure rather than a rename.
    //
    // `ENGINE_SECTION_IDS` is the concatenation, declared once in
    // `lib/sections.ts`. Reading one tab's array would pass while half the
    // curriculum pointed at sections the other tab had carried away.
    const { ENGINE_SECTION_IDS } = await import("../lib/sections");
    const strays = COHERENCE_LESSONS.filter((lesson) => !ENGINE_SECTION_IDS.includes(lesson.pane));
    assert.deepEqual(strays.map((lesson) => `${lesson.id} → ${lesson.pane}`), []);
  });
});

describe("every lesson carries its own boundary", () => {
  it("states what breaks it, at length", () => {
    for (const lesson of COHERENCE_LESSONS) {
      assert.ok(
        lesson.whenItFails.length >= 60,
        `${lesson.id} does not say what breaks it in enough words to be useful`,
      );
      assert.ok(lesson.whenItHolds.length >= 40, `${lesson.id} does not say when it holds`);
      assert.ok(lesson.summary.length >= 80, `${lesson.id} has no summary worth reading`);
    }
  });

  it("no two lessons fail in the same words", () => {
    // The rule strategy-docs holds: two entries sharing a failure mode means
    // one of them was never thought through.
    const seen = new Map<string, string>();
    for (const lesson of COHERENCE_LESSONS) {
      const fingerprint = lesson.whenItFails.toLowerCase().split(/\s+/).slice(0, 8).join(" ");
      const previous = seen.get(fingerprint);
      assert.equal(previous, undefined, `${lesson.id} fails in the same words as ${previous}`);
      seen.set(fingerprint, lesson.id);
    }
  });

  it("no lesson promises a return", () => {
    // The house rule against a summary that sells. Narrow on purpose: a
    // "guaranteed dollar" is what a mutually exclusive basket PAYS — the
    // definition the whole tab rests on — so the ban is on promised profit,
    // not on the word. A regex that cannot tell those apart would push the
    // lessons into vaguer language than the maths they describe.
    const banned = /\b(guaranteed (profit|return|money|win)|always profits?|risk-?free money|never loses?|sure thing)\b/i;
    for (const lesson of COHERENCE_LESSONS) {
      assert.doesNotMatch(lesson.summary, banned, `${lesson.id} promises something`);
      assert.doesNotMatch(lesson.whenItHolds, banned, `${lesson.id} promises something`);
    }
  });

  it("ids are unique and lowercase, because they key the catalogue", () => {
    const ids = COHERENCE_LESSONS.map((lesson) => lesson.id);
    assert.equal(new Set(ids).size, ids.length, "two lessons share an id");
    assert.deepEqual(ids.filter((id) => !/^[a-z]+$/.test(id)), []);
  });
});

describe("the curriculum draws what it can, and nothing it cannot", () => {
  const registry = read("../components/coherence/lesson-figures/index.tsx");
  const pane = read("../components/coherence/LessonsPane.tsx");

  it("every published lesson has exactly one registered figure", () => {
    // Equality in both directions: a stray figure renders for nobody, while a
    // missing figure leaves an Inspect action that cannot show its model.
    const ids = COHERENCE_LESSONS.map((lesson) => lesson.id).sort();
    const keyed = [...registry.matchAll(/^  ([a-z]+): [A-Z]/gm)].map((match) => match[1]);
    assert.deepEqual(keyed.sort(), ids, "the lesson catalogue and diagram registry diverged");
  });

  it("a lesson with no figure still renders its card", () => {
    // The whole reason this is a registry rather than a field on the data: most
    // lessons make a claim that is a SENTENCE, and a picture of one would be a
    // picture of an equals sign. A fifteenth lesson must not arrive with a gap.
    assert.match(registry, /if \(!Drawing\) return null;/,
      "a lesson with no entry must draw nothing, not a placeholder");
  });

  it("puts every technical diagram in a named keyboard-scrollable region", () => {
    assert.match(registry, /role="region"/);
    assert.match(registry, /aria-label=\{`\$\{id\} lesson technical diagram`\}/);
    assert.match(registry, /tabIndex=\{0\}/);
  });

  it("the figures read nothing, because a lesson is a claim about every poll", () => {
    assert.doesNotMatch(registry, /useCoherenceRead|Route\(|fetch\(/,
      "a lesson figure that fetched would illustrate one poll's answer to a question about all of them");
  });

  it("the episode state machine is a peer view and names the state that has no lifetime", () => {
    assert.match(pane, /Episode states/);
    const states = read("../components/coherence/ViolationStates.tsx");
    assert.match(states, /Still open/);
    assert.match(states, /a lower bound, not a lifetime/,
      "the still-open state must say it has no lifetime — it is why the survival curve uses closed episodes only");
    assert.doesNotMatch(states, /useCoherenceRead|Route\(/,
      "the state diagram is structural: it draws what the recorder CAN write, not what it has");
  });
});

describe("Lessons is a static proof surface", () => {
  const console_ = read("../components/CoherenceConsole.tsx");

  it("keeps global status live without starting section reads or certificate transport", () => {
    assert.match(console_, /const statusLive = active && !paused && !rearming;/,
      "Pause and one-shot re-arm no longer gate the shared top-bar read");
    assert.match(console_, /const sectionLive = statusLive && section !== "lessons";/);
    assert.match(console_, /const sectionVisible = active && section !== "lessons";/);
    assert.match(console_, /useCoherenceRead<CoherenceStatus>\(statusRoute\(\), statusLive\)/);
    assert.match(console_, /useCoherenceRead<CoherenceUniverse>\(universeRoute\(\), statusLive && onFamily\)/);
    assert.match(console_, /const onFamily = section === "certificate" \|\| section === "portfolio";/);
    assert.match(console_, /useSectionWarming\(SECTION_READS, sectionLive\)/);
    assert.match(console_, /if \(!sectionLive \|\| !target\) return;/);
    assert.match(console_, /return \(\) => controller\.abort\(\);/,
      "leaving a live proof for Lessons did not cancel its certificate warm");
  });

  it("does not draw a transport banner over the static curriculum", () => {
    const evidence = read("../components/coherence/EngineViewEvidence.tsx");
    const state = read("../components/coherence/EngineStatePanel.tsx");
    assert.match(console_, /<EngineTopbarStatus/,
      "Lessons lost the same visible global engine status used by live Proofs views");
    assert.match(state, /if \(!visible\) return null;/);
    assert.match(console_, /\{sectionVisible && hasHaltedShard && status\.data && \(\s*<div className="coh-console__status">/);
    assert.match(console_, /status\.data\?\.state === "ok" && status\.data\.shards\.some\(/,
      "fallback shard data can still draw a halt over the static curriculum");
    assert.match(console_, /showTransport=\{sectionVisible\}/);
    assert.match(console_, /\{sectionVisible && status\.error && \(/,
      "the transport notice is not gated off on Lessons");
    assert.match(evidence, /\{showTransport && \(\s*<div className="coh-evidence__transport"/);
    for (const label of ["Lead readout", "Unit", "Method", "Source"]) assert.match(evidence, new RegExp(label));
  });
});
