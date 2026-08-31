import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../components/common/NextStepFooter.tsx", import.meta.url), "utf8");

describe("the repeated next-step footer keeps secondary context on demand", () => {
  it("preserves the exact kicker and hint while closing them at rest", () => {
    const details = source.indexOf('<details className="next-step-footer__detail">');
    const summary = source.indexOf("<summary>Context</summary>", details);
    const kicker = source.indexOf("{step.kicker}", summary);
    const hint = source.indexOf("{step.hint}", kicker);

    assert.ok(details >= 0 && summary > details && kicker > summary && hint > kicker,
      "secondary routing evidence must live in one native closed disclosure");
    assert.doesNotMatch(source, /<details[^>]*\sopen(?:=|\s|>)/,
      "the disclosure must not add its repeated prose to the default-at-rest view");
  });

  it("keeps the destination and action immediately visible", () => {
    const details = source.indexOf('<details className="next-step-footer__detail">');
    assert.ok(source.indexOf("{step.title}") < details);
    assert.ok(source.indexOf("{step.action}") > details);
  });
});
