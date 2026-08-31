/**
 * The Diffusion rail and its panels agree — the guard this tab did not have.
 *
 * Every other rail on the desk is covered: `coherence-sections.test.ts` holds
 * Proofs, `markets-sections.test.ts` holds Quotes, and
 * `workspace-routing-sections.test.ts` holds the eight decision-loop tabs. It
 * omits `diffusion` entirely, and Diffusion is the newest rail and the one that
 * has been re-cut twice in two days — four groups to four sections on
 * 2026-08-25, then four sections to seven the same evening.
 *
 * What that gap costs: a rail entry with no panel renders an EMPTY SECTION. It
 * does not throw and it does not warn — the reader presses a button and gets a
 * blank card, and `readLocation` will happily route to it. Going from four
 * sections to seven without this guard is the change most likely to strand one.
 *
 * NOT A RENDERING TEST. `npm test` has no DOM and never will (CLAUDE.md, fact
 * 6), so what is pinned here is that a future edit has to break the wiring
 * deliberately rather than by omission.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIFFUSION_SECTIONS, DIFFUSION_SECTION_IDS } from "../lib/sections";
import { viewsFor } from "../lib/section-views";
import { read, stripNonCode } from "./helpers/workspace-sources";

const console_ = read("../components/DiffusionConsole.tsx");
const code = stripNonCode(console_);
const plan = read("../scripts/desk-sweep-plan.mjs");

/** Every component that owns a section, by the id it draws. */
const SECTION_FILES: Record<string, string> = {
  arm: "../components/coherence/diffusion/ArmSection.tsx",
  meetings: "../components/coherence/diffusion/MeetingsSection.tsx",
  episodes: "../components/coherence/diffusion/EpisodesSection.tsx",
  model: "../components/coherence/diffusion/ModelSection.tsx",
  instrument: "../components/coherence/diffusion/InstrumentSection.tsx",
  sandbox: "../components/coherence/diffusion/SandboxSection.tsx",
  findings: "../components/coherence/diffusion/FindingsSection.tsx",
};

/**
 * How many control rows each section draws, by name.
 *
 * Stated per section rather than as a rule, because the interesting cases are
 * the zeroes: a section with one view may not draw a switcher, since a control
 * with one option is a control that cannot be operated.
 */
const SEGS: Record<string, number> = {
  arm: 1, meetings: 1, episodes: 1, model: 0, instrument: 0, sandbox: 1, findings: 0,
};

describe("the Diffusion rail and its panels agree", () => {
  it("the console draws a panel for every rail id, in rail order", () => {
    const drawn = [...console_.matchAll(/<WorkspaceSubtabPanel workspaceId="diffusion" tabId="([a-z]+)"/g)]
      .map((match) => match[1]);
    assert.deepEqual(drawn, DIFFUSION_SECTIONS.map((section) => section.id),
      "the panels and the rail have diverged — a rail entry with no panel renders an empty section");
  });

  it("every section id has a component that owns it", () => {
    // Both directions: a missing entry would let this suite guard by omission.
    assert.deepEqual(Object.keys(SECTION_FILES).sort(), [...DIFFUSION_SECTION_IDS].sort());
  });

  it("the console renders one rail and no section component renders another", () => {
    // `WorkspaceSubtabs` publishes its measured height as `--rail-h` on the root
    // element, so two instances fight over one custom property.
    assert.equal((code.match(/<WorkspaceSubtabs\b/g) ?? []).length, 1);
    for (const [id, file] of Object.entries(SECTION_FILES)) {
      assert.doesNotMatch(read(file), /<WorkspaceSubtabs\b/, `${id} draws a second rail`);
    }
  });
});

describe("one control row per section, and none where there is one view", () => {
  for (const [id, expected] of Object.entries(SEGS)) {
    it(`${id} draws ${expected} switcher${expected === 1 ? "" : "s"}`, () => {
      // Raw source, not `stripNonCode`: `.seg` is a class-name string, and
      // stripping blanks the very literal being counted.
      const segs = (read(SECTION_FILES[id]).match(/className="seg[ "]/g) ?? []).length;
      assert.equal(segs, expected,
        expected === 0
          ? `${id} has one view and draws a switcher; a control with one option cannot be operated`
          : `${id} draws ${segs} control rows; two in one section read as one broken control`);
    });
  }

  it("the findings exemption is pinned from both sides", () => {
    // `FindingsPane` keeps ONE switcher and `FindingsSection` keeps NONE. This
    // pair is the only thing standing between this tab and a second control
    // level: `coherence-groups.test.ts` iterates an EMPTY table, so it asserts
    // nothing here, and `coherence-sections.test.ts`'s seg map is the Proofs
    // rail only. Do not drop this as already covered — it is not.
    assert.equal((read(SECTION_FILES.findings).match(/className="seg[ "]/g) ?? []).length, 0);
    assert.equal(
      (read("../components/coherence/diffusion/FindingsPane.tsx").match(/className="seg[ "]/g) ?? []).length,
      1,
      "FindingsPane's exemption was removed or doubled; both need saying here",
    );
  });
});

describe("each switcher names its options", () => {
  const OPTIONS: Record<string, readonly string[]> = {
    arm: ["Absorption", "Control", "Clocks"],
    meetings: ["Meeting by meeting", "Calendar", "Mechanism"],
    episodes: ["Survival", "Episodes"],
    sandbox: ["Half-life", "Simulator", "Spectrum"],
  };
  for (const [id, labels] of Object.entries(OPTIONS)) {
    it(`${id} offers ${labels.join(", ")}`, () => {
      // The view labels are the only route a reader has to a view: pane ids are
      // component state and are not addressable, so a renamed view is
      // unreachable by any link and only its label says it exists.
      assert.deepEqual(viewsFor("diffusion", id).map(([, label]) => label), labels,
        `${id}'s canonical views no longer match its switcher`);
      assert.match(read(SECTION_FILES[id]), new RegExp(`viewsFor\\("diffusion", "${id}"\\)`),
        `${id} stopped consuming the canonical view registry`);
    });
  }
});

describe("the slowest read is asked for once and shared", () => {
  it("arm and meetings name the same URL", () => {
    assert.match(console_, /^ {2}arm: \[absorptionRoute\(\)\],$/m);
    assert.match(console_, /^ {2}meetings: \[absorptionRoute\(\)\],$/m);
  });

  it("one gate covers both, rather than two reads of one ledger", () => {
    // Raw source, not `stripNonCode`: the section ids are string literals and
    // stripping blanks the very thing being matched.
    assert.match(console_, /section === "arm" \|\| section === "meetings"/,
      "the absorption ledger is read once and shared, or it is read twice");
  });

  it("the console says why that is free", () => {
    // The reason is not obvious from the literal: two sections naming one URL
    // looks like a duplicated request until you know the cache joins it.
    assert.match(console_, /read-cache/, "the console does not say why two sections may share a URL");
  });

  it("the three sections that read nothing say so in their own words", () => {
    // One shared sentence would let a FOURTH empty list be excused by prose
    // written about a different section.
    for (const phrase of [/computes in the browser/, /the same literal in this bundle/, /computed on a slider a reader moves/]) {
      assert.match(console_, phrase, `the console lost the reason matching ${phrase}`);
    }
  });
});

describe("the sweep mirrors this rail exactly", () => {
  it("desk-sweep-plan names the same seven ids in the same order", () => {
    // `EXPECTED_SECTIONS` guards only the COUNT. A transposed or misspelt id
    // keeps the count right, `readLocation` silently resets the unknown id to
    // the rail default, and the sweep then reports a green cell under a heading
    // for a section it never opened.
    const match = plan.match(/diffusion:\s*\[([^\]]*)\]/);
    assert.ok(match, "desk-sweep-plan.mjs no longer names a diffusion rail");
    const ids = [...match[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, [...DIFFUSION_SECTION_IDS]);
  });
});

describe("the published links still land", () => {
  it("arm and findings are still ids on this rail", () => {
    // `#coherence/diffusion` resolves to `diffusion/arm` and
    // `#coherence/findings` to `diffusion/findings` through RELOCATED_SECTIONS.
    // Those carriers are only correct while these two ids exist here.
    for (const id of ["arm", "findings"]) {
      assert.ok((DIFFUSION_SECTION_IDS as readonly string[]).includes(id),
        `#coherence/${id === "arm" ? "diffusion" : "findings"} no longer has a target on this rail`);
    }
  });
});
