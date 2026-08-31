import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../app/globals/14zze-strategy-codex-tabs.css", import.meta.url)),
  "utf8",
);

describe("Research Strategies mobile family header containment", () => {
  const mobileStart = css.indexOf("@media (max-width: 620px)");
  const mobile = mobileStart < 0 ? "" : css.slice(mobileStart);

  it("reflows the family identity into a shrinkable two-column header", () => {
    assert.ok(mobileStart >= 0, "the Strategies layer has no phone containment breakpoint");
    assert.match(
      mobile,
      /\.strategy-codex \.codex-family__head\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*auto minmax\(0,\s*1fr\);/,
    );
  });

  it("puts the complete progress evidence on its own visible row", () => {
    const progress = mobile.match(/\.strategy-codex \.codex-family__progress\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(progress, /grid-column:\s*1\s*\/\s*-1;/);
    assert.match(progress, /width:\s*100%;/);
    assert.match(progress, /min-width:\s*0;/);
    assert.match(progress, /margin-left:\s*0;/);
    assert.doesNotMatch(progress, /display:\s*none|visibility:\s*hidden/);
  });
});
