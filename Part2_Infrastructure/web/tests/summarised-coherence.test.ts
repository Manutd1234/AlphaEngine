/**
 * The Proofs tab's copy guard — the one tab that never had one.
 *
 * Eight tabs carry a `summarised-*` guard and Markets got its own on
 * 2026-08-26. Proofs did not, and the reason is worth stating because it is the
 * reason this file reads differently from the others: on Proofs the prose is
 * not in paragraphs. Measured with `scripts/engine-prose-measure.mjs` over the
 * import closure of the seven section owners (53 files, 2026-08-26):
 *
 *     protected   6,266   (34%)  `missing=`, `reason=`, ledes, empty states
 *     folded      7,095   (39%)  inside a <details> or a notes=[…] literal
 *     foldable    4,846   (27%)  readings, open captions, other <p>
 *     total      18,207          of which <p> bodies are 1,445
 *
 * By the `<p>`-only method the Markets guard uses, Proofs reads as 1,445
 * characters and "not verbose". That is false by twelve times: the tab's
 * prose is figure props, so this guard scans the CLOSURE
 * (`tests/helpers/engine-sources.ts`), not the owners. 74% of it may not be
 * deleted at all — protected copy is the honesty the house rules require, and
 * folded copy has already moved once — so the ceiling for any cut is the 4,846
 * foldable characters, and every fold is red here before it is green.
 *
 * TWO STRIPPERS, DELIBERATELY. `stripNonCode` blanks "double" strings — which
 * is where every `notes=[…]` sentence lives — so a word-for-word check through
 * it passes over deleted prose. Presence is checked on a comments-only strip;
 * `stripNonCode` is used for nothing here. The Markets guard's header records
 * catching exactly this mistake in itself.
 *
 * THREE RULES, one clause more than Markets needs:
 *
 *   1. Folded copy is present word for word AND sits in the fold it moved to.
 *      The location half is what makes an entry red-first: add it, the sentence
 *      is still open, red; fold it, green.
 *   2. Every <summary> names AND counts what is behind it, or is listed as
 *      SINGULAR with the reason it hides exactly one object.
 *   3. A mark is never folded, and neither is a withheld reason. ▲ ✕ ○ ◌ may not
 *      sit in a <details> BODY (a summary may carry one — `ParlaysView` puts
 *      `positionMark` in the summary on purpose, so the closed state is six
 *      readings), nor inside a notes=[…] literal, nor via a helper that prints
 *      one; and no `<Figure … missing=` may sit in a body, because `Figure`
 *      draws `missing` with a ◌ that a source scan of the caller cannot see.
 *
 * Every assertion was proved against a comment containing its own literal
 * before it was trusted (docs/testing/TESTING.md, "What a source-scanning guard
 * cannot see").
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  detailsBodies, notesLiterals, proofsSources, READING_OWNED, summaries, summaryWords, withoutComments,
} from "./helpers/engine-sources";
import { read } from "./helpers/workspace-sources";

/** Whitespace collapsed, so a sentence wrapped across two source lines is still one sentence. */
const flat = (text: string) => text.replace(/\s+/g, " ");

const SOURCES = proofsSources().map((entry) => ({ path: entry.path, code: withoutComments(entry.text) }));
const byPath = (path: string) => {
  const found = SOURCES.find((entry) => entry.path === path);
  assert.ok(found, `${path} is not in the Proofs closure — is it imported by an owner?`);
  return found.code;
};

/**
 * Prose that moved behind a fold, and where. `in: "details"` means between a
 * `</summary>` and its `</details>`; `in: "notes"` means inside a brace-balanced
 * `notes={[…]}` literal (Figure folds notes behind "What this figure cannot
 * say, N", so a note IS a fold); `in: "module"` means the sentence lives in a
 * data module that a named renderer maps inside its fold.
 */
type Folded =
  | { file: string; facts: readonly string[]; in: "details" | "notes" }
  | { file: string; facts: readonly string[]; in: "module"; renderedBy: string; through: string };

const FOLDED: readonly Folded[] = [
  // Seeded with what was folded BEFORE this pass, so it cannot quietly come back out.
  { file: "components/coherence/BasketWhatIf.tsx", in: "notes", facts: ["Offers only", "Dutch book before"] },
  { file: "components/coherence/CorpusHistory.tsx", in: "notes", facts: ["record of RUNS"] },
  { file: "components/coherence/ConstraintLadder.tsx", in: "notes", facts: ["both counts are honest"] },
  { file: "components/coherence/CalibrationCorpus.tsx", in: "details", facts: ["never stands in for it"] },
  { file: "components/coherence/IndexFamilies.tsx", in: "details", facts: ["never folded into the measured ones"] },
  {
    file: "components/coherence/murphy-terms.ts", in: "module",
    facts: ["only this term notices"],
    // The glossary is mapped inside the fold as `{term.meaning}`; the sentence
    // itself lives in the module, one entry per term.
    renderedBy: "components/coherence/MurphyBars.tsx", through: "term.meaning",
  },
  { file: "components/coherence/CertificateViews.tsx", in: "details", facts: ["What it decides"] },
];

/**
 * Folds that hide exactly one object and say so; a count would be a lie of one.
 * Keyed by the summary's opening words. Every entry carries its reason.
 */
const SINGULAR: Record<string, string> = {
  // `EngineStatePanel`'s "How this budget was chosen" is shared chrome, outside
  // this closure; `engine-head-state` owns it.
  "Where these numbers came from": "one wire paragraph — the engine's detail for the composition",
};

const MARKS: ReadonlyArray<[string, string]> = [
  ["▲", "a finding the reader must act on"],
  ["✕", "a failure"],
  ["○", "an absent measurement"],
  ["◌", "a measurement still waiting"],
];

describe("the closure this guard reads is the tab, not a corner of it", () => {
  it("reaches the figure files, not just the seven owners", () => {
    // An import resolver missing a specifier form shrinks the closure silently,
    // and every negative assertion below passes over the files it dropped.
    assert.ok(SOURCES.length >= 40, `only ${SOURCES.length} files reached — the resolver has lost a form`);
    for (const entry of SOURCES) {
      assert.ok(entry.code.trim().length > 200, `${entry.path} read as empty or truncated`);
    }
    for (const name of ["MurphyBars.tsx", "CorpusHistory.tsx", "ConstraintLadder.tsx", "murphy-terms.ts"]) {
      assert.ok(SOURCES.some((entry) => entry.path.endsWith(`/${name}`)), `${name} is not in the closure`);
    }
  });

  it("agrees with coherence-proof-claims about which panes are the Quotes half's", () => {
    // Two lists, one meaning. The other file cannot be imported (it runs its
    // suite at import), so its READING_OWNED block is read as text.
    const claims = read("./coherence-proof-claims.test.ts");
    const block = claims.slice(claims.indexOf("const READING_OWNED"), claims.indexOf("]);", claims.indexOf("const READING_OWNED")));
    for (const name of READING_OWNED) {
      assert.ok(block.includes(`"${name}"`), `${name} is READING_OWNED here and not in coherence-proof-claims`);
    }
  });
});

describe("what was folded is still there, word for word, and in its fold", () => {
  for (const entry of FOLDED) {
    it(`${entry.file.split("/").pop()} keeps ${entry.facts.length} fact(s) behind its ${entry.in}`, () => {
      const code = byPath(entry.file);
      if (entry.in === "module") {
        for (const fact of entry.facts) {
          assert.ok(flat(code).includes(fact), `${entry.file} lost "${fact}"`);
        }
        const renderer = byPath(entry.renderedBy);
        assert.ok(
          detailsBodies(renderer).some((body) => body.includes(entry.through)),
          `${entry.renderedBy} no longer renders ${entry.through} inside a <details> — the module's copy is open again`,
        );
        return;
      }
      const spans = entry.in === "details" ? detailsBodies(code) : notesLiterals(code);
      assert.ok(spans.length, `${entry.file} has no ${entry.in} fold at all`);
      for (const fact of entry.facts) {
        assert.ok(flat(code).includes(fact), `${entry.file} lost "${fact}" — moving prose must not edit it`);
        assert.ok(
          spans.some((span) => flat(span).includes(fact)),
          `${entry.file} still says "${fact}", but not inside a ${entry.in} — it is open again`,
        );
      }
    });
  }
});

describe("a fold names and counts what is inside it", () => {
  for (const entry of SOURCES) {
    const found = summaries(entry.code);
    if (!found.length) continue;
    it(`${entry.path.split("/").pop()}'s ${found.length} summar${found.length === 1 ? "y" : "ies"} name and count`, () => {
      for (const raw of found) {
        const words = summaryWords(raw);
        assert.ok(words.length > 6, `${entry.path} has a fold whose summary says nothing: "${words}"`);
        // Counted: a `.length` (or `count`) interpolation, a digit, or a number
        // word — so a reader knows whether opening it is worth the click.
        const counted = /\.length|\bcount\b|\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|both)\b/i.test(raw);
        const singular = Object.keys(SINGULAR).find((opening) => raw.replace(/\s+/g, " ").includes(opening));
        assert.ok(
          counted || singular,
          `${entry.path}: "${words}" neither counts what it hides nor is listed as SINGULAR with a reason`,
        );
      }
    });
  }

  it("every SINGULAR entry still names a summary that exists", () => {
    // The stale-allow-list idiom: an exemption for a summary that has since
    // gained a count, or been deleted, must leave.
    const all = SOURCES.flatMap((entry) => summaries(entry.code).map((raw) => raw.replace(/\s+/g, " ")));
    for (const opening of Object.keys(SINGULAR)) {
      assert.ok(all.some((raw) => raw.includes(opening)), `SINGULAR names "${opening}", which no summary opens with any more`);
    }
  });
});

describe("a mark is never folded, and neither is a withheld reason", () => {
  for (const entry of SOURCES) {
    const bodies = detailsBodies(entry.code);
    const notes = notesLiterals(entry.code);
    if (!bodies.length && !notes.length) continue;
    it(`${entry.path.split("/").pop()} folds no mark and no missing=`, () => {
      for (const body of bodies) {
        for (const [mark, what] of MARKS) {
          assert.ok(!body.includes(mark),
            `${entry.path} has ${mark} — ${what} — inside a <details> body. Folding an aside and folding a finding look identical in a diff, and this is the second kind.`);
        }
        assert.ok(!/positionMark\(|\bmark=\{/.test(body),
          `${entry.path} prints a status mark through a helper inside a <details> body`);
        assert.ok(!/\bmissing=/.test(body),
          `${entry.path} folds a <Figure missing=…> — Figure draws a withheld reason with a ◌, and a fold is where a reader does not look`);
      }
      for (const literal of notes) {
        for (const [mark, what] of MARKS) {
          assert.ok(!literal.includes(mark), `${entry.path} has ${mark} — ${what} — inside a notes=[…] literal`);
        }
      }
    });
  }
});
