/**
 * What each Proofs section READS, and when it is allowed to.
 *
 * `coherence-sections.test.ts` asserts a section exists, is drawn, and that
 * every retired location still resolves to it. This file asserts the other
 * half: which gateway call each section makes, that none is started on a
 * reader's behalf before they have chosen what it needs, and that two sections
 * over one read cannot end up describing two different things.
 *
 * WHY IT IS ITS OWN FILE. The sibling reached 432 lines on 2026-08-25 — over
 * the four-hundred ceiling — when the 2026-08-25 split turned Dutch book's
 * three groups into three sections and the read contract grew with them. The
 * house rule is to SPLIT rather than shave prose, and the seam is real rather
 * than convenient: one file is about the rail, this one is about the network.
 *
 * The reads themselves are slow on purpose. `universe` and `certify` go to the
 * live exchange behind a twenty-eight second browser deadline; `combos` is a
 * book call per leg on top of its own. What that buys the reader is the reason
 * every assertion below is about NOT reading: a call started for a question
 * nobody asked is a call the reader waits behind.
 *
 * DERIVED, NEVER OBSERVED. There is no DOM here (CLAUDE.md, fact 6). This
 * proves the gates are wired as they claim, not that a packet was or was not
 * sent.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COHERENCE_SECTION_IDS } from "../lib/sections";
import { read, stripNonCode } from "./helpers/workspace-sources";

const console_ = read("../components/CoherenceConsole.tsx");
const code = stripNonCode(console_);

/** Every component that owns a section, by the id it draws. Mirrors its sibling. */
const SECTION_FILES: Record<string, string> = {
  certificate: "../components/coherence/CertificatePane.tsx",
  portfolio: "../components/coherence/BasketSection.tsx",
  combos: "../components/coherence/CombosSection.tsx",
  calibration: "../components/coherence/CalibrationPane.tsx",
  index: "../components/coherence/IndexSection.tsx",
  lessons: "../components/coherence/LessonsPane.tsx",
};

it("the mirror above still names every section, so nothing is guarded by omission", () => {
  assert.deepEqual(Object.keys(SECTION_FILES).sort(), [...COHERENCE_SECTION_IDS].sort());
});

describe("the reads are gated by section, and the folded reads by view", () => {
  it("no section warms a family nobody has picked", () => {
    // `certify` names ONE event, and which event is a choice the reader has not
    // made when a section opens. Warming it would not be guessing at a question
    // — the shape warming is for — it would be guessing at the ANSWER, and
    // spending a twenty-five second exchange read to do it.
    //
    // `combosRoute` left this prohibition on 2026-08-25 and the distinction is
    // the whole rule rather than an exception to it: a parlay is a listing the
    // venue publishes, so the `combos` read names no family and there is
    // nothing to guess. It became a section of its own in the same change,
    // which is what gave it a section to be warmed from.
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.doesNotMatch(plan, /certifyRoute/,
      "a section warms certify, which picks a family on the reader's behalf");
    assert.match(plan, /combos: \[combosRoute\(\)\]/,
      "the parlay section warms nothing, so it opens on a read it could have started");
  });

  it("the universe read is gated on the two sections that need the family list", () => {
    // Both certify sections need the roster and neither of the other four does.
    // Gating on one section was right while there was one; naming the pair here
    // is what stops a third section quietly joining them.
    assert.match(console_, /const onFamily = section === "certificate" \|\| section === "portfolio"/,
      "the universe read is not gated on exactly the sections that choose a family");
    assert.match(console_, /universeRoute\(\), active && onFamily/,
      "the universe read does not use that gate");
  });

  it("the two certify sections read one family, chosen once", () => {
    // The defect this replaces the parlay gate with. Coherence test and Basket
    // are two sections over ONE certify answer; if each owned its own choice,
    // a reader could put them on different families and neither would say so.
    assert.doesNotMatch(read(SECTION_FILES.certificate), /useState<string \| null>/,
      "Coherence test owns a family choice, so it can disagree with Basket");
    assert.doesNotMatch(read(SECTION_FILES.portfolio), /useState<string \| null>/,
      "Basket owns a family choice, so it can disagree with Coherence test");
    assert.match(console_, /const \[family, setFamily\] = useState<string \| null>\(null\)/,
      "the console does not own the family the two sections share");
  });

  it("a section never draws an answer about a family other than the one it names", () => {
    // `useCoherenceRead` keeps the last good payload across a failed poll, and
    // until 2026-08-25 across a CHANGED URL too — so pressing a new family left
    // the previous family's verdict and proof on screen under the new family's
    // name. Both certify sections compare before they draw.
    for (const id of ["certificate", "portfolio"]) {
      assert.match(
        read(SECTION_FILES[id]),
        /data\.component_id === target/,
        `${id} draws whatever the hook last held, which may be another family's answer`,
      );
    }
  });

  it("the Scorecard and the index are two sections over two reads, not one over both", () => {
    // This was a within-section gate — `active && !onIndex` — because the two
    // were one section with two groups. The 2026-08-25 split made the SECTION
    // the gate, which is stronger: the Scorecard cannot read the index tape at
    // all, rather than reading it only when a flag says not to.
    const scorecard = read(SECTION_FILES.calibration);
    assert.match(scorecard, /calibrationRoute\(\), active\)/,
      "the Scorecard no longer reads the settled corpus on its own section gate");
    assert.doesNotMatch(scorecard, /indexRoute|calibrationHistoryRoute/,
      "the Scorecard reads an index tape it does not draw");

    // The index section reads NOTHING at the section level: its two reads live
    // in the two components that draw them, each gated on the view. A section
    // holding a read for a view it may never open is the cost the group level
    // used to pay.
    const index = read(SECTION_FILES.index);
    assert.match(index, /view === "trend" \? \(/,
      "the index section no longer branches its two reads by view");
  });
});

describe("an answer belongs to the question that was asked", () => {
  const hook = read("../lib/coherence/use-coherence.ts");

  it("the last good payload is carried across a failed poll, which is the useful case", () => {
    // A book from forty seconds ago beside "the gateway is unreachable" is more
    // use than an empty panel. This half is not the defect and must not be lost
    // while fixing the other half.
    assert.match(hook, /data: data \?\? previous\.data/,
      "a failed poll now blanks the panel instead of reporting the failure beside the last answer");
  });

  it("but the state is reseeded when the url changes, because that is a different question", () => {
    // `useState`'s initialiser runs on mount only, so without this the carry-over
    // above spans a CHANGED URL too: choosing a new family left the previous
    // family's verdict, chips and fixed-width proof on screen under the new
    // family's name for the whole twenty-eight second live read, with nothing
    // saying so. That is what the screenshots of 2026-08-25 showed — a pill
    // reading KXHIGHNY over a proof reading KXBTCD.
    assert.match(hook, /const \[seededFor, setSeededFor\] = useState\(url\)/,
      "the hook does not track which url its state was seeded for");
    assert.match(hook, /if \(seededFor !== url\) \{/,
      "the hook does not reseed when the question changes");
  });

  it("the reseed happens during render, not in an effect", () => {
    // An effect would paint one frame of the old answer under the new heading
    // before correcting itself, which is a shorter version of the same lie.
    const start = hook.indexOf("const [seededFor");
    const region = hook.slice(start, start + 400);
    assert.doesNotMatch(region, /useEffect/,
      "the reseed moved into an effect, which paints a frame of the previous answer first");
  });
});
