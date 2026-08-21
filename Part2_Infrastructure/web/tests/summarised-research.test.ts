/**
 * The research tab's summarisation pass, pinned fact by fact.
 *
 * This is the third pass over this copy and it is not the first two. Pass one
 * DELETED sentences that restated a neighbour. Pass two FOLDED prose behind a
 * `<details>` byte-identical, so the words moved and nothing changed. This pass
 * REWRITES: the same fact, in fewer words.
 *
 * `8d091a3` — "Cut 610 words from the frontend, then put 16 facts back" — is
 * why every rewrite below is enumerated rather than reviewed. A shortening pass
 * cut hard, lost sixteen facts, and had to restore them; four areas failed a
 * fact-loss verifier on the way. Fluency is not the property being checked
 * here. Survival is.
 *
 * So each entry names a sentence that was rewritten and lists the assertable
 * tokens it carries — numbers, units, thresholds, named entities, negations and
 * qualifiers. A rewrite that reads beautifully and drops "only", "at least",
 * "rather than" or a route path has lost a fact, and this file is what says so.
 *
 * WHAT THIS FILE DELIBERATELY IS NOT is a length cap. `copy-audit.test.ts`
 * opens by refusing to cap length for the reason that applies here too: a test
 * that cannot tell "detailed" from "wordy" pushes the desk toward saying less
 * than it knows, which is the failure this pass exists downstream of. Nothing
 * below rewards brevity. Everything below punishes loss.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/**
 * Comments blanked. A comment explaining a rewrite is not on screen, and must
 * never be able to satisfy a test about what the reader can still see — the
 * exact hole a fact-loss verifier has to be built without.
 */
const stripComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, lead: string) => lead);

const ENTITIES: Record<string, string> = {
  "&apos;": "'",
  "&rsquo;": "’",
  "&ndash;": "–",
  "&mdash;": "—",
  "&ldquo;": "“",
  "&rdquo;": "”",
  "&amp;": "&",
  "&nbsp;": " ",
};

/**
 * The comment-stripped source, flattened, with adjacent string literals
 * rejoined. A `+` wrap is the formatter speaking, not a change of wording, and
 * several of this tab's longest sentences are written across two or three
 * literals.
 */
function flat(source: string): string {
  return stripComments(source)
    .replace(/"\s*\+\s*"/g, "")
    .replace(/`\s*\+\s*`/g, "")
    .replace(/&[a-z]+;/g, (entity) => ENTITIES[entity] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Everything a reader can see, whitespace-flattened: the JSX text nodes AND the
 * source they sit in, so a sentence that lives in a `title=`, an `aria-label=`
 * or a prose constant is scannable too.
 *
 * The union is deliberate. Stripping tags alone loses every rendered attribute:
 * `<[^>]*>` runs from `<StatTile` to the first `>` after it, which on a
 * multi-line element is the closing slash — and the `explain={{ plainEnglish:
 * "…" }}` gloss inside goes with it. That is exactly how a fact test passes by
 * finding nothing, so both readings are searched and tokens are written as
 * multi-word phrases rather than single words that an identifier could satisfy.
 *
 * Comments are blanked before either reading, so no rewrite can be justified by
 * the comment that explains it.
 */
function prose(source: string): string {
  const base = flat(source);
  const nodes = base.replace(/<\/?[A-Za-z][^>]*>|<\/>/g, " ").replace(/\s+/g, " ");
  return `${nodes} ${base}`;
}

interface Rewrite {
  file: string;
  /** The sentence, named as a reader would ask for it. */
  sentence: string;
  /** Every assertable token the original carried. All of them must survive. */
  tokens: string[];
}

/**
 * The ledger. One entry per sentence this pass rewrote; every token is a fact
 * the original asserted and the rewrite still asserts.
 *
 * Tokens are matched against the file's prose after entity decoding and
 * whitespace flattening, so a token may span the line break JSX puts in.
 */
const REWRITES: Rewrite[] = [
  {
    file: "components/Controls.tsx",
    sentence: "the friction group's flat-bps parity note",
    tokens: [
      "Beyond flat fee and slippage",
      "each defaults to zero",
      // "run" bounds the parity claim and "makes it a model of" keeps the hedge:
      // both were dropped by the rewrite and restored after the fact-loss audit.
      "At all zeros this run matches",
      "gateway's reference engine exactly",
      "any non-zero value makes it a model of",
    ],
  },
  {
    file: "components/Controls.tsx",
    sentence: "the square-root impact note",
    tokens: [
      "Square-root impact",
      "(order ÷ ADV)",
      "Doubling size costs about 1.41×",
      "not 2×",
      "both must be non-zero to apply",
    ],
  },
  {
    file: "components/Controls.tsx",
    sentence: "the funding and borrow note",
    tokens: [
      // The preposition is the fact: "charged ON absolute exposure" names the basis
      // the fee is computed against, where "charges absolute exposure" makes funding
      // the agent and the exposure the thing billed. Restored after the audit.
      "Funding is charged on absolute exposure every bar",
      "borrow only on short exposure",
      "inert in a long-only run",
    ],
  },
  {
    file: "components/research/ResearchSummary.tsx",
    sentence: "the annualised Sharpe tile's plain-English gloss",
    tokens: [
      "Return the strategy earned for the amount it bounced around",
      "Beating the market matters less than beating it per unit of risk",
    ],
  },
  {
    file: "components/research/ResearchSummary.tsx",
    sentence: "the max drawdown tile's plain-English gloss",
    tokens: [
      "The worst losing streak you would have sat through",
      "whether a strategy is tradable",
      "a great Sharpe with a 60% drawdown",
      "turned off long before it recovers",
    ],
  },
  {
    file: "components/research/MlRunCapsule.tsx",
    sentence: "the withheld feature spec hash",
    tokens: [
      "Feature spec hash: on the run detail record",
      "GET /api/research/ml/runs/{run_id}",
      "not read back yet",
      "Two runs are comparable only once their spec hashes are",
    ],
  },
  {
    file: "components/research/MlRunCapsule.tsx",
    sentence: "the purge and embargo definition",
    tokens: [
      "Bars dropped from each training window's end",
      "labels reach into the test window (purge)",
      "the next window's start (embargo)",
      "A range means the folds disagreed",
      "Zero is a claim, not an absence",
    ],
  },
  {
    file: "components/research/BenchmarkPanel.tsx",
    sentence: "the hint said when no benchmark control is on screen at all",
    tokens: [
      "No benchmark control on this screen",
      "it lives in the research rail's setup panel",
    ],
  },
  {
    file: "components/research/FactorPanel.tsx",
    sentence: "the insignificant-alpha banner",
    tokens: [
      "Alpha is not statistically distinguishable from zero",
      "below {T_SIGNIFICANT}",
      "What market, trend and volatility exposure do not explain",
      "within this sample's noise",
    ],
  },
  {
    file: "components/research/QualityScorePanel.tsx",
    sentence: "the gate note's score-versus-veto clause",
    tokens: [
      "The score ranks, the gate below vetoes",
      "a high score does not override a veto",
    ],
  },
  {
    file: "components/research/ConnectedDocuments.tsx",
    sentence: "the failed graph walk",
    tokens: [
      "The graph could not be walked",
      "Not the same as nothing being connected",
    ],
  },
  {
    file: "components/research/ConnectedDocuments.tsx",
    sentence: "the absent graph",
    tokens: [
      "No graph here",
      "either the corpus is unconfigured",
      "or this deployment predates the traversal function",
    ],
  },
  {
    file: "components/research/RunComparison.tsx",
    sentence: "the comparability-unknown banner",
    tokens: [
      "At least one run predates dataset fingerprinting",
      "nothing can confirm they saw the same prices",
    ],
  },
  {
    file: "components/research/ExperimentHistory.tsx",
    sentence: "the cross-run multiple-testing banner",
    tokens: [
      "Deflated Sharpe prices only the grid inside that run",
      "the best row's DSR overstates the evidence: a maximum over",
      "searches",
    ],
  },
];

/** Every file the ledger touches, deduplicated. */
const TOUCHED = [...new Set(REWRITES.map((entry) => entry.file))];

describe("the summarisation pass reads what it is checking", () => {
  it("loads every rewritten file, non-empty", () => {
    // A scan of an empty string satisfies every containment test ever written,
    // and this tree has found that trap more than once. Nothing below runs
    // before this does.
    assert.ok(TOUCHED.length >= 8, `expected the rewritten files, found ${TOUCHED.length}`);
    for (const file of TOUCHED) {
      const text = read(file);
      assert.ok(text.trim().length > 200, `${file} loaded empty or near-empty`);
      assert.ok(prose(text).length > 200, `${file} reduced to no prose at all`);
    }
  });

  it("every entry enumerates facts rather than asserting nothing", () => {
    // A ledger row with no tokens passes silently and proves nothing about the
    // sentence it names.
    for (const entry of REWRITES) {
      assert.ok(
        entry.tokens.length >= 2,
        `${entry.file}: "${entry.sentence}" enumerates ${entry.tokens.length} tokens`,
      );
    }
  });
});

describe("no rewrite dropped a fact", () => {
  for (const entry of REWRITES) {
    it(`${entry.file}: ${entry.sentence}`, () => {
      const text = prose(read(entry.file));
      for (const token of entry.tokens) {
        assert.ok(
          text.includes(token),
          `the rewrite of ${entry.sentence} lost "${token}" from ${entry.file}`,
        );
      }
    });
  }
});

/**
 * The four shapes `8d091a3` lost, asserted directly rather than trusted to the
 * ledger above.
 *
 * Each is a class of token whose removal reads as a tidier sentence and is a
 * different claim: a negation, a bound on a scope, a hedge, and the reason a
 * measurement is missing. A rewrite anywhere in this tab that eats one of these
 * fails here even if its own ledger row was written to accommodate it.
 */
describe("the tokens a shortening pass eats first are still here", () => {
  it("negations and qualifiers survive where they carry the claim", () => {
    const pairs: [string, string][] = [
      ["components/research/SizingPanel.tsx", "Sized to zero rather than inverted"],
      ["components/research/SizingPanel.tsx", "Payoff ratio is undefined, not infinite"],
      ["components/research/BenchmarkPanel.tsx", "not, on its own, evidence of an edge"],
      ["components/research/RunComparison.tsx", "At least one run predates"],
      ["components/research/FavouritesPanel.tsx", "Save at least two runs"],
      ["components/research/MlRunCapsule.tsx", "Zero is a claim, not an absence"],
      ["components/research/ConnectedDocuments.tsx", "Not the same as nothing being connected"],
      ["components/research/TearSheet.tsx", "1 bar in 20 loses at least this"],
    ];
    for (const [file, fragment] of pairs) {
      const text = prose(read(file));
      assert.ok(text.length > 200, `${file} scanned as empty`);
      assert.ok(text.includes(fragment), `${file} lost the qualifier in "${fragment}"`);
    }
  });

  it("a missing measurement still carries the reason it is missing", () => {
    // "Not read back yet" alone is worse than naming the record that holds the
    // field, which is the difference between a reader waiting and a reader
    // checking. Both withheld ML fields name their route; the capsule test
    // counts them, and this states why the count is two.
    // Counted on the flattened source rather than the union scan: the union
    // reads the file twice, and a count taken over it would report two where
    // one field named its record.
    const capsule = flat(read("components/research/MlRunCapsule.tsx"));
    assert.ok(capsule.length > 200, "the capsule scanned as empty");
    const routes = capsule.match(/GET \/api\/research\/ml\/runs\/\{run_id\}/g) ?? [];
    assert.ok(routes.length >= 2, `both withheld fields must name their record, found ${routes.length}`);
    assert.ok(capsule.includes("The corpus returned no seed, which its own schema forbids"));
    assert.ok(capsule.includes("Fitted by a build with no git tree, so the code cannot be named"));
  });

  it("no rewrite turned a scope caveat into a general claim", () => {
    // Each of these binds a statement to the window, the browser or the run it
    // was measured over. Drop the bound and the sentence is a claim about
    // everything, which is the one edit that reads as a simplification and is a
    // different assertion.
    const bounds: [string, string][] = [
      ["components/research/ExperimentHistory.tsx", "No runs recorded yet in this browser"],
      ["components/research/StrategyCodex.tsx", "from this browser's run log (last 60 runs)"],
      ["components/research/ResearchCorpus.tsx", "not the open web"],
      ["components/research/RegimePanel.tsx", "not in data window"],
      ["components/research/FittedModels.tsx", "Every figure here is out of sample"],
      // Moved behind a fold by the disclosure pass and reworded by exactly one
      // em dash on the way — it used to trail the "Monthly returns" subhead.
      // Both bounds are the point: the compounding is per calendar month, and
      // the first and last month may cover fewer bars than the rest.
      ["components/research/TearSheet.tsx", "Compounded within each calendar month"],
      ["components/research/TearSheet.tsx", "a partial first or last month is shorter than the rest"],
    ];
    for (const [file, fragment] of bounds) {
      const text = prose(read(file));
      assert.ok(text.length > 200, `${file} scanned as empty`);
      assert.ok(text.includes(fragment), `${file} lost the scope bound in "${fragment}"`);
    }
  });
});
