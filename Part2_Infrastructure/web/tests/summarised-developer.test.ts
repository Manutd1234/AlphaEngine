/**
 * The Developer tab's summarisation pass, pinned so a shorter sentence stays a
 * true one.
 *
 * Two passes came before this one. The first DELETED redundant sentences and
 * stopped when what was left was load-bearing. The second FOLDED prose behind
 * `<details>` byte for byte. This one is neither: it REWRITES — the same fact,
 * in fewer words — and that is the pass with a failure already recorded in this
 * repository. Commit `8d091a3`, "Cut 610 words from the frontend, then put 16
 * facts back", is a summarisation that read fluently and lost sixteen facts,
 * four areas of it failing a fact-loss verifier before they were restored.
 *
 * So the unit here is not the sentence, it is the FACT. Every sentence this
 * pass shortened is listed below with the assertable tokens it carries — the
 * numbers, the units, the named entities, the negations and the qualifiers —
 * and each token is asserted to still appear in the file. A rewrite that reads
 * beautifully and drops "only", "not", "yet" or "20" has lost a fact however
 * short it got, and this file is what says so.
 *
 * Three things are asserted, in three blocks:
 *
 *   1. Each rewrite SHIPPED: the shortened form is in the file verbatim, the
 *      longer form is not. Without the second half a later pass could restore
 *      the long sentence and every fact assertion would still pass.
 *   2. Each rewrite KEPT ITS FACTS: every enumerated token survives.
 *   3. The tab's whole fact inventory survives — every number, unit, entity,
 *      negation and qualifier the Developer tab renders. This is the block that
 *      would have caught `8d091a3`, because it does not care which sentence a
 *      fact was living in when it went missing.
 *
 * A fourth block records what this pass REFUSED to touch, with the reason, so
 * the refusals are a claim in the suite rather than a note in a report.
 *
 * Prose is compared with whitespace collapsed. JSX indentation is not rendered
 * text, and a test reading leading spaces would fail on a reindent while a real
 * reword walked past it.
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
  // `NumericsCustody*.tsx` are inventoried in developer-custody, in this shape.
] as const;

const sources = new Map<string, string>(FILES.map((file) => [file, readSource(file)] as const));

/**
 * One file's source, guarded non-empty.
 *
 * The trap this tree has found repeatedly: a scan of an empty string satisfies
 * every `doesNotMatch` and proves nothing, so a broken read reads exactly like
 * a clean bill of health. Nothing below runs until this has passed.
 */
const source = (file: string) => {
  const text = sources.get(file);
  assert.ok(text && text.length > 500, `${file} read as empty or far too short — every scan below would pass on nothing`);
  return text;
};

/** Comments blanked: a comment quoting a sentence is not the sentence rendering. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\/|(^|[^:"'`])\/\/[^\n]*/g, "$1");

/** What the reader sees: every run of whitespace collapsed to one space. */
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** One file's rendered source, comments gone and indentation collapsed. */
const rendered = (file: string) => collapse(code(source(file)));

/** Every file the tab renders from, as one string. */
const tab = () => FILES.map(rendered).join(" ");

// ---------------------------------------------------------------------------

/**
 * The sentences this pass rewrote.
 *
 * `facts` is the enumeration done BEFORE the rewrite was written: the tokens
 * the original sentence asserts. Every one has to survive into `after`, and
 * every one is checked against the file rather than against `after`, so a
 * rewrite cannot satisfy this table by quoting itself.
 */
const REWRITES: ReadonlyArray<{
  file: string;
  what: string;
  before: string;
  after: string;
  facts: readonly string[];
  cut: string;
}> = [
  {
    file: "components/DeveloperConsole.tsx",
    what: "the tab's PageHead description",
    before: "What is deployed, what CI proved, and where the schema contracts stand.",
    after: "What is deployed, what CI proved, where the schema contracts stand.",
    facts: ["What is deployed", "what CI proved", "where the schema contracts stand"],
    cut: "the conjunction between the second and third question; three questions, no connective needed",
  },
  {
    file: "components/developer/DeveloperStatus.tsx",
    what: "the gateway state before the first poll answers",
    before: "Gateway health has not arrived yet.",
    after: "Waiting for gateway health.",
    facts: ["Waiting for gateway health", "\"Checking\""],
    cut: "'has not arrived yet' restated as 'Waiting for', which carries the same not-yet and matches"
      + " the three sibling states in this file",
  },
  {
    file: "components/developer/DeveloperStatus.tsx",
    what: "the OpenBB provider state before the first poll answers",
    before: "Provider health has not arrived yet.",
    after: "Waiting for provider health.",
    facts: ["Waiting for provider health", "OpenBB is not configured"],
    cut: "same restatement, and the readiness panel already words this exact condition 'Waiting for"
      + " provider health.'",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    what: "the Numerics pane hint",
    before: "Recompute the Monte Carlo reference and compare it byte for byte",
    after: "Recompute the Monte Carlo reference and compare byte for byte",
    facts: ["Recompute", "Monte Carlo", "reference", "compare", "byte for byte"],
    cut: "the pronoun re-naming the object of the verb beside it",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    what: "the Contracts pane hint",
    before: "Which compatibility gates are automated, and which are unverified",
    after: "Which compatibility gates are automated, and which unverified",
    facts: ["compatibility gates", "automated", "unverified"],
    cut: "the second copy of the verb; the ellipsis is what English does here",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    what: "the browser parity card's heading",
    before: "Run the parity check in this browser",
    after: "Parity check in this browser",
    facts: ["Parity check in this browser", "Run in this browser"],
    cut: "the imperative the card's own button carries verbatim, forty pixels below; every other"
      + " heading on this tab is a noun phrase",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    what: "the repository map's heading",
    before: "Browse the complete codebase snapshot",
    after: "The complete codebase snapshot",
    facts: ["complete codebase snapshot", "Search files"],
    cut: "the verb for an affordance the search field and file list beneath it already are;"
      + " 'complete' is the claim and stays",
  },
  {
    file: "components/developer/CodebaseExplorer.tsx",
    what: "the filtered-empty note in the file list",
    before: "Try a shorter search or clear the code-area filter.",
    after: "Shorten the search, or clear the code-area filter.",
    facts: ["Shorten the search", "clear the code-area filter", "No matching paths"],
    cut: "'Try a' — throat-clearing in front of an instruction",
  },
  {
    file: "components/developer/DeveloperWorkQueue.tsx",
    what: "the acceptance-note placeholder in the composer",
    before: "Why it matters and how a reviewer will know it is done",
    after: "Why it matters, and how a reviewer knows it is done",
    facts: ["Why it matters", "how a reviewer knows it is done"],
    cut: "a modal that adds no fact to a placeholder describing what to type",
  },
  {
    file: "components/developer/DeveloperWorkQueue.tsx",
    what: "the empty-state note under a filtered queue",
    before: "Clear a filter or create a new feature, bug, or ticket.",
    after: "Clear a filter, or create a feature, bug or ticket.",
    facts: ["Clear a filter", "create a feature", "bug or ticket", "No matching work"],
    cut: "'new' in front of 'create', which cannot create anything else",
  },
  {
    file: "components/developer/DeveloperApiCatalog.tsx",
    what: "the working-orders route purpose",
    before: "Orders resting on the book right now",
    after: "Orders resting on the book now",
    facts: ["Orders resting on the book now"],
    cut: "'right' before 'now'",
  },
  {
    file: "components/developer/DeveloperApiCatalog.tsx",
    what: "the blocked-clipboard announcement",
    before: "Clipboard access was blocked; select the path directly instead.",
    after: "Clipboard access was blocked; select the path instead.",
    facts: ["Clipboard access was blocked", "select the path instead"],
    cut: "'directly', whose contrast is already carried by 'instead'",
  },
] as const;

/**
 * The tab's whole fact inventory: every number, unit, threshold, named entity,
 * negation and qualifier the Developer tab renders.
 *
 * Not organised by sentence, deliberately. `8d091a3` lost sixteen facts and the
 * thing that finally found them was a scan that did not care which sentence a
 * fact had been living in. A later pass may move any of these; it may not drop
 * one.
 */
const TAB_FACTS: ReadonlyArray<readonly [string, string]> = [
  // Numbers, units and thresholds.
  ["8000", "the uvicorn port in the gateway-offline instruction"],
  ["sha256", "the digest the numerics claim is made in"],
  // Succeeds `MC_PARITY_REFERENCE_SHA256.slice(0, 12)`: whole digest, not a prefix.
  ["sha256 ${evidence.expectedDigest}", "the numerics digest in the schema row, whole rather than a prefix"],
  ["MC_PARITY_PATHS.toLocaleString()", "the bootstrap path count all three runtimes must agree on"],
  ["TEST_COUNTS.generatedOn", "the date the test totals were measured"],
  ["TEST_COUNTS.gateway.total", "the gateway suite's measured count"],
  ["TEST_COUNTS.web.total", "the web suite's measured count"],
  ["TEST_COUNTS.service.total", "the OpenBB service suite's measured count"],
  ["REPOSITORY_STATS.files", "the manifest's file count"],
  ["REPOSITORY_STATS.areas", "the manifest's code-area count"],
  ["REPOSITORY_STATS.tests", "the manifest's test count"],
  ["REPOSITORY_STATS.webRoutes", "the manifest's route count"],
  ["REPOSITORY_MANIFEST_PROVENANCE.generatedAt", "the date that qualifies every manifest figure"],
  ["REPOSITORY_MANIFEST_PROVENANCE.commit", "the commit the manifest was generated at"],
  ["All five gates", "the gate count in the all-clear sentence"],
  ["h open", "the age unit under a day"],
  ["d open", "the age unit over a day"],
  // Named entities.
  ["Ed25519", "the signer custody names"],
  ["FastAPI", "the gateway runtime"],
  ["OpenAPI", "the gated contract"],
  ["Vercel", "the deployment platform the readiness gate tests for"],
  ["GitHub", "where blame, history and diffs live"],
  ["Monte Carlo", "the numerics under parity"],
  ["OpenBB", "the third deployable"],
  ["Next.js", "what the web job builds"],
  ["TypeScript", "the strict gate in the web job"],
  ["pytest", "the gateway and service job command"],
  ["ruff", "the gateway job's lint gate"],
  ["Telegram", "the connect-token route"],
  ["Oracle", "the optional research and VaR backends"],
  ["npm run catalog:refresh", "how a reader refreshes the manifest themselves"],
  ["python -m uvicorn main:app --port 8000", "how a reader starts the offline gateway"],
  ["tools/check_repo_complete.sh", "the repository-audit command"],
  ["scripts/refresh-test-counts.mjs", "who counts the tests"],
  // Negations and qualifiers. These carry the whole claim.
  ["not source contents", "what the manifest withholds"],
  ["not execution authority", "the guard rail over a catalogue of pasteable curls"],
  ["nothing is uploaded", "the sandbox declaration on the browser parity run"],
  ["passes only when", "custody's precondition"],
  ["not re-measured by this build", "why the test totals carry a date"],
  ["neither a pass nor a failure", "the third verdict, which is not a softer second"],
  ["could not be checked at all", "what separates BLOCKED from UNVERIFIED"],
  ["no promotion candidate to check", "why a local build is unverified rather than failed"],
  ["does not match", "the browser parity failure, stated as a negation"],
  ["is not configured", "OpenBB absent, which is not OpenBB unhealthy"],
  ["no live schema evidence", "the withheld schema verdict, with its reason"],
  ["no numerics parity evidence", "the withheld numerics verdict, with its reason"],
  ["no artifact attestation", "the withheld custody verdict, with its reason"],
  ["Nothing read the live contract this poll", "why a cached verdict is not repeated"],
  ["an earlier reading found", "the history kept rather than deleted beside that refusal"],
  ["No suite reports a documented baseline", "the empty state for the test-count bars"],
  ["Read-only", "what the explorer may not do"],
  ["tree audit", "the suite with no count, absent rather than plotted as zero"],
  ["Not connected", "the two schema rows with no automation behind them"],
  ["Not deployed", "the deploy stage with no deployment"],
  ["Unverified local output", "the package stage outside Vercel"],
  ["No trust root", "an unpinned key, which is not a failed signature"],
  ["Not run", "the parity check before anyone presses the button"],
  ["currently routable", "the qualifier on the provider count"],
  ["operator-gated", "the routes a reader may not simply curl"],
  ["optional backend", "the Oracle routes that may not be deployed"],
  ["newest first", "the ordering of the research runs"],
  ["single-use", "the Telegram token's lifetime"],
  ["a stale version returns the current row", "the versioned-edit contract"],
  ["Off / not configured", "the topology legend, the only place on that card expanding the Off pill"],
  ["Closed in this browser", "where a Done row is closed, and where it is not"],
  ["${job.count} tests", "the unit on the CI bars; without the note they fall back to a bare number"],
  ["Every push", "how often the verification matrix runs, beside the date its counts were taken"],
];

/**
 * Sentences examined and deliberately left alone.
 *
 * Each is asserted present verbatim, so the refusal is a claim the suite makes
 * rather than a line in a report nobody reads again.
 */
const REFUSED: ReadonlyArray<{ file: string; text: string; reason: string }> = [
  {
    file: "components/developer/DeveloperStatus.tsx",
    text: "This health route carries no live schema evidence yet.",
    reason: "shortening to 'No live schema evidence yet.' drops WHICH source is missing it, which is"
      + " the reason the measurement is absent — the failure this file exists to prevent",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    text: "This browser's result does not match the committed reference; a real numerics finding.",
    reason: "'differs from' would save a word by spending the explicit negation, and the second clause"
      + " is what stops a reader filing a UI bug against a genuine divergence",
  },
  {
    file: "components/developer/DeveloperOverview.tsx",
    text: "Not a Vercel deployment, so there is no promotion candidate to check.",
    reason: "every word is a token: the negation, the platform, the causal 'so', and the reason the"
      + " gate is unverified rather than failed",
  },
  {
    file: "components/developer/DeveloperPipelines.tsx",
    text: "The stages this commit travels, and how far this build got",
    reason: "'this commit' and 'this build' are different subjects — the strip reports a build's"
      + " progress through a commit's stages — so no pronoun can carry the second",
  },
  {
    file: "components/developer/DeveloperInterfaces.tsx",
    text: "Runs entirely in this tab; nothing is uploaded.",
    reason: "two facts in eight words — where it runs, and that nothing leaves — and it is the only"
      + " content on the card before a run",
  },
  {
    file: "components/DeveloperConsole.tsx",
    text: "Data-pipeline work is triaged in Data operations.",
    reason: "'triaged' says what happens there rather than merely where the work belongs; the shorter"
      + " 'belongs in' spends that",
  },
];

// ---------------------------------------------------------------------------

describe("the developer summarisation pass shipped, and cost no fact", () => {
  it("reads eight non-empty developer sources", () => {
    for (const file of FILES) assert.ok(source(file).length > 500, `${file} is too short to be the real file`);
    assert.ok(tab().length > 20_000, "the tab read short — every assertion below would scan almost nothing");
  });

  for (const rewrite of REWRITES) {
    it(`${rewrite.file}: ${rewrite.what} is the shorter sentence`, () => {
      const text = rendered(rewrite.file);
      assert.ok(
        text.includes(collapse(rewrite.after)),
        `the rewritten sentence is not in the file:\n    "${rewrite.after}"`,
      );
      assert.ok(
        !text.includes(collapse(rewrite.before)),
        `the longer form is back. This pass removed ${rewrite.cut}:\n    "${rewrite.before}"`,
      );
    });

    it(`${rewrite.file}: ${rewrite.what} kept every enumerated fact`, () => {
      const text = rendered(rewrite.file);
      const lost = rewrite.facts.filter((fact) => !text.includes(collapse(fact)));
      assert.deepEqual(
        lost, [],
        `the rewrite reads shorter and asserts less. These tokens were enumerated before it was `
          + `written and are gone from ${rewrite.file}:\n    ${lost.join("\n    ")}`,
      );
    });
  }
});

describe("the tab's fact inventory survives any shortening pass", () => {
  it("renders every number, unit, entity, negation and qualifier it claimed", () => {
    const text = tab();
    const lost = TAB_FACTS.filter(([token]) => !text.includes(token)).map(([token, why]) => `${token} — ${why}`);
    assert.deepEqual(
      lost, [],
      `facts have gone off the Developer tab. This is the shape of commit 8d091a3, which cut 610 `
        + `words and put sixteen facts back:\n    ${lost.join("\n    ")}`,
    );
  });

  it("counts the inventory it is checking, so a truncated list cannot pass quietly", () => {
    assert.ok(TAB_FACTS.length >= 60, `the inventory holds ${TAB_FACTS.length} tokens; it was written with at least 60`);
    assert.equal(new Set(TAB_FACTS.map(([token]) => token)).size, TAB_FACTS.length, "the inventory repeats a token");
  });
});

describe("the sentences this pass refused to shorten are still whole", () => {
  for (const refusal of REFUSED) {
    it(`${refusal.file}: "${refusal.text.slice(0, 46)}…"`, () => {
      assert.ok(
        rendered(refusal.file).includes(collapse(refusal.text)),
        `a later pass shortened a sentence this one refused: ${refusal.reason}\n    "${refusal.text}"`,
      );
    });
  }
});
