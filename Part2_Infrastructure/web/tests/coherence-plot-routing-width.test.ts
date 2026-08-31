/** Routed figures must not inherit the previous diagram's width contract. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { read } from "./helpers/workspace-sources";

const chartKit = read("../components/chart-kit.tsx");
const figure = read("../components/coherence/Figure.tsx");

describe("routed plot width ownership", () => {
  it("turns a requested width floor into a real contained SVG floor", () => {
    assert.match(figure, /style=\{\{ minInlineSize: minWidth \? minWidth : 0 \}\}/);
    assert.match(globalsCss, /\.coh-plot\.is-floored\s*\{[^}]*overflow-x:\s*auto;/s);
  });

  it("clears a prior view's floor when React reconciles the svg in place", () => {
    assert.doesNotMatch(
      figure,
      /minInlineSize:\s*minWidth\s*(?:\|\||\?[^:]+:)\s*undefined/,
      "an unfloored Plot can inherit a prior routed view's stale pixel floor",
    );
    assert.match(figure, /minInlineSize:\s*minWidth\s*\?\s*minWidth\s*:\s*0/);
  });

  it("remeasures the width attribute when route geometry changes", () => {
    assert.match(
      figure,
      /const measurementKey = `\$\{minWidth\}:\$\{height\}:\$\{viewBox \?\? "measured"\}`/,
    );
    assert.match(figure, /useMeasuredWidth<HTMLDivElement>\(720,\s*measurementKey\)/);
    assert.match(
      chartKit,
      /useMeasuredWidth<T extends HTMLElement>\(fallback = 720, remeasureKey: unknown = null\)/,
    );
    assert.match(chartKit, /\}, \[fallback, remeasureKey\]\);/);
  });
});
