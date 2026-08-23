/**
 * The trace console keeps one server cursor per instance.
 *
 * The event ring is process-local and the deployment is serverless, so two
 * consecutive polls routinely answer from two instances with two sequence
 * spaces. The console used to treat that as a discontinuity — rewind to zero,
 * count a gap, print the ▲ notice — which on Vercel happened within a minute of
 * opening the tab, every time, and sent readers hunting for a hole in the log
 * that was a fact about the hosting. Source-level pins, in the house style.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = readFileSync(`${root}components/systems/TraceConsole.tsx`, "utf8");
const pull = source.slice(source.indexOf("const pull = useCallback"), source.indexOf("}, []);", source.indexOf("const pull = useCallback")));

describe("one cursor per server instance", () => {
  it("keeps the cursor in a map keyed by instance, not in one number", () => {
    assert.match(source, /const serverCursors = useRef<Map<string, number>>\(new Map\(\)\);/);
    assert.doesNotMatch(source, /serverCursor\.current = 0/, "the rewind-to-zero on an instance switch is gone");
  });

  it("asks with the expected instance's cursor, and asks again with the answering instance's when they differ", () => {
    assert.match(pull, /const since = expected === null \? 0 : \(serverCursors\.current\.get\(expected\) \?\? 0\);/);
    assert.match(pull, /for \(let attempt = 0; attempt < 2; attempt \+= 1\)/);
    assert.match(pull, /if \(expected !== null && expected !== instanceId\) \{[\s\S]*?continue;/);
  });

  it("advances only the answering instance's cursor, by what it returned", () => {
    assert.match(pull, /serverCursors\.current\.set\(instanceId, latest\)/);
  });

  it("counts a gap for a ring that advanced past the cursor, and for nothing else", () => {
    const gapIncrements = pull.match(/setGaps\(\(count\) => count \+ 1\)/g) ?? [];
    assert.equal(gapIncrements.length, 1, "exactly one cause is left");
    assert.match(pull, /if \(body\.dropped\) setGaps\(\(count\) => count \+ 1\);/);
  });

  it("keys server lines by instance, so two rings merge without colliding", () => {
    assert.match(source, /key: `server:\$\{instanceId\}:\$\{event\.seq\}`/);
  });

  it("the notice names the one cause it can still mean", () => {
    assert.match(source, /a server ring advanced past this\s+client&apos;s cursor/);
    assert.doesNotMatch(source, /landed on a different instance/);
  });
});
