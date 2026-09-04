import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { read } from "./helpers/workspace-sources";

const figure = read("../components/coherence/Figure.tsx");
const waterfall = read("../components/portfolio/PnlWaterfall.tsx");
const dependencyDag = read("../components/systems/DependencyDag.tsx");
const violationStates = read("../components/coherence/ViolationStates.tsx");

describe("fixed-label SVGs own their narrow-width geometry", () => {
  it("removes the waterfall's unnecessary 18px phone floor", () => {
    assert.match(
      waterfall,
      /<Plot[\s\S]*?height=\{HEIGHT\}[\s\S]*?minWidth=\{300\}[\s\S]*?scrollLabel="Scrollable day P&L attribution chart"/,
    );
  });

  it("uses the smallest widths that keep the DAG and lifecycle nodes distinct", () => {
    assert.match(dependencyDag, /<Plot height=\{height\} minWidth=\{520\} scrollLabel=\{caption\}>/);
    assert.match(violationStates, /<Plot height=\{HEIGHT\} minWidth=\{520\} scrollLabel=\{caption\}>/);
  });

  it("names and focuses only a floor that actually overflows", () => {
    assert.match(figure, /scrollLabel\?: string;/);
    assert.match(figure, /const scrollable = Boolean\(scrollLabel\) && minWidth > measured \+ 1;/);
    assert.match(figure, /aria-label=\{scrollable \? scrollLabel : undefined\}/);
    assert.match(figure, /tabIndex=\{scrollable \? 0 : undefined\}/);
    assert.match(
      globalsCss,
      /\.coh-plot\.is-floored\s*\{[^}]*max-inline-size:\s*100%;[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;/s,
    );
  });
});
