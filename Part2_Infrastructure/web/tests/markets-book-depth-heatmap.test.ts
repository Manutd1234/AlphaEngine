/**
 * The table heatmap is retired from the primary Books ladder.
 *
 * The replacement does not discard exact depth: `BookLadderConsole` exposes
 * it in selectable rails, a live readout, and a collapsed exact ledger. This
 * contract prevents the old heatmap from being stacked back above that same
 * data while preserving the narrow-screen audit path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const ladder = read("../components/coherence/LadderChart.tsx");
const instrument = read("../components/coherence/BooksInstruments.tsx");
const css = read("../components/coherence/BooksInstruments.module.css");

describe("the depth heatmap is retired from the primary ladder", () => {
  it("routes the public ladder entry point only to BookLadderConsole", () => {
    assert.match(ladder, /<BookLadderConsole\b/);
    for (const source of [ladder, instrument]) {
      assert.doesNotMatch(stripNonCode(source), /OrderBookDepthHeatmap|book-depth-heatmap/,
        "the retired heatmap is mounted beside its replacement");
    }
  });

  it("uses the shared mirror-book model as the one depth source", () => {
    assert.match(instrument, /mirrorBookLevels,[\s\S]*?from "@\/lib\/coherence\/book-instrument-model"/);
    assert.match(instrument, /const live = mirrorBookLevels\(yesBids, noBids\)/);
    assert.match(instrument, /const \{ yes, no, ordered \} = scenarioBookLevels\(live\.ordered, sideByKey\)/);
    assert.match(instrument, /style=\{\{ "--depth": percentOf\(row\.depth, maxDepth\) \}/);
    assert.match(instrument, /Size \/ depth<\/small><strong className="num">\{contractsLabel\(active\.size\)\} \/ \{contractsLabel\(active\.depth\)\}/);
  });
});

describe("exact depth remains available without dominating the primary surface", () => {
  it("keeps the ledger collapsed until requested", () => {
    const disclosure = /<details className=\{styles\.ledger\}([^>]*)>/.exec(instrument);
    assert.ok(disclosure, "the exact level ledger is missing");
    assert.doesNotMatch(disclosure[1], /\bopen\b/,
      "the exact ledger is expanded by default and competes with the primary instrument");
    assert.match(instrument, /<summary>Exact working ledger — \{ordered\.length\} levels<\/summary>/);
    assert.match(instrument, /<tbody>\{ordered\.map\(\(row\) =>/);
  });

  it("gives its wide exact table one named keyboard-scrollable boundary", () => {
    assert.match(instrument, /<div role="region" tabIndex=\{0\} aria-label=\{`Exact level ledger, \$\{ordered\.length\} rows`\} className="table-wrap table-wrap--clamped">/);
    assert.match(instrument, /<table className="coh-table">/);
    assert.match(instrument, /<caption className="coh-table__caption">Exact native and mirrored book levels<\/caption>/);
    assert.match(css, /\.ledger > div\s*\{[^}]*max-width:\s*100%;[^}]*overflow:\s*auto;/s);
    assert.match(css, /\.ledger \[role="region"\]:focus-visible/);
    assert.match(css, /\.ledger table\s*\{[^}]*min-width:\s*36rem;/s);
    assert.match(css, /@media \(max-width: 680px\)/);
    assert.match(css, /@media \(forced-colors: active\)/);
    assert.doesNotMatch(css, /#[\da-f]{3,8}\b|\brgba?\s*\(/i);
  });
});
