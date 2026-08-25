/**
 * No section of the engine's argument tabs opens with a paragraph.
 *
 * A section head is `kicker → title → id → note → lede`, the lede is ONE
 * sentence, and the note is a fragment. Those are shape rules rather than
 * content rules, and they exist because the alternative is what this desk had
 * before: a card that opened with three paragraphs of reasoning above its first
 * drawing, on every section, so a reader scrolled past the argument to reach
 * the evidence for it.
 *
 * Split out of `coherence-proof-claims.test.ts` on 2026-08-25, when that file
 * crossed the four-hundred-line ceiling as the Diffusion tab's four sections
 * joined its OWNERS map. The seam is the one the file's own header names: that
 * suite asserts a CLAIM is still made and made once, this one asserts the head
 * carrying it is the desk's own shape. A change to either is rarely a change to
 * both.
 *
 * DERIVED, NEVER OBSERVED. There is no DOM here (CLAUDE.md, fact 6): this
 * proves the props are written, not that a reader met them in that order.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ENGINE_SECTION_IDS } from "../lib/sections";

const root = fileURLToPath(new URL("..", import.meta.url));

/**
 * A file's ON-SCREEN COPY: comments stripped, whitespace collapsed.
 *
 * Its own copy of this rather than a shared helper with the claims suite,
 * deliberately. `stripNonCode` blanks string literals, which is right for a
 * suite asking what the code DOES and exactly wrong for one asking what it
 * SAYS — on-screen copy IS string literals. And the header comments on these
 * files quote retired wording verbatim, so a scan that read them would find
 * every deleted sentence still "present".
 */
function copyOf(file: string): string {
  return readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

/**
 * ONE SECTION'S HEAD, from its kicker to the end of the block that draws it.
 *
 * Scoped rather than searched, and this is the half of the file that took two
 * attempts. A bare scan for `note[=:]` finds the `note` field of Calibration's
 * six-row fact table as readily as the head's own, reports it as a two-sentence
 * head note, and is wrong in the direction that gets a guard deleted. A bare
 * scan for `lede` was fine and a bare scan for `note` was not, so both are
 * scoped the same way instead of one of them being special.
 *
 * The head is written kicker → title → id → note → lede everywhere, which is
 * the order `PaneHeadProps` declares, so the region runs from `kicker` to the
 * end of the block: `};` for a hoisted head object, `/>` for an inline element.
 * `headOrder` below pins that ordering, because it is what makes this scoping
 * legal — a head that wrote its note after its lede would be measured wrong
 * and would say nothing about it.
 */
function headRegion(source: string): string | null {
  const kicker = source.indexOf("kicker");
  if (kicker === -1) return null;
  const lede = source.indexOf("lede", kicker);
  if (lede === -1) return null;
  const object = source.indexOf("};", lede);
  const inline = source.indexOf("/>", lede);
  const ends = [object, inline].filter((at) => at !== -1);
  return source.slice(kicker, ends.length ? Math.min(...ends) : source.length);
}

/**
 * A head field's PROSE: what a reader sees, with the JSX around it removed.
 *
 * Every bracket character goes, not just balanced tags. A region cut at the
 * head's closing `/>` ends mid-tag — `…the notional traded. <` — and a stray
 * `<` after a full stop reads to a sentence counter as the start of a second
 * sentence. Trailing separators go for the same reason: `identical.",` leaves
 * `. ,` behind, which is the same false positive one character along. Both were
 * this file's own first two failures.
 */
function proseOf(region: string): string {
  return region
    .replace(/^\s*\w+\s*[=:]\s*/, "")
    .replace(/\{"\s*"\}/g, " ")
    .replace(/[<>{}()`"]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:]+$/, "")
    .trim();
}

/** Where a head field is declared inside a head region, or -1. */
function fieldAt(region: string, field: string): number {
  // Anchored on a boundary and on the `:` or `=` that follows, because `id` is
  // a substring of "identical", "considered" and half the prose on this tab.
  const match = new RegExp(`(?:^|[\\s{,])${field}\\s*[=:]`).exec(region);
  return match ? (match.index as number) : -1;
}

/**
 * Which component draws each section's head.
 *
 * The same map `coherence-pane-head.test.ts` keeps, and deliberately a second
 * copy: that file asserts the head EXISTS and is the desk's own grammar, this
 * one asserts what the head SAYS, and a shared fixture between them would mean
 * one wrong entry silently exempts a section from both.
 */
const OWNERS: Record<string, string> = {
  certificate: "components/coherence/CertificatePane.tsx",
  portfolio: "components/coherence/BasketSection.tsx",
  combos: "components/coherence/CombosSection.tsx",
  calibration: "components/coherence/CalibrationPane.tsx",
  index: "components/coherence/IndexSection.tsx",
  lessons: "components/coherence/LessonsPane.tsx",
  // Diffusion is the eleventh TAB as of 2026-08-25. Its seven sections are
  // argument panes like the rest of this suite's, so they are headed here
  // rather than by the reading suite.
  arm: "components/coherence/diffusion/ArmSection.tsx",
  meetings: "components/coherence/diffusion/MeetingsSection.tsx",
  episodes: "components/coherence/diffusion/EpisodesSection.tsx",
  model: "components/coherence/diffusion/ModelSection.tsx",
  instrument: "components/coherence/diffusion/InstrumentSection.tsx",
  sandbox: "components/coherence/diffusion/SandboxSection.tsx",
  findings: "components/coherence/diffusion/FindingsSection.tsx",
};

/**
 * The reading suite's five, all of them Prices sections. Named here so the
 * union can be checked against BOTH rails: a section neither suite heads would
 * be guarded by neither, and both files would stay green while a head grew a
 * second sentence.
 *
 * Five names left this file over 2026-08-24 — `portfolio`, `ablation`,
 * `findings`, `index` and `combos` — because none was a section any more. Two
 * of them CAME BACK on 2026-08-25 and are in OWNERS above: `portfolio` and
 * `combos` are sections again, each with a head of its own, and the sentences
 * their views had been opening with are ledes again. Three remain views —
 * `ablation`, `findings` and `index`, of `fees`, `diffusion` and `calibration`
 * — and a view has no head to check; the sentences their heads carried are
 * still on screen and still pinned in CLAIMS above, as the paragraph each view
 * opens with. `index` was a PUBLISHED id, so its link is carried by
 * `RELOCATED_SECTIONS` rather than by a head.
 */
// SIX since the fifth review of 2026-08-24, not five: `stake` left `lattice`
// and became a rail section with a head of its own. The lattice was stacking a
// five-view seg, a second three-view seg and a family picker above its first
// data, and "what measure do these prices imply" is not "what would it be right
// to bet" — two questions, two sections. Its head lives in `StakePane`, and the
// reading suite's OWNERS map names it there.
// Eight since 2026-08-25: `settlement`/`dispersion` are Prices sections again.
const QUOTED = ["universe", "settlement", "books", "dispersion", "lattice", "stake", "fees", "shell"];

const COPY = new Map(Object.values(OWNERS).map((file) => [file, copyOf(file)] as const));

describe("no section opens with a paragraph", () => {
  it("the two suites' owners add up to both rails, exactly once each", () => {
    const covered = [...Object.keys(OWNERS), ...QUOTED].sort();
    assert.deepEqual(covered, [...ENGINE_SECTION_IDS].sort());
    assert.equal(new Set(covered).size, covered.length, "a section is headed by both suites");
  });

  for (const [id, file] of Object.entries(OWNERS)) {
    it(`${id} writes its head in the order PaneHeadProps declares`, () => {
      // What makes the scoping above legal, and worth pinning for itself: a
      // reader meets a head in this order and so does every other tab.
      const region = headRegion(COPY.get(file) as string);
      assert.ok(region, `${id} draws no head this scan can find`);
      const fields = ["kicker", "title", "id", "note", "lede"];
      const at = fields.map((field) => fieldAt(region as string, field));
      assert.deepEqual(
        fields.filter((_field, index) => at[index] === -1),
        [],
        `${id}'s head is missing a field`,
      );
      assert.deepEqual(at, [...at].sort((a, b) => a - b), `${id} writes its head out of order`);
    });

    it(`${id}'s lede is one sentence`, () => {
      // One sentence is the contract PaneHead's own header states: "lede — one
      // sentence under the head. The only prose a section opens with." Before
      // this pass six of them ran to two or three, which is how a reader met a
      // paragraph before reaching a figure on most of the tab.
      const region = headRegion(COPY.get(file) as string);
      assert.ok(region, `${id} draws no head this scan can find`);
      const prose = proseOf((region as string).slice(fieldAt(region as string, "lede")));
      // A full stop followed by a WORD, not by any non-space. A ternary lede
      // renders as one branch or the other, and stripping its quotes leaves
      // `plan. : Each` in the middle — where the `:` is the language's, not a
      // sentence's. Both branches are still measured, because a two-sentence
      // branch puts a letter after the stop.
      const breaks = prose.match(/\. (?=[A-Za-z\u201c\u2018(])/g) ?? [];
      assert.deepEqual(
        breaks,
        [],
        `${id}'s lede is more than one sentence — ${breaks.length} full stop(s) mid-run:\n  ${prose}`,
      );
    });

    it(`${id}'s note is a fragment`, () => {
      // `note` is what this read covered or cost — a count, a source, a
      // freshness. PaneHead's header gives the reason: "a head with two
      // sentences in it is a paragraph wearing a heading's clothes." The middle
      // dot is checked again here because a note is exactly the slot where a
      // two-part label gets joined with one.
      const region = headRegion(COPY.get(file) as string) as string;
      const note = region.slice(fieldAt(region, "note"), fieldAt(region, "lede"));
      const prose = proseOf(note);
      assert.ok(prose.length > 0, `${id} draws no note`);
      assert.deepEqual(
        prose.match(/\. (?=[A-Za-z\u201c\u2018(])/g) ?? [],
        [],
        `${id}'s note runs to two sentences: ${prose}`,
      );
      assert.ok(!prose.includes("\u00b7"), `${id}'s note joins two parts with a middle dot: ${prose}`);
    });
  }
});
