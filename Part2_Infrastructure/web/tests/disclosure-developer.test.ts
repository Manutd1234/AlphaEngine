/**
 * The Developer tab's progressive-disclosure sweep, pinned in both directions.
 * Every reviewed sentence records whether it remains folded, moved back inline,
 * or was deliberately removed as redundant guidance. Keeping all six records
 * preserves the suite's test-count contract while ensuring a removed summary
 * cannot quietly return around the same copy.
 *
 * Empty states, null explanations, safety boundaries and figures a reader acts
 * on stay outside every fold. Prose comparisons collapse JSX whitespace because
 * indentation is not rendered text. `copy-audit.test.ts` owns the tree-wide
 * four-gram rule; the final block re-derives it for this tab alone.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const FILES = [
  "components/DeveloperConsole.tsx",
  "components/developer/CodebaseExplorer.tsx",
  "components/developer/DeveloperApiCatalog.tsx",
  "components/developer/DeveloperInterfaces.tsx",
  "components/developer/DeveloperOverview.tsx",
  "components/developer/DeveloperPipelines.tsx",
  "components/developer/DeveloperStatus.tsx",
  "components/developer/DeveloperWorkQueue.tsx",
  // A fold is invisible in a diff, so a file left out of this scan is a file
  // where every fold is invisible. These joined it the day they were written.
  "components/developer/NumericsCustodyChain.tsx",
  "components/developer/NumericsCustodyDigest.tsx",
] as const;

/** Source by path. `readSource` throws on a missing or empty file. */
const sources = new Map<string, string>(FILES.map((file) => [file, readSource(file)] as const));

const source = (file: string) => {
  const text = sources.get(file);
  assert.ok(text && text.length > 0, `${file} read as empty — every scan below would pass on nothing`);
  return text;
};

/** Comments blanked: a comment quoting a sentence is not the sentence rendering. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** What the reader sees: JSX indentation collapsed to single spaces. */
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Every `<details>` block in a file, as its collapsed source text.
 *
 * Non-greedy to the first `</details>`, which is exact here because no
 * developer file nests one disclosure inside another — asserted below, so the
 * day one does this reader fails instead of silently reading half a block.
 */
function disclosures(file: string): string[] {
  return [...code(source(file)).matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => collapse(m[0]));
}

/** The summary text and the first 300 characters it hides, per disclosure. */
function summaryBodies(file: string): Array<{ summary: string; body: string }> {
  return [...code(source(file)).matchAll(/<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)].map((m) => ({
    summary: collapse(m[1]),
    body: collapse(m[2].replace(/<[^>]+>/g, " ")).slice(0, 300),
  }));
}

/** Contiguous n-word phrases, lowercased, words only — copy-audit's measure. */
function phrases(text: string, n = 4): Set<string> {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  return new Set(
    Array.from({ length: Math.max(0, words.length - n + 1) }, (_, i) => words.slice(i, i + n).join(" ")),
  );
}

// ---------------------------------------------------------------------------

/**
 * The six blocks this sweep reviewed. `placement` is part of the contract:
 * folded methodology stays folded, inline evidence stays visible, and retired
 * generic guidance stays absent.
 */
const MOVED = [
  {
    file: "components/developer/DeveloperPipelines.tsx",
    placement: "folded",
    summary: "What custody attests, and what it leaves to other evidence",
    text:
      "Custody passes only when the pinned Ed25519 signer attests this commit, environment and "
      + "build provenance; release bundles and promotion records are separate evidence.",
    why: "methodology and limitation, under a fully populated lineage table that keeps the card"
      + " from going blank; the custody verdict itself is a pill and stays on screen",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    placement: "removed",
    summary: "Ready to change it?",
    text: "File or link a work item; the contract, parity, type and build gates verify it.",
    why: "guidance about a workflow elsewhere, not a fact about the selected file; the summary is"
      + " the block's own existing question moved verbatim, no new prose invented",
  },
  {
    file: "components/DeveloperConsole.tsx",
    placement: "inline",
    summary: "What this manifest holds, and where the diffs live",
    text: "Committed path manifest, not source contents; GitHub carries blame, history and diffs.",
    why: "a why-this-is-withheld note whose answer is demonstrated directly beneath it — the"
      + " explorer renders the manifest and links every path to source",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    placement: "inline",
    summary: "Snapshot scope, refresh command and manifest commit",
    text: "Refresh with <code>npm run catalog:refresh</code> when files are added or removed; manifest commit",
    why: "a scope caveat and a provenance explanation, over a stats strip that keeps the card"
      + " numerate at rest: the manifest's As-of date and its file, area, test and route counts"
      + " are all outside this fold, so what is hidden is how the snapshot was made rather than"
      + " what it measured",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    placement: "folded",
    summary: "Which three runtimes have to agree, and on what",
    text:
      "The committed reference, this deployment&apos;s Node and your browser all recompute the "
      + "same {MC_PARITY_PATHS.toLocaleString()}-path bootstrap, and must agree byte for byte.",
    why: "the methodology half of the parity paragraph; the result half rides on state.detail and"
      + " stays outside the fold",
  },
  {
    file: "components/developer/DeveloperStatus.tsx",
    placement: "folded",
    ownerClass: "developer-cp-state-guide",
    summary: "How to read the State column",
    text:
      "Gateway OpenAPI, runtime payload contracts and Monte Carlo numerics take their verdicts "
      + "from the current health payload. Gateway payloads and Risk parity remain unverified because "
      + "that payload carries no cross-runtime result for either comparison.",
    why: "the first sentence identifies every health-backed row, while the second keeps both"
      + " configured cross-runtime comparisons from borrowing unrelated live evidence",
  },
] as const;

/**
 * The honesty floor. Each of these may be read by someone who is about to act,
 * or is the only thing standing between a reader and a wrong belief about a
 * number. None may be folded, in this sweep or a later one.
 */
const VISIBLE = [
  {
    file: "components/developer/DeveloperApiCatalog.tsx",
    text:
      "Market-data routes are signals, not execution authority; order and risk writes stay "
      + "behind the authenticated gateway.",
    why: "SAFETY. This catalogue lists the paper-order, risk and cancel/replace writes and gives"
      + " every row a working Copy curl button. This is the only line on screen saying which"
      + " routes may not execute and that the write path is authenticated — a fold does not"
      + " belong between a reader and the guard rail for a command they are about to paste.",
  },
  {
    file: "components/developer/DeveloperOverview.tsx",
    text: "could not be checked at all, so ",
    why: "NULL EXPLANATION for the panel's headline figure. The ring renders readyCount/5 and a"
      + " one-word verdict, and this is the only prose separating BLOCKED from UNVERIFIED. Fold"
      + " it and 3/5 PASS under UNVERIFIED reads as two failures.",
  },
  {
    file: "components/developer/DeveloperOverview.tsx",
    text: "All five gates have current evidence.",
    why: "The all-clear half of the same sentence. An empty state is still a state: the panel"
      + " must say the gates were checked and passed, not fall silent.",
  },
  {
    file: "components/developer/DeveloperPipelines.tsx",
    text: "Configured checks only; the linked Actions run carries the verdicts.",
    why: "WITHHELD-FIGURE explanation in a section hero. The stages below are configuration, not"
      + " outcomes; this line is what stops a configured stage being read as a passing one.",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    text: "Its ownership, purpose, and canonical source link will appear here.",
    why: "EMPTY STATE. A panel that says nothing when no path is selected looks broken.",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    text:
      "<div className=\"codebase-explorer__asof\"><span>As of</span>"
      + "<strong className=\"num\">{REPOSITORY_MANIFEST_PROVENANCE.generatedAt}</strong></div>",
    why: "FIGURES A READER ACTS ON, and the date that qualifies them. The provenance fold beside"
      + " this strip is only defensible while the stamp and the four counts are outside it: a"
      + " count whose date is one click away has already been believed, which is the defect"
      + " tests/repository-provenance.test.ts exists to catch.",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    text: "<div><span>Files</span><strong className=\"num\">{REPOSITORY_STATS.files}</strong></div>",
    why: "FIGURE A READER ACTS ON. The headline count of the card, and the first of the four the"
      + " As-of stamp dates; folding it would leave a repository map that states no size.",
  },
  {
    file: "components/developer/DeveloperApiCatalog.tsx",
    text: "Clear the search or choose another API domain.",
    why: "EMPTY STATE for a filtered list, and the only way back out of an empty filter.",
  },
  {
    file: "components/developer/DeveloperPipelines.tsx",
    text: "No suite reports a documented baseline.",
    why: "EMPTY STATE for the test-count bars, and the reason a suite with no count is absent"
      + " rather than plotted as zero.",
  },
] as const;

// ---------------------------------------------------------------------------

describe("the developer sweep keeps each reviewed block in its approved disposition", () => {
  it("reads ten non-empty developer sources", () => {
    // The guard that makes every negative assertion below mean something: a
    // scan of an empty string satisfies `doesNotMatch` and proves nothing.
    for (const file of FILES) assert.ok(source(file).length > 500, `${file} is too short to be the real file`);
    assert.equal(FILES.length, 10, "a developer source joined or left the tab without joining this sweep");
  });

  for (const moved of MOVED) {
    it(`${moved.file}: the reviewed sentence matches its approved copy`, () => {
      const present = collapse(source(moved.file)).includes(collapse(moved.text));
      assert.equal(
        present,
        moved.placement !== "removed",
        `${moved.file} no longer matches the ${moved.placement} disposition for "${moved.text}"`,
      );
    });

    it(`${moved.file}: it uses the approved disclosure placement`, () => {
      const blocks = disclosures(moved.file);
      const holder = blocks.find((block) => block.includes(collapse(moved.text)));
      if (moved.placement === "folded") {
        assert.ok(holder, `${moved.summary} is no longer folded — ${moved.why}`);
        assert.ok(holder.includes(`<summary>${moved.summary}</summary>`), moved.why);
        if ("ownerClass" in moved) assert.ok(holder.includes(moved.ownerClass), `${moved.summary} lost ${moved.ownerClass}`);
      } else {
        assert.equal(holder, undefined, `${moved.summary} is folded again — ${moved.why}`);
        assert.ok(!collapse(source(moved.file)).includes(`<summary>${moved.summary}</summary>`), `${moved.summary} returned`);
      }
    });
  }
});

describe("the honesty floor stays on screen", () => {
  for (const [index, kept] of VISIBLE.entries()) {
    it(`${kept.file}: sentence ${index + 1} is in no disclosure`, () => {
      assert.ok(
        collapse(source(kept.file)).includes(collapse(kept.text)),
        `this sentence has been removed from ${kept.file}, which is worse than folding it:\n    `
          + `"${kept.text}"`,
      );
      for (const block of disclosures(kept.file)) {
        assert.ok(
          !block.includes(collapse(kept.text)),
          `folded behind a <details> in ${kept.file}: ${kept.why}\n    "${kept.text}"`,
        );
      }
    });
  }

  it("the parity check's state line is never folded", () => {
    // `state.detail` is "Runs entirely in this tab; nothing is uploaded." before
    // the run — a safety statement, and the only content that keeps the card
    // from being blank — and the result claim in every other state. Both ride
    // on the same interpolation, so the interpolation itself must stay outside.
    const file = "components/developer/DeveloperInterfaces.tsx";
    assert.ok(collapse(source(file)).includes("{state.detail}"), "the state line stopped rendering");
    for (const block of disclosures(file)) {
      assert.ok(
        !block.includes("{state.detail}"),
        "the parity card's state line is behind a fold: at rest it is the sandbox statement, and "
          + "in every other state it is the result the reader came for",
      );
    }
  });

  it("the custody panel's reasons for having no digest stay on screen", () => {
    /**
     * NULL EXPLANATION. The panel prints two sixty-four character digests; with
     * no second one — nobody pressed the button, the run failed, or this context
     * exposes no `crypto.subtle` — the row dashes and the note says which. Fold
     * the note and a dash sits under a heading promising a digest, which reads
     * as a broken panel, not a measurement nobody took. The three reasons are
     * different facts and none is a failed parity check.
     */
    const chain = "components/developer/NumericsCustodyChain.tsx";
    const reasons = [
      "No run in this session, so nothing has been hashed in this browser yet.",
      "The simulation did not finish, so there were no bytes to hash.",
    ];
    for (const reason of reasons) {
      assert.ok(collapse(source(chain)).includes(collapse(reason)), `the custody panel stopped saying: "${reason}"`);
      for (const block of disclosures(chain)) assert.ok(!block.includes(collapse(reason)), `folded: "${reason}"`);
    }
    // The remedy for a stale committed digest is a command, not just a fault.
    assert.match(source(chain), /node --import tsx scripts\/generate-mc-parity\.ts/);
  });

  it("no empty-state note is folded anywhere in the tab", () => {
    // The named cases above are the ones this sweep touched files near. This is
    // the general rule, so a later sweep cannot fold a NEW empty state.
    for (const file of FILES) {
      for (const block of disclosures(file)) {
        assert.doesNotMatch(
          block, /emptyNote=|__empty/,
          `${file} folds an empty state: a panel with nothing to show must say so on screen`,
        );
      }
    }
  });
});

describe("every disclosure asks a question it does not answer", () => {
  it("no summary is empty and no disclosure is", () => {
    let seen = 0;
    for (const file of FILES) {
      for (const { summary, body } of summaryBodies(file)) {
        seen += 1;
        assert.ok(summary.length > 0, `${file} has a <details> with an empty <summary>`);
        assert.ok(
          body.replace(/[^A-Za-z0-9]/g, "").length > 0,
          `${file} has a <details> whose summary hides nothing: "${summary}"`,
        );
      }
    }
    const folded = MOVED.filter((entry) => entry.placement === "folded").length;
    assert.equal(seen, folded, `expected ${folded} developer disclosures, found ${seen}`);
  });

  it("no disclosure is nested inside another", () => {
    // The block reader is non-greedy to the first `</details>`. Nesting would
    // make it read half a block, and every assertion above would go quiet.
    for (const file of FILES) {
      for (const block of disclosures(file)) {
        assert.equal(
          (block.match(/<details/g) ?? []).length, 1,
          `${file} nests a disclosure — the block reader in this file cannot see inside it`,
        );
      }
    }
  });

  it("no summary repeats a four-word phrase from the first 300 characters it hides", () => {
    // copy-audit's invariant, re-derived over this tab so a summary written by
    // this sweep fails here, beside the reason, and not only in a tree-wide scan.
    const offenders: string[] = [];
    for (const file of FILES) {
      for (const { summary, body } of summaryBodies(file)) {
        if (summary.includes("{")) continue; // built from data, not prose
        const inBody = phrases(body);
        const repeated = [...phrases(summary)].filter((phrase) => inBody.has(phrase));
        if (repeated.length) offenders.push(`${file}: "${summary}" repeats "${repeated[0]}"`);
      }
    }
    assert.deepEqual(
      offenders, [],
      "a summary states the answer it is hiding, so the reader pays for the sentence twice:\n    "
        + offenders.join("\n    "),
    );
  });

  it("every summary names its subject rather than saying More", () => {
    for (const file of FILES) {
      for (const { summary } of summaryBodies(file)) {
        assert.doesNotMatch(
          summary, /^\s*(Advanced|More|Details|Read more|Learn more)\s*$/i,
          `${file}: "${summary}" tells a reader nothing about what opening it buys`,
        );
      }
    }
  });
});
