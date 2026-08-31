import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const workspace = read("../components/ResearchWorkspace.tsx");
const ranking = read("../components/research/CandidateRanking.tsx");
const tables = read("../components/Tables.tsx");

describe("Research Parameters keeps Candidate Ranking directly operable", () => {
  it("renders the quantitative surface and ranking as peers without a disclosure", () => {
    const stability = workspace.indexOf("<StabilityPanel");
    const candidate = workspace.indexOf("<CandidateRanking");

    assert.ok(stability >= 0, "the primary quantitative surface must remain mounted");
    assert.ok(candidate > stability, "Candidate Ranking must follow the stability surface");
    assert.doesNotMatch(ranking, /<details\b/);
    assert.doesNotMatch(ranking, /<summary\b/);
    assert.match(ranking, /<ResultsTable/);
  });

  it("offers a direct inline search and reports the retained row count", () => {
    assert.match(ranking, /type="search"/);
    assert.match(ranking, /value=\{query\}/);
    assert.match(ranking, /setQuery\(event\.target\.value\)/);
    assert.match(ranking, /data\.topResults\.filter/);
    assert.match(ranking, /filtered\.length/);
    assert.match(ranking, /data\.topResults\.length/);
    assert.doesNotMatch(ranking, /Dropdown|Popover|Command/);
  });

  it("keeps all 15 rows at rest and preserves pointer and keyboard selection", () => {
    assert.match(ranking, /query\.trim\(\)/);
    assert.match(ranking, /if \(!needle\) return data\.topResults/);
    assert.ok(tables.includes("data.topResults.map((r) => {"));
    assert.ok(tables.includes("onClick={() => onSelect?.(r)}"));
    assert.ok(tables.includes('event.key === "Enter" || event.key === " "'));
    assert.ok(tables.includes("onSelect(r);"));
    assert.ok(tables.includes("selected && r.fast === selected.fast && r.slow === selected.slow"));
  });
});
