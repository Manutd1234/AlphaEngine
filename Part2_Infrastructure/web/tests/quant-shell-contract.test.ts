import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const header = read("components/WorkspaceHeader.tsx");
const panels = read("components/workspace/lazy-panels.tsx");

describe("the primary workspace rail has two semantic planes without a second rail", () => {
  it("describes Desk and Market engine while preserving one tablist", () => {
    assert.equal((header.match(/role="tablist"/g) ?? []).length, 1);
    assert.match(header, /const DESK_PLANE_LABEL = planeLabel\("desk"\)/);
    assert.match(header, /const ENGINE_PLANE_LABEL = planeLabel\("market-engine"\)/);
    assert.match(header, /id="workspace-plane-desk"[^>]*>\{DESK_PLANE_LABEL\}</);
    assert.match(header, /id="workspace-plane-engine"[^>]*>\{ENGINE_PLANE_LABEL\}</);
    assert.match(
      header,
      /aria-describedby=\{index < 8 \? "workspace-plane-desk" : "workspace-plane-engine"\}/,
    );
    assert.doesNotMatch(header, /workspace-tabs__group/,
      "a visible group row would turn the responsive header into three rows");
  });

  it("groups the compact selector without changing the option labels or order", () => {
    assert.match(header, /<optgroup label=\{DESK_PLANE_LABEL\}>[\s\S]*NAV_ITEMS\.slice\(0, 8\)/);
    assert.match(header, /<optgroup label=\{ENGINE_PLANE_LABEL\}>[\s\S]*NAV_ITEMS\.slice\(8\)/);
    assert.match(header, /\{item\.label\} — \{item\.role\}/);
  });

  it("only points aria-controls at the panel that is guaranteed to be mounted", () => {
    assert.match(
      header,
      /aria-controls=\{view === item\.id \? `panel-\$\{item\.id\}` : undefined\}/,
    );
    assert.doesNotMatch(header, /aria-controls=\{`panel-\$\{item\.id\}`\}/);
  });
});

describe("cold workspace chunks reserve the geometry that will replace them", () => {
  it("uses the shared quant skeleton rather than a blank fixed-height slab", () => {
    assert.match(panels, /import QuantPanelSkeleton from "@\/components\/workspace\/QuantPanelSkeleton"/);
    assert.match(panels, /const PanelLoading = QuantPanelSkeleton/);
    assert.doesNotMatch(panels, /style=\{\{ height: 480 \}\}/);
  });

  it("announces one loading state and draws heading, metrics, rail, plot, and ledger regions", () => {
    const skeleton = read("components/workspace/QuantPanelSkeleton.tsx");
    const state = read("components/workspace/QuantStateSurface.tsx");
    assert.match(state, /role="status"/);
    assert.match(state, /aria-live="polite"/);
    assert.match(state, /aria-atomic="true"/);
    assert.match(skeleton, /state="loading"/);
    for (const region of ["head", "metrics", "rail", "plot", "ledger"]) {
      assert.match(skeleton, new RegExp(`quant-panel-skeleton__${region}`), `${region} geometry is absent`);
    }
  });

  it("keeps the skeleton responsive and motion-safe", () => {
    assert.match(globalsCss, /\.quant-panel-skeleton \{[^}]*min-height:/s);
    assert.match(globalsCss, /\.quant-panel-skeleton__body \{[^}]*grid-template-columns:/s);
    assert.match(
      globalsCss,
      /@media \(max-width: 900px\) \{[\s\S]*\.quant-panel-skeleton__body \{[\s\S]*grid-template-columns: 1fr/,
    );
    assert.doesNotMatch(
      globalsCss.match(/\.quant-panel-skeleton[\s\S]*?(?=\/\*|$)/)?.[0] ?? "",
      /animation|transition/,
    );
  });
});
