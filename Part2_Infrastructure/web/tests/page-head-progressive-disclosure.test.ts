import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../components/workspace/PageHead.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../components/WorkspaceOverview.tsx", import.meta.url), "utf8");

describe("the shared page head is static and compact", () => {
  it("never turns the page identity into an accordion", () => {
    assert.match(source, /<span className="page-kicker">\{kicker\}<\/span>/);
    assert.doesNotMatch(source, /page-heading__brief|<summary className="page-kicker"/);
    assert.doesNotMatch(source, /descriptionDisclosure/);
  });

  it("can suppress a redundant route title without suppressing its signed description", () => {
    assert.match(source, /showTitle\?: boolean/);
    assert.match(source, /showTitle = true/);
    assert.match(source, /showTitle \? \([\s\S]*?<h1>\{title\}<\/h1>[\s\S]*?\) : \(\s*<h1 className="page-role-title">\{kicker\}<\/h1>/);
    assert.match(source, /\{description \? <p>\{description\}<\/p> : null\}/);
  });

  it("keeps the Overview command-centre headline because it is a thesis, not a duplicate route name", () => {
    assert.match(overview, /kicker="AlphaEngine command centre"/);
    assert.doesNotMatch(overview, /descriptionDisclosure/);
    assert.doesNotMatch(overview, /showTitle=\{false\}/);
  });
});
