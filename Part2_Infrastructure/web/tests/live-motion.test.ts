/**
 * Live values move; honest absences stay still.
 *
 * The dynamic pass wires NumberTicker and the freshness affordances into the
 * consoles — and every one of those wires is a chance to quietly replace a
 * dash with a zero, or a "Collecting" gate with a confident figure. So each
 * console pins both halves here: the ticker import that makes values move,
 * and the withheld-value branch that keeps absence honest.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("the Developer console is fed, stamped and pulsing", () => {
  const source = read("components/DeveloperConsole.tsx");

  it("renders the shared poll's age through FreshnessStamp", () => {
    assert.match(source, /<FreshnessStamp updatedAt=\{view\.updatedAt\}/);
  });

  it("counts through NumberTicker where the value can actually move", () => {
    assert.match(source, /NumberTicker value=\{readyCount\}/);
    assert.match(source, /NumberTicker value=\{openWork\.length\}/);
  });

  it("pulses only states fed by the live poll", () => {
    // The pill's live prop must always be conditional on a live-read tone or
    // a running simulation — a bare `live` with no condition would let a
    // committed-evidence pill impersonate a live conclusion.
    for (const match of source.matchAll(/live=\{([^}]+)\}/g)) {
      assert.match(
        match[1],
        /tone === "good"|status === "running"/,
        `StatusPill live={${match[1]}} is not gated on a live-read state`,
      );
    }
    assert.doesNotMatch(source, /<StatusPill[^>]*\slive\s[^=]/, "a bare live prop pulses unconditionally");
  });
});

describe("the header carries the workspace heartbeat", () => {
  const source = read("components/WorkspaceHeader.tsx");

  it("keys the health dot by the snapshot time", () => {
    assert.match(source, /key=\{healthUpdatedAt\?\.getTime\(\) \?\? 0\}/);
  });

  it("the dashboard feeds it the shared poll's clock", () => {
    assert.match(read("app/dashboard/page.tsx"), /healthUpdatedAt=\{systems\.updatedAt\}/);
  });
});

describe("motion never replaces the honest absence", () => {
  it("the work queue still reports an empty result", () => {
    const queue = read("components/developer/DeveloperWorkQueue.tsx");
    assert.match(queue, /No matching work/);
  });

  it("no nullable metric was coerced to zero on the way to a ticker", () => {
    // `?? 0` feeding a NumberTicker turns "we do not know" into "it is
    // fine" with an animation on top. The two consoles wired so far.
    for (const path of ["components/DeveloperConsole.tsx", "components/developer/DeveloperWorkQueue.tsx"]) {
      const source = read(path);
      assert.doesNotMatch(
        source,
        /NumberTicker value=\{[^}]*\?\? 0/,
        `${path} coerces a nullable into a ticker`,
      );
    }
  });
});
