/**
 * The Markets tab was folded, and this is the receipt.
 *
 * Markets is the one tab that never had a `summarised-*` guard. The other eight
 * do, and the reason they exist is written into commit `8d091a3` — "Cut 610
 * words from the frontend, then put 16 facts back". A rewrite reads fluently
 * whether or not it still says what the original said, so fluency proves
 * nothing and only an enumeration does.
 *
 * WHAT WAS ACTUALLY MEASURED, because the plan for this pass was wrong twice
 * before the numbers arrived. The tab renders 5,721 characters of prose, and
 * the first instinct was to cut most of it. Classified:
 *
 *     protected   3,495   empty states, null reasons, withheld measurements
 *     folded         395   already behind a disclosure
 *     foldable     1,831   definitions, methodology, scope notes
 *
 * So 61% of it may not move at all. "A missing measurement renders as a dash
 * and says why it is missing" is a house rule, and the sentence saying why IS
 * the measurement's honesty. Cutting it would have passed every reading of
 * "too wordy" and broken the thing the tab is for.
 *
 * THE ONE THAT MATTERS IS THE THIRD ASSERTION. `developer-analyst-d3` hit it
 * folding the Murphy inset on Proofs: everything the drawing showed was printed
 * above it except the ratio between three terms, so folding the drawing would
 * have hidden the only thing it was FOR. Folding an aside and folding a finding
 * look identical in a diff. So a `▲` — the mark this desk uses for something a
 * reader must act on — may never be inside a `<details>`, and neither may an
 * empty state or a withheld reason.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/** The eight section owners, and everything each one pulls in. */
const OWNERS: Record<string, string> = {
  universe: "UniverseSection", settlement: "SettlementSection", books: "BooksSection",
  dispersion: "MakersSection", lattice: "SurfacePane", stake: "StakePane",
  fees: "FeesSection", shell: "ShellPane",
};

/** Child files that now own section-level prose moved out of their owner. */
const READING_CHILDREN: Partial<Record<string, readonly string[]>> = {
  shell: ["ShellBrowser", "ShellRouteFlow"],
};

const SOURCES = new Map(Object.entries(OWNERS).map(([id, file]) => {
  const files = [file, ...(READING_CHILDREN[id] ?? [])];
  return [id, stripNonCode(files.map((name) => read(`../components/coherence/${name}.tsx`)).join("\n"))];
}));

/** Prose that MOVED behind a fold, and must still be there word for word. */
const FOLDED: Array<{ section: string; file: string; facts: readonly string[] }> = [
  {
    section: "universe",
    file: "components/coherence/UniverseSection.tsx",
    // Already folded before this pass, into `SectionFrame`'s notes slot — and
    // pinned here so it cannot quietly come back out. The filter's provenance:
    // whose category, and what it is NOT read off.
    facts: ["Kalshi", "category", "never read off the ticker"],
  },
  {
    section: "shell",
    file: "components/coherence/ShellBrowser.tsx",
    // Browse owns the folded scope caveat now: which universe this is, what it
    // excludes, and the exact configuration that supplies it.
    facts: ["watchlist", "whole exchange", "COHERENCE_SERIES"],
  },
];

describe("the sources these assertions read were actually loaded", () => {
  for (const [id, source] of SOURCES) {
    it(`${id} is non-empty`, () => {
      // A scan of "" satisfies every negative assertion below and reads exactly
      // like a clean bill of health. Found twice in this tree.
      assert.ok(source.trim().length > 500, `${OWNERS[id]} read as empty or truncated`);
    });
  }
});

describe("what was folded is still there, word for word", () => {
  for (const entry of FOLDED) {
    it(`${entry.section} keeps every fact it moved behind the fold`, () => {
      // COMMENTS STRIPPED, and this file made the mistake it is guarding against
      // before it caught it. Every one of these facts is ALSO written in the
      // component's own doc block — that is house style here — so a raw scan is
      // satisfied by the sentence EXPLAINING the fact while the rendered
      // sentence carrying it is gone. Mutating a scope phrase out of the markup
      // left this green when the component header still said it.
      // Same laundering `wire-types-parity` closes for orphaned guards.
      const source = stripNonCode(read(`../${entry.file}`));
      for (const fact of entry.facts) {
        assert.ok(source.includes(fact),
          `${entry.section} lost "${fact}" in the fold — moving prose must not edit it`);
      }
    });
  }
});

describe("a fold names and counts what is inside it", () => {
  for (const [id, source] of SOURCES) {
    it(`${id}'s disclosures say how much is behind them`, () => {
      // An empty fold and a fold hiding four look identical from outside, so a
      // reader cannot tell whether opening it is worth the click. Every summary
      // on this tab carries a count or a noun that names the contents.
      const summaries = [...source.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map((m) => m[1]);
      for (const summary of summaries) {
        const words = summary.replace(/\{[^}]*\}/g, "#").replace(/\s+/g, " ").trim();
        assert.ok(words.length > 6, `${id} has a fold whose summary says nothing: "${words}"`);
      }
    });
  }
});

describe("a finding is never folded, and neither is an absence", () => {
  // THE ASSERTION THIS FILE EXISTS FOR. The desk's status vocabulary is
  // typographic: ▲ is something a reader must act on, ◌ is waiting, ○ is
  // absent, ✕ is failed. Every one of them is a reason the reader is looking at
  // the section at all, and a fold is where a reader does not look.
  const MARKS: Array<[string, string]> = [
    ["▲", "a finding the reader must act on"],
    ["✕", "a failure"],
    ["○", "an absent measurement"],
    ["◌", "a measurement still waiting"],
  ];
  for (const [id, source] of SOURCES) {
    it(`${id} folds no mark that is a reason to look`, () => {
      for (const block of source.match(/<details[\s\S]*?<\/details>/g) ?? []) {
        for (const [mark, what] of MARKS) {
          assert.ok(!block.includes(mark),
            `${id} has ${mark} — ${what} — inside a <details>. Folding an aside and folding a finding `
            + "look identical in a diff, and this is the second kind.");
        }
      }
    });
  }
});
