import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const shellBrowser = read("../components/coherence/ShellBrowser.tsx")
  .replace(/\{" "\}/g, " ")
  .replace(/\s+/g, " ");

describe("the Shell watchlist boundary", () => {
  it("uses grammatical copy for the configured series", () => {
    assert.ok(shellBrowser.includes("It reads only the series named in <code>COHERENCE_SERIES</code>"));
    assert.ok(!shellBrowser.includes("names has been read"));
  });
});
