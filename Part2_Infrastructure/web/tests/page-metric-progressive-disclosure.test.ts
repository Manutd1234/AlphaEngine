import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../components/workspace/PageHead.tsx", import.meta.url), "utf8");

describe("page metrics keep values immediate and provenance on demand", () => {
  it("preserves every note inside a native closed disclosure", () => {
    assert.match(source, /<dd className="page-context-strip__note">[\s\S]*?<details className="page-context-strip__provenance">/);
    assert.match(source, /<summary aria-label=\{metric\.label\}>\?<\/summary>[\s\S]*?\{metric\.note\}/);
    assert.doesNotMatch(source, /<details[^>]*\sopen(?:=|\s|>)/);
  });

  it("keeps a missing-value reason available in the same disclosure", () => {
    assert.doesNotMatch(source, /discloseNote/);
    assert.match(source, /\{metric\.note \? \(\s*<details/);
  });

  it("does not hide the primary value or its sparkline", () => {
    const details = source.indexOf('<details className="page-context-strip__provenance">');
    assert.ok(source.indexOf("{metric.value}") < details);
    assert.ok(source.indexOf("{metric.spark}", details) > details,
      "the compact quantitative signal must stay visible outside the prose disclosure");
  });
});
