/**
 * The claims the Kalshi engine's READING panes make, pinned once each.
 *
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------------------
 * Sixteen suites on this desk are per-tab copy guards — `summarised-<tab>` and
 * `disclosure-<tab>`, one pair for each of the eight desk tabs — and they exist
 * because a fluent rewrite can drop a number, a negation or the reason a
 * measurement is missing while every line still looks present in the diff. The
 * Kalshi engine has no such pair. It is also the wordiest part of the desk, so
 * on 2026-08-24 it was condensed hard: ledes cut to one sentence, four
 * paragraphs of RFQ prose replaced by four rows of a table, three statements of
 * the shard cost reduced to the two views that do not render together. Nothing
 * else in the suite would have caught that pass dropping a true claim or
 * inventing one.
 *
 * THE SEAM IS THE SECTION GROUP, AND IT IS NEARLY — NOT EXACTLY — THE TAB SEAM.
 * That distinction is worth one paragraph, because the engine was re-cut four
 * times on 2026-08-24 and this file has been split by tab before. It guards the
 * panes that draw what the venue QUOTES; `coherence-proof-claims.test.ts`
 * guards the panes that draw what this engine ARGUES. Since the split those
 * groups line up with Prices and Proofs everywhere except Fees: the fee panes
 * sit on a Prices section, and their claims — a rounding component nineteen
 * times the modelled one, a net fee over the notional, an ablation arm every
 * competing bot ships — are assertions about a cost MODEL rather than readings
 * of a quote, so they stay with the arguments. Splitting the files by tab
 * instead would move three claims and change nothing else; the merge is not
 * available either way, since 400 lines is the house ceiling and neither file
 * has 350 lines of slack.
 *
 * The two OWNER lists below add up to both rails, and each file asserts that
 * they do — a section neither suite heads would be guarded by neither, and both
 * would stay green.
 *
 * Two properties:
 *
 *  1. Each load-bearing claim is still MADE — the sentence, or the distinctive
 *     part of it, is somewhere a reader meets.
 *  2. Each is made ONCE. That is the acceptance test the condensation was asked
 *     for: "remove any unnecessary explanations that are repeating itself or
 *     have been written down." A claim in two places is a claim a reader reads
 *     twice, and the second reading is what the scrolling was.
 *
 * HOW THE TEXT IS EXTRACTED, and why not `stripNonCode`
 * ------------------------------------------------------------------------
 * `stripNonCode` blanks comments AND string literals, which is right for the
 * suites asking what the code does and exactly wrong here: on-screen copy IS
 * string literals and JSX text. So comments only are removed, and the header
 * comments on these files are long and quote the old wording verbatim — a scan
 * that read them would find every retired sentence still "present" and pass
 * while the screen said nothing.
 *
 * DERIVED, NEVER OBSERVED. This proves a string is in a file that renders it,
 * not that a reader saw it. Nothing in this repository can prove the second
 * (CLAUDE.md, fact 6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ENGINE_SECTION_IDS } from "../lib/sections";
import { CLAIMS } from "./helpers/prices-claims";
import { read } from "./helpers/workspace-sources";

/** Every file that draws on-screen copy for a reading section.
 *
 *  NEITHER console is here. The one head-metric claim the engine makes — that
 *  it reads, records and certifies and sends nothing — is drawn once, by the
 *  Proofs console, and pinned once by the other suite. `MarketsConsole` says
 *  nothing of its own that a pane does not say better; listing it would only
 *  create a second site for a claim a pane already owns. */
const FILES = [
  "../components/coherence/UniverseSection.tsx",
  "../components/coherence/UniversePane.tsx",
  "../components/coherence/BasketOverview.tsx",
  // Split out of `UniversePane` on 2026-08-24 by the fifth review: the Baskets
  // composition (`BasketComposition`) and the Families price distribution
  // (`PriceHistogram`) that replaced the 188-row leg strip. Both render copy a
  // reader meets — the rings' empty notes, the histogram's footnote naming the
  // outcomes that carry no ask — so both join the scan in the same change. A
  // file that renders copy and is not on this list is a claim guarded by
  // nothing, which is the failure this suite exists to stop.
  "../components/coherence/BasketComposition.tsx",
  "../components/coherence/PriceHistogram.tsx",
  // Added with BasketSize on 2026-08-24: the three size figures and the
  // exposure grid. It renders copy a reader meets — why a total is withheld,
  // and why a never-traded family's bands show no share — so it joins the scan
  // in the same change that wrote it.
  "../components/coherence/BasketSize.tsx",
  "../components/coherence/DollarBar.tsx",
  "../components/coherence/SettlementPane.tsx",
  "../components/coherence/FormationDiagram.tsx",
  "../components/coherence/PendingMinutes.tsx",
  "../components/coherence/SettlementSection.tsx",
  "../components/coherence/BooksSection.tsx",
  "../components/coherence/MakersSection.tsx",
  "../components/coherence/BooksPane.tsx",
  "../components/coherence/LadderChart.tsx",
  "../components/coherence/IdentityStrip.tsx",
  "../components/coherence/RfqPane.tsx",
  "../components/coherence/DispersionStrips.tsx",
  "../components/coherence/SurfacePane.tsx",
  "../components/coherence/ShellPane.tsx",
  // Split out of `ShellPane` on 2026-08-24 at the 400-line ceiling. It carries
  // three pinned claims with it — the empty directory, the outage that is not
  // one, and the shard boundary's note over a listing — so it joins the scan in
  // the same change. A file that renders copy and is not on this list is a
  // claim guarded by nothing, which is the failure this suite exists to stop.
  "../components/coherence/ShellListing.tsx",
  "../components/coherence/ShellTree.tsx",
  "../components/coherence/ShellCommandReference.tsx",
  "../components/coherence/surface/DistributionView.tsx",
  "../components/coherence/surface/FamilyView.tsx",
  "../components/coherence/surface/StakeView.tsx",
  // Split out of `StakeView` on 2026-08-24 when `stake` became a rail section
  // of its own and the lattice stopped carrying two subjects. Both render copy
  // a reader meets and both carry a pinned claim OUT of the file that used to
  // hold it: `TruncationNote` has "truncated, never rounded", `StakeDeclined`
  // has the exclusive-family solver declining a ladder by name. They were
  // extracted without joining this list, so for a few minutes both claims were
  // still on screen and guarded by nothing — which is the precise failure the
  // note above describes, caught by this suite rather than by a reader.
  "../components/coherence/surface/StakeBars.tsx",
  "../components/coherence/surface/StakeDeclined.tsx",
  "../components/coherence/surface/TruncationNote.tsx",
];

/**
 * A file with its comments removed and its copy intact.
 *
 * Block comments, JSX comments and line comments go; string literals and JSX
 * text stay. The `[^:]` guard on the line-comment pattern is what keeps a `//`
 * inside a URL from eating the rest of the line, and it is the same guard
 * `stripNonCode` uses.
 */
function copyOf(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    // Wrapping and JSX interpolation break a sentence across lines and around
    // `{" "}`, so the whole file collapses to one space-separated line and every
    // phrase below is written as it READS rather than as it wraps.
    .replace(/\{" "\}/g, " ")
    .replace(/\s+/g, " ")
    // A sentence too long for one line is written as two adjacent literals
    // joined by `+`, and it renders as one string. Without this the phrase a
    // reader sees straddles a seam no scan can match, and the claim reads as
    // missing when it is present — which is a false alarm, the worst kind for a
    // guard whose whole job is to be believed.
    .replace(/" \+ "/g, "");
}

const COPY = new Map(FILES.map((file) => [file, copyOf(file)]));
const ALL = [...COPY.values()].join("\n");

/**
 * Where a phrase is said, one entry per occurrence.
 *
 * Occurrences and not files: `StakeView` states what a dollar becomes in the
 * worst outcome twice, once in the warning and once as the row that defines the
 * figure, and a per-file count would score that as one and let a third slip in.
 */
function sites(phrase: string): string[] {
  const found: string[] = [];
  for (const [file, copy] of COPY) {
    let at = copy.indexOf(phrase);
    while (at !== -1) {
      found.push(`${file} at ${at}`);
      at = copy.indexOf(phrase, at + phrase.length);
    }
  }
  return found;
}

describe("every load-bearing claim on this tab is still made", () => {
  for (const { claim, phrase } of CLAIMS) {
    it(claim, () => {
      assert.ok(
        ALL.includes(phrase),
        `no rendered copy on the reading sections carries "${phrase}" any more. It is a claim no other `
        + "suite guards, so if it was retired deliberately, retire this entry in the same change",
      );
    });
  }
});

describe("and made once", () => {
  for (const { claim, phrase, at = 1, why } of CLAIMS) {
    it(`${claim} — in ${at} ${at === 1 ? "place" : "places"}`, () => {
      const found = sites(phrase);
      assert.equal(
        found.length,
        at,
        `"${phrase}" is in ${found.length} files, expected ${at}${why ? ` (${why})` : ""}:\n  `
        + found.join("\n  "),
      );
    });
  }
});

describe("the head is one sentence per section", () => {
  /**
   * `PaneHead`'s own contract, held here rather than there.
   *
   * `lede` is documented as "One sentence under the head. The only prose a
   * section opens with", and nothing enforced it — three of the seven opened on
   * three sentences, which is how a reader met a paragraph before a figure on
   * every section of this engine.
   */
  /**
   * A full stop, whitespace, a capital: an actual sentence boundary.
   *
   * A bare `/\. /` counts the stop that ENDS a one-sentence lede when a JSX
   * fragment puts a space before its closing tag, which failed the Shell's
   * single-sentence lede for being single. The capital is what tells the end of
   * a sentence from the start of another.
   */
  const SENTENCE_BREAK = /\.\s+[A-Z(“"]/g;

  /**
   * The Prices rail's five sections and the file that heads each.
   *
   * FIVE NAMES HAVE LEFT THIS MAP OVER THE DAY and none of them lost a pin.
   * `settlement`, `dispersion` and `stake` are views again, and a view has no
   * head — one head per section is what `coherence-pane-head.test.ts` holds, so
   * a lede pin for a view would be pinning markup that must not exist. The
   * sentences those heads carried are still on screen and still pinned above,
   * as the paragraph each view now opens with. `combos` was a fourth and is not
   * any more: it became a Proofs section again on 2026-08-25 with a head of its
   * own, so it is pinned by the other suite rather than by nothing.
   */
  const OWNERS: Record<string, string> = {
    universe: "../components/coherence/UniverseSection.tsx",
    // `settlement` and `dispersion` are rail sections again as of 2026-08-25,
    // each with a wrapper that owns its head and its one-sentence lede. They
    // were views of Universe and Books for a day; the sentences those views
    // opened with are still on screen, drawn by the panes, and still pinned in
    // the claims table above.
    settlement: "../components/coherence/SettlementSection.tsx",
    books: "../components/coherence/BooksSection.tsx",
    dispersion: "../components/coherence/MakersSection.tsx",
    lattice: "../components/coherence/SurfacePane.tsx",
    // `stake` became a rail section of its own on 2026-08-24, the fifth review:
    // the lattice was stacking a five-view seg, a second three-view seg and a
    // family picker above its first data, and the bet is a different question
    // from the measure. Its head moved to `StakePane` with it.
    stake: "../components/coherence/StakePane.tsx",
    fees: "../components/coherence/FeesSection.tsx",
    shell: "../components/coherence/ShellPane.tsx",
  };

  /** The Proofs rail's six, from the other suite. Named here so the union can
   *  be checked against BOTH rails: a section neither suite heads would be
   *  guarded by neither, and both files would stay green while its head grew a
   *  second sentence.
   *
   *  Four until 2026-08-25, when Dutch book's three groups became three
   *  sections. `combos` is among them, which retires the note above about it
   *  heading nothing — it heads `CombosSection` now, and its link resolves on
   *  the rail rather than through the relocation table. */
  const PROVED = [
    "certificate", "portfolio", "combos", "calibration", "index", "lessons",
    // The Diffusion tab's seven, headed by the proof suite.
    "arm", "meetings", "episodes", "model", "instrument", "sandbox", "findings",
  ];

  it("the two suites' owners add up to both rails, exactly once each", () => {
    const covered = [...Object.keys(OWNERS), ...PROVED].sort();
    assert.deepEqual(covered, [...ENGINE_SECTION_IDS].sort());
    assert.equal(new Set(covered).size, covered.length, "a section is headed by both suites");
  });

  for (const [id, file] of Object.entries(OWNERS)) {
    it(`${id}'s lede is one sentence`, () => {
      const copy = COPY.get(file) ?? copyOf(file);
      // Either shape: `lede="…"` on the element, or `lede: "…"` in a hoisted
      // head object. The Shell's is a JSX fragment carrying two `<code>`
      // elements and is measured by its own full stops below.
      const ledes = [...copy.matchAll(/lede[=:] ?"([^"]+)"/g)].map((match) => match[1]);
      if (!ledes.length) {
        // Shell: a fragment. Count the sentence-ending stops inside it.
        const start = copy.indexOf("lede={");
        assert.notEqual(start, -1, `${id} draws no lede at all`);
        const fragment = copy.slice(start, copy.indexOf("/>", start));
        assert.equal(
          (fragment.match(SENTENCE_BREAK) ?? []).length, 0,
          `${id}'s lede is more than one sentence: ${fragment}`,
        );
        return;
      }
      for (const lede of ledes) {
        assert.equal(
          (lede.match(SENTENCE_BREAK) ?? []).length, 0,
          `${id}'s lede is more than one sentence: ${lede}`,
        );
        assert.ok(lede.length <= 200, `${id}'s lede is ${lede.length} characters, which reads as a paragraph`);
      }
    });
  }
});
