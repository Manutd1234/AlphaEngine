import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";

const root = join(import.meta.dirname, "..");
const header = readFileSync(join(root, "components/WorkspaceHeader.tsx"), "utf8");
const nav = readFileSync(join(root, "lib/workspace-nav.ts"), "utf8");

describe("the primary rail distinguishes workflow from market-engine tools", () => {
  it("keeps the canonical order and derives the visual plane from the item index", () => {
    const ids = [...nav.matchAll(/\{ id: "([^"]+)", label:/g)].map((match) => match[1]);
    assert.deepEqual(ids, [
      "overview", "research", "live", "portfolio", "risk", "data",
      "reliability", "developer", "markets", "coherence", "diffusion",
    ]);
    assert.match(header, /data-plane=\{index < 8 \? "workflow" : "market-engine"\}/);
  });

  it("keeps the plane transition semantic without widening one visual gap", () => {
    const seam = globalsCss.match(
      /\.workspace-tabs button\[data-plane="workflow"\] \+ button\[data-plane="market-engine"\] \{([\s\S]*?)\}/,
    );
    assert.ok(seam, "Developer and Markets need an explicit uniform-gap rule");
    assert.match(seam[1], /background-image:\s*none/);
    assert.doesNotMatch(seam[1], /margin|padding|border(?:-|:)/,
      "the seam must paint without changing the header width ladder");
  });
});
