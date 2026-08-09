/**
 * The research corpus panel.
 *
 * `describeSearchOutcome` has existed since the RAG shipped and was referenced
 * by nothing but its own test — the retrieval worked and no page rendered it,
 * so the feature was invisible and its failure modes were untested in practice.
 * This pins the distinctions that make the panel worth having: three different
 * unhappy outcomes that must never collapse into "no results".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const panel = read("../components/research/ResearchCorpus.tsx");
const hook = read("../lib/use-research-search.ts");
const page = read("../app/page.tsx");
const css = read("../app/globals.css");

/** Comment-free view: this file quotes the constructs it forbids. */
const code = (source: string) =>
  source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    })
    .join("\n");

describe("the corpus panel is actually reachable", () => {
  it("is rendered by the research workspace", () => {
    // The whole defect this closes: retrieval that works and nothing that shows
    // it. A component nobody mounts is the same as no component.
    assert.match(page, /import ResearchCorpus/);
    assert.match(page, /<ResearchCorpus \/>/);
  });

  it("sits outside the StaleGate", () => {
    // The corpus answers a question about history. Veiling it when the current
    // sweep's parameters change would imply past results had gone stale too.
    const attribution = page.slice(page.indexOf('tabId="attribution"'), page.indexOf('tabId="decision"'));
    const gateClose = attribution.lastIndexOf("</StaleGate>");
    const mount = attribution.indexOf("<ResearchCorpus />");
    assert.ok(mount > gateClose, "ResearchCorpus is inside the StaleGate");
  });
});

describe("three unhappy outcomes stay three different sentences", () => {
  it("reuses describeSearchOutcome rather than restating it", () => {
    // "not configured", "the embedding service did not answer" and "nothing
    // similar is recorded" are different facts. Re-deriving them in the panel
    // is how two of them quietly become the third.
    assert.match(hook, /describeSearchOutcome/);
    assert.doesNotMatch(
      code(panel), /nothing similar|not configured/i,
      "the panel is restating outcome text that belongs to describeSearchOutcome",
    );
  });

  it("validates the response shape before trusting it", () => {
    // An unvalidated body that changed shape yields `matches: undefined`, which
    // renders exactly like a successful search that found nothing.
    assert.match(hook, /isResearchRagSearchResponse/);
    const guard = /if \(!isResearchRagSearchResponse[\s\S]*?\n    \}/.exec(hook)?.[0] ?? "";
    assert.match(guard, /status:\s*"error"/, "a malformed response is not surfaced as an error");
  });

  it("keeps idle apart from searched-and-empty", () => {
    // Before the first query there is no result to report. Showing "nothing
    // similar is recorded" then would be answering a question nobody asked.
    assert.match(hook, /"idle"/);
    assert.match(code(panel), /status === "idle"/);
  });

  it("a transport failure says the index was not reached", () => {
    const c = code(hook);
    assert.match(c, /catch\s*\{[\s\S]*?status:\s*"error"/);
    assert.match(c, /did not complete|not reached/i);
  });
});

describe("the two backends are a choice, not a fallback", () => {
  it("offers both and never silently substitutes one for the other", () => {
    assert.match(hook, /supabase:\s*"\/api\/gateway\/research\/rag"/);
    assert.match(hook, /oracle:\s*"\/api\/oracle\/research"/);
    // A failover would hide the disagreement between two indexes over the same
    // documents, which is the comparison the two-backend design exists to make.
    assert.doesNotMatch(
      code(hook), /catch[\s\S]{0,200}ROUTES\[/,
      "a failed backend is falling through to the other one",
    );
  });
});

describe("results are legible as evidence", () => {
  it("shows the similarity score, not just the ordering", () => {
    // 0.86 and 0.31 are both "the closest thing we have". A reader who sees
    // only the rank cannot tell a strong match from the least-bad one.
    assert.match(code(panel), /match\.similarity/);
  });

  it("renders the card text as it was embedded", () => {
    // `body` is the exact text the vector was computed from. Collapsing its
    // newlines would show the reader something other than what was indexed.
    assert.match(css, /\.corpus-result__body[\s\S]*?white-space:\s*pre-wrap/);
  });

  it("uses tabular figures so a column of scores stays aligned", () => {
    assert.match(css, /\.corpus-result__score[\s\S]*?tabular-nums/);
  });
});

describe("the panel survives both themes and both column widths", () => {
  it("uses tokens rather than literal colours", () => {
    const block = css.slice(css.indexOf("/* ── Research corpus"));
    const hexes = block.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    assert.deepEqual(hexes, [], `hard-coded colours would be a dark-only slab in light mode: ${hexes.join(", ")}`);
  });

  it("reflows on its own width, not the viewport's", () => {
    // The panel appears in one- and two-column contexts; only its own width
    // decides whether the search controls still fit on a line.
    const block = css.slice(css.indexOf("/* ── Research corpus"));
    assert.match(block, /container-type:\s*inline-size/);
    assert.match(block, /@container/);
  });
});
