/**
 * THE COPY GUARD THIS TAB DID NOT HAVE — the PROOF half of it.
 *
 * "make sure we do a sweep of the markets and coherance tabs to summarise the
 *  content into detailed concise bits and format it well for users"
 * "remove any unnecessary explanations that are repeating itself or have been
 *  written down … i dont want to be scrolling for days"
 *
 * `CLAUDE.md` records sixteen per-tab copy guards — a `summarised-<tab>` and a
 * `disclosure-<tab>` for each of the eight desk tabs — and states why they pin
 * rendered sentences byte for byte: "a fluent rewrite can drop a number, a
 * negation or the reason a measurement is missing while every line still looks
 * present in the diff." The Kalshi engine is the one tab with no such pair, and
 * it is exactly the tab a condensation pass was aimed at. So a rewrite of its
 * copy could delete a load-bearing claim and stay green.
 *
 * THE SEAM IS THE SECTION GROUP, AND IT IS NEARLY — NOT EXACTLY — THE TAB SEAM.
 * The engine was re-cut four times on 2026-08-24 and this pair has been split by
 * tab before; splitting by tab again is the obvious diff and it is not the one
 * that was taken. This file guards what the engine ARGUES (Dutch book, the
 * scorecard, diffusion, the curriculum) and `coherence-reading-claims.test.ts`
 * guards what the venue QUOTES (universe, books, lattice, shell). The one place
 * the two groups and the two tabs disagree is Fees: it is a Prices section, and
 * its claims — a rounding component nineteen times the modelled one, a net fee
 * over the notional, an ablation arm every competing bot ships — are assertions
 * about a cost MODEL rather than readings of a quote, so they are scanned here.
 * Merging the suites is not available either way: 371 lines plus 246 is over
 * the house ceiling. Every phrase either file has ever pinned is still pinned,
 * and each asserts that the two owner lists add up to BOTH rails.
 *
 * It does not pin whole sentences: a claim survives a rephrasing, and a
 * guard that fails on every wording change gets loosened until it means
 * nothing. What it pins is the CLAIM — a short phrase that cannot be present by
 * accident — and HOW MANY PLACES make it, because the defect this pass was
 * fixing is a true statement said three times in three sets of words, which is
 * how a reader ends up unsure whether they are reading one fact or three.
 *
 * Every claim below is one no other suite guards. Deleting one from the tab is
 * allowed; deleting it from this list in the same change is what makes it a
 * decision rather than an accident.
 *
 * WHAT THIS CANNOT DO, said because a green suite is not a look at a screen.
 * There is no DOM in this suite and no browser: everything here is a regex over
 * component source. It cannot tell that a claim is legible, that a table is
 * scannable, or that a section is short enough to read without scrolling — only
 * that the words are still there, in as many places as were intended.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ENGINE_SECTION_IDS } from "../lib/sections";

const root = join(import.meta.dirname, "..");

/**
 * The panes whose copy belongs to a READING section, named out of the scan.
 *
 * `components/coherence/` holds every pane on the engine, so the reading half
 * is named rather than guessed at. A prefix rule would have to encode which
 * pane belongs to which section group, and that is what `lib/sections.ts` and
 * the console already say; a second copy of it here would be the drift this
 * file exists to catch, one level up.
 *
 * `SurvivalChart` and `PmfChart` are on this list and are not obviously reading
 * panes: they are drawn by the lattice and by Universe's settlement views, so
 * their captions are reading copy even though the modules sit beside the proof
 * panes. `IndexBasisChart` left it in the other direction — the coherence index
 * is two views of the Scorecard since the consolidation, and its captions argue
 * about a measured distance rather than reporting a quote.
 */
const READING_OWNED = new Set([
  "UniverseSection.tsx", "UniversePane.tsx", "BasketOverview.tsx", "DollarBar.tsx",
  // `UniversePane`'s two figures, split out at the fifth 2026-08-24 review.
  "BasketComposition.tsx", "PriceHistogram.tsx",
  "SettlementPane.tsx", "FormationDiagram.tsx", "PendingMinutes.tsx", "BooksSection.tsx",
  "BooksPane.tsx", "LadderChart.tsx", "IdentityStrip.tsx", "RfqPane.tsx",
  "DispersionStrips.tsx", "ChannelStates.tsx", "SurfacePane.tsx",
  // `ShellListing.tsx` is `ShellPane`'s listing, split out at the 400-line
  // ceiling on 2026-08-24. It is reading copy for the same reason its parent is.
  "ShellPane.tsx", "ShellListing.tsx", "ShellTree.tsx", "ShellCommandReference.tsx", "PmfChart.tsx",
  "SurvivalChart.tsx",
]);

/** Every `.tsx` under components/coherence that is not a reading pane, plus the console. */
function coherenceFiles(relative = "components/coherence"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // `surface/` is the lattice's own views, stake included — reading, whole
      // directory.
      if (entry.name === "surface") continue;
      out.push(...coherenceFiles(join(relative, entry.name)));
    } else if (entry.name.endsWith(".tsx") && !READING_OWNED.has(entry.name)) {
      out.push(join(relative, entry.name));
    }
  }
  return out;
}

/** Both consoles. `MarketsConsole` carries no claim of its own — the head
 *  metric that says this engine sends nothing is drawn once, by the Proofs
 *  console — but it is scanned so that a copy of it appearing there would be
 *  counted as the second site it would be, rather than going unseen. */
const FILES = [
  ...coherenceFiles(), "components/CoherenceConsole.tsx", "components/MarketsConsole.tsx",
];

/**
 * A file's RENDERED copy: comments blanked, whitespace collapsed.
 *
 * Both halves matter. Every one of these components carries a long header
 * comment that argues for the claim the pane makes — several quote the old
 * wording they replaced — so a raw scan finds every claim in the file that
 * explains it and none of the ones a reader can see. And JSX wraps prose across
 * lines at whatever column the formatter chose, so a phrase is only findable
 * once runs of whitespace are one space.
 */
function copyOf(file: string): string {
  return readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^[ \t]*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const COPY = new Map(FILES.map((file) => [file, copyOf(file)] as const));

interface Claim {
  /** A phrase that cannot appear by accident, short enough to survive an edit. */
  readonly phrase: string;
  /** How many of this tab's files may carry it, and why more than one is right. */
  readonly places: number;
  /** What the claim IS, for the failure message. */
  readonly claim: string;
  /** Why it matters that it is said, and said this many times. */
  readonly why: string;
}

/**
 * The load-bearing claims of the engine's proof sections.
 *
 * Chosen by one rule: a reader who did not meet this sentence would take away
 * something false. Not "everything true on the tab" — the tables and figures
 * carry most of that and a guard over all of it would pin the whole tab in
 * place.
 */
const CLAIMS: readonly Claim[] = [
  {
    phrase: "a detector that spoke only on a hit",
    places: 1,
    claim: "the coherence test almost always finds nothing, and that is the finding",
    why: "Without it a reader reads the usual verdict as a failure of the engine. "
      + "Said once, in the Dutch-book lede: the Bounds test states the same fact about "
      + "parlays in its own terms and must not borrow this sentence to do it.",
  },
  {
    phrase: "nineteen times the trading fee",
    places: 1,
    claim: "the fee component nobody models is nineteen times the one everybody does",
    why: "The whole reason the tab has a fee model. It was said in the section lede, "
      + "again as a banner over the table and a third time in the figure's footnote; "
      + "the lede is the copy that keeps it.",
  },
  {
    phrase: "exceeds the notional traded",
    places: 1,
    claim: "on Kalshi's own documented example the net fee is larger than the trade",
    why: "The chip above the table carries the measured share with a ▲ and the Total "
      + "row carries the arithmetic, so a second sentence saying it is the third telling.",
  },
  {
    phrase: "every bot in this space ships with",
    places: 1,
    claim: "the ablation includes no_fees, the configuration every competing bot ships",
    why: "The comparison is only interesting because one arm of it is what everyone "
      + "else runs. Ablation is two views of Fees since the merge, and the sentence "
      + "leads both of them.",
  },
  {
    phrase: "they bound it",
    places: 1,
    claim: "two probabilities do not determine the probability of both — the legs give a band",
    why: "A reader who takes Πpᵢ for a fair value reads the whole Combos section "
      + "backwards. The band figure and the formula line restate the maths; only the "
      + "lede states the claim.",
  },
  {
    phrase: "not evidence of positive dependence",
    places: 1,
    claim: "a parlay priced above Πpᵢ may be nothing but the maker's margin",
    why: "The price is read from the offer and the bounds from the legs' mids, so the "
      + "comparison is mixed-basis. It belongs to `basisCaveat`, which says it once per "
      + "basis actually present in the read rather than once per card.",
  },
  {
    phrase: "claim continuity nobody observed",
    places: 1,
    claim: "an unmeasurable index reading is a gap, never a zero and never dropped",
    why: "A line closed over a gap asserts a reading nobody took. The figure's footnote "
      + "counts the gaps; the lede is what says why they are drawn as gaps at all.",
  },
  {
    phrase: "it sends nothing",
    places: 1,
    claim: "the engine reads, records and certifies; there is no send path in this version",
    why: "The one claim on the tab a reader could most damagingly get wrong. It is a "
      + "head metric so it is on screen on every section, which is why no section repeats it.",
  },
  {
    phrase: "wins in every state",
    places: 2,
    claim: "the failure certificate is a portfolio that pays in every settlement state",
    why: "Two places on purpose, and they are different objects: the page description "
      + "states what the tab is for, and the paragraph leading the Payoff and Legs views "
      + "names what the solver hands back. A reader arriving by deep link sees only the "
      + "second, and a reader on any other section sees only the first.",
  },
];

describe("every load-bearing claim on this tab is still made", () => {
  for (const claim of CLAIMS) {
    it(`${claim.claim} — in ${claim.places} place(s)`, () => {
      const carriers = FILES.filter((file) => (COPY.get(file) as string).includes(claim.phrase));
      assert.equal(
        carriers.length,
        claim.places,
        `"${claim.phrase}" is in ${carriers.length} file(s), expected ${claim.places}.\n`
          + `  The claim: ${claim.claim}\n  Why: ${claim.why}\n`
          + `  Found in: ${carriers.join(", ") || "nothing"}\n`
          + "  If the claim was retired or moved deliberately, edit this entry in the same change.",
      );
    });
  }
});

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
  calibration: "components/coherence/CalibrationPane.tsx",
  diffusion: "components/coherence/DiffusionPane.tsx",
  lessons: "components/coherence/LessonsPane.tsx",
};

/**
 * The reading suite's five, all of them Prices sections. Named here so the
 * union can be checked against BOTH rails: a section neither suite heads would
 * be guarded by neither, and both files would stay green while a head grew a
 * second sentence.
 *
 * Five names have left this file over the day — `portfolio`, `ablation`,
 * `findings`, `index` and `combos` — and none appears below either, because
 * none is a section any more. They are views of `certificate`, `fees`,
 * `diffusion`, `calibration` and `certificate`, and a view has no head to
 * check; the sentences their heads carried are still on screen, still pinned in
 * CLAIMS above, as the paragraph each view opens with. The last two were
 * PUBLISHED ids, so their links are carried by `RELOCATED_SECTIONS` rather than
 * by a head.
 */
// SIX since the fifth review of 2026-08-24, not five: `stake` left `lattice`
// and became a rail section with a head of its own. The lattice was stacking a
// five-view seg, a second three-view seg and a family picker above its first
// data, and "what measure do these prices imply" is not "what would it be right
// to bet" — two questions, two sections. Its head lives in `StakePane`, and the
// reading suite's OWNERS map names it there.
const QUOTED = ["universe", "books", "lattice", "stake", "fees", "shell"];

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
