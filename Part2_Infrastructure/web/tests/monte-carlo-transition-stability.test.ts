import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource } from "./helpers/source-files";

const hook = readSource("lib/use-mc-distribution.ts").replace(/\/\*[\s\S]*?\*\//g, "");
const card = readSource("components/risk/MonteCarloDistribution.tsx").replace(/\/\*[\s\S]*?\*\//g, "");

describe("Monte Carlo parameter transitions retain a stable analytical surface", () => {
  it("keeps the last completed result while a replacement run is in flight", () => {
    assert.match(
      hook,
      /const retainedResult = sameDriver \? previous\.result : null;[\s\S]*?status:\s*"running"[\s\S]*?result:\s*retainedResult/,
      "a parameter change clears the last result and collapses the analytical surface",
    );
    assert.doesNotMatch(
      hook,
      /status:\s*"running"[\s\S]{0,160}?result:\s*null/,
      "the running transition must not replace a completed chart with an empty frame",
    );
  });

  it("does not retain a result across a different return driver", () => {
    assert.match(hook, /function requestDriverKey\(/);
    assert.match(hook, /const sameDriver = lastDriverKey\.current === nextDriverKey/);
    assert.match(hook, /sameDriver \? previous\.result : null/);
  });

  it("uses a bounded deterministic result cache when a reader revisits a parameter set", () => {
    assert.match(hook, /const RESULT_CACHE_LIMIT\s*=\s*\d+/);
    assert.match(hook, /function requestKey\(/);
    assert.match(hook, /RESULT_CACHE\.get\(key\)/);
    assert.match(hook, /RESULT_CACHE\.delete\(oldest\)/);
  });

  it("reserves the large skeleton for the first run and refreshes in place thereafter", () => {
    assert.match(card, /state\.status === "running" && !result/);
    assert.match(card, /state\.status === "running" && result/);
    assert.match(card, /const progressStatus = \(/);
    assert.match(card, /className="mc-refresh-status"[\s\S]*?\{progressStatus\}/);
    assert.match(card, /\{result && !resultDefect && \(/);
  });

  it("retains the last result if a replacement worker fails", () => {
    assert.match(
      hook,
      /setState\(\(previous\)\s*=>\s*\(\{[\s\S]*?status:\s*"error"[\s\S]*?result:\s*previous\.result/,
    );
    assert.match(card, /<strong>Not computed\.<\/strong>/);
  });
});
