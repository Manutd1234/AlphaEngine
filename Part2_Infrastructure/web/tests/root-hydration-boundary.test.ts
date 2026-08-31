import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

describe("the root tolerates browser-extension attributes without hiding app mismatches", () => {
  it("suppresses hydration warnings on both extension-mutated root elements", () => {
    assert.match(layout, /<html[\s\S]*?suppressHydrationWarning[\s\S]*?>/);
    assert.match(layout, /<body suppressHydrationWarning>\{children\}<\/body>/);
  });

  it("does not wrap the application subtree in a broader hydration escape hatch", () => {
    assert.equal((layout.match(/suppressHydrationWarning/g) ?? []).length, 2);
  });
});
