/**
 * The parameter surface is one keyboard instrument, not hundreds of tab stops.
 * These source-level checks match the design-system contract tests: they pin
 * the accessibility structure without adding a browser-test dependency.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const heatmap = readFileSync(
  fileURLToPath(new URL("../components/Heatmap.tsx", import.meta.url)),
  "utf8",
);
/**
 * The sweep announcement is composed in `lib/use-sweep-run.ts` and rendered by
 * `components/ResearchWorkspace.tsx`; both moved out of page.tsx together.
 * Pointed at page.tsx these assertions would scan a file with no announcement
 * in it, which is a green that means nothing.
 */
const sweepHook = readFileSync(
  fileURLToPath(new URL("../lib/use-sweep-run.ts", import.meta.url)),
  "utf8",
);
const page = readFileSync(
  fileURLToPath(new URL("../components/ResearchWorkspace.tsx", import.meta.url)),
  "utf8",
);
const css = readFileSync(
  fileURLToPath(new URL("../app/globals.css", import.meta.url)),
  "utf8",
);

describe("the heatmap is a roving keyboard grid", () => {
  it("keeps one cell in the tab order and drops the rest to -1", () => {
    assert.match(heatmap, /tabIndex=\{onSelect \? \(`\$\{f\}:\$\{s\}` === rovingKey \? 0 : -1\)/);
    assert.doesNotMatch(heatmap, /tabIndex=\{onSelect \? 0 : undefined\}/);
  });

  it("steers in both axes and to row boundaries", () => {
    for (const key of ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"]) {
      assert.match(heatmap, new RegExp(`"${key}"`), `${key} is not handled`);
    }
    assert.match(heatmap, /cellRefs\.current\.get\(key\)\?\.focus\(\)/);
  });

  it("keeps Enter and Space selection", () => {
    assert.match(heatmap, /event\.key === "Enter" \|\| event\.key === " "/);
    assert.match(heatmap, /onSelect\?\.\(r\)/);
  });

  it("does not flatten interactive cells under atomic image semantics", () => {
    assert.match(heatmap, /role=\{onSelect \? "group" : "img"\}/);
    assert.doesNotMatch(heatmap, /role="img"/);
  });

  it("paints SVG focus with the shared focus colour", () => {
    assert.match(css, /\.heatmap-cell:focus-visible\s*\{[^}]*stroke:\s*var\(--series-1\)/s);
    assert.match(css, /\.heatmap-cell:focus-visible\s*\{[^}]*stroke-width:\s*3/s);
  });
});

describe("completed sweeps announce one atomic verdict", () => {
  it("keys the announcement to data identity and the accepted run", () => {
    assert.match(sweepHook, /key: `\$\{completed\.dataHash\}:\$\{sequence\}`/);
    assert.match(page, /<span key=\{resultAnnouncement\.key\}>/);
  });

  it("uses one polite, atomic live region outside the staggered Verdict", () => {
    assert.match(page, /role="status" aria-live="polite" aria-atomic="true"/);
    assert.match(sweepHook, /Sweep complete:.*DSR.*combinations/s);
    assert.doesNotMatch(
      readFileSync(fileURLToPath(new URL("../components/Verdict.tsx", import.meta.url)), "utf8"),
      /aria-live/,
    );
  });
});
