/**
 * The exact ladder is finite data inside a finite work surface.
 *
 * Eight near-touch levels per side keep the exact ladder visible as one compact
 * region. The deeper book shape remains available in the adjacent cumulative
 * depth and history figures, so this card does not need an inner scroll owner.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const source = readSource("components/execution/LiquidityBook.tsx");
const heatmap = readSource("components/execution/DepthHeatmap.tsx");
const css = [
  readSource("app/globals/14zzg-residual-quant-figures.css"),
  readSource("app/globals/14zzk-execution-layout-followup.css"),
].join("\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

describe("Execution Liquidity owns one compact ladder region", () => {
  it("gives cumulative depth and depth history exactly half of the desktop row", () => {
    assert.match(css, /\.liquidity-pair\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    assert.match(css, /\.liquidity-pair__ladder\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
    assert.match(css, /@media \(max-width:\s*900px\)[\s\S]*?\.liquidity-pair\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  });

  it("fills the history card without drawing a second frame", () => {
    assert.match(source, /className="card liquidity-pair__history" data-depth-history=""/);
    assert.match(
      css,
      /\.liquidity-pair__history > \.coh-figure\s*\{[^}]*padding:\s*0;[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s,
    );
    assert.match(heatmap, /const DESKTOP_HEIGHT = 500;/);
    assert.doesNotMatch(heatmap, /useSyncExternalStore|matchMedia/,
      "viewport-specific JS height reintroduces hydration and first-paint twitch");
    assert.match(heatmap, /<Plot[\s\S]*?height=\{height\}/);
    assert.match(
      heatmap,
      /positions:\s*model\.frames\.map\(\(_, index\) => x0 \+ \(index \+ 0\.5\) \* columnWidth\)/,
      "the shared crosshair must sit at the centre of the heatmap columns it reads",
    );
    assert.match(css, /\.depth-heatmap__empty\s*\{[^}]*min-height:\s*500px;/s);
    assert.doesNotMatch(css, /@media \(max-width:\s*900px\)[\s\S]*?\.depth-heatmap__empty\s*\{[^}]*min-height:\s*328px;/s);
  });

  it("starts both liquidity drawings directly beneath their captions", () => {
    assert.match(
      source,
      /caption="Cumulative resting depth[\s\S]{0,240}?reserveInteractionRow=\{false\}[\s\S]{0,260}?height=\{500\}/,
      "the static depth chart still reserves an empty interaction row or has not claimed the recovered height",
    );
    assert.match(
      css,
      /\.liquidity-pair__depth \.coh-figure__caption,[\s\S]*?\.liquidity-pair__history \.coh-figure__caption\s*\{[^}]*min-block-size:\s*0;/s,
    );
    assert.match(
      css,
      /\.liquidity-pair__history > \.coh-figure\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s,
    );
    assert.match(css, /\.liquidity-pair__history \.coh-figure__plot\s*\{[^}]*order:\s*1;/s);
    assert.match(css, /\.liquidity-pair__history \.coh-figure__interaction\s*\{[^}]*order:\s*2;/s);
  });

  it("pins interaction to the centre of the same time bins the heatmap draws", () => {
    assert.match(heatmap, /const columnWidth = \(x1 - x0\) \/ model\.frames\.length;/);
    assert.match(
      heatmap,
      /positions:\s*model\.frames\.map\(\(_, index\) => x0 \+ \(index \+ 0\.5\) \* columnWidth\)/,
      "the keyboard/pointer readout can drift to a time-bin edge instead of its rendered centre",
    );
  });

  it("retains exactly eight displayed levels per side", () => {
    assert.match(source, /const LADDER_DEPTH = 8;/);
    assert.match(source, /rows\.slice\(0, LADDER_DEPTH\)/);
  });

  it("names the non-scrolling region from its existing heading", () => {
    assert.match(source, /<h2 id="execution-liquidity-ladder-title">Consolidated ladder<\/h2>/);
    assert.match(
      source,
      /className="liquidity-pair__book"[\s\S]*?role="region"[\s\S]*?aria-labelledby="execution-liquidity-ladder-title"/,
    );
    assert.doesNotMatch(source, /className="liquidity-pair__book"[\s\S]{0,240}?tabIndex=/);
  });

  it("removes the internal scroll ceiling and gutter", () => {
    assert.match(
      css,
      /\.liquidity-pair__ladder \.liquidity-pair__book\s*\{[^}]*max-block-size:\s*none;[^}]*overflow-y:\s*visible;[^}]*scrollbar-gutter:\s*auto;/s,
    );
  });
});
