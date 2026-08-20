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

describe("a NumberTicker keeps its box wherever it counts", () => {
  // The ticker renders as a span of its own. A descendant `span` rule on the
  // surface around it restyles that span too — the readiness rows made it a
  // grid box, so "8/8" rendered as "8" over "/8", and the ring demoted its
  // numerator to the muted denominator size. Direct-child selectors only.
  const css = read("app/globals.css");

  it("the readiness rows style their own cells, not the ticker inside them", () => {
    assert.match(css, /\.developer-cp-readiness__checks > div > span \{/);
    assert.match(css, /\.developer-cp-readiness__checks > div > span > b \{/);
    assert.match(css, /\.developer-cp-readiness__checks > div > span > small \{/);
    assert.match(css, /\.developer-cp-readiness__checks > div > strong \{/);
    assert.doesNotMatch(css, /\.developer-cp-readiness__checks span \{/);
    assert.doesNotMatch(css, /\.developer-cp-readiness__checks strong \{/);
  });

  it("the ring's denominator rule excludes the ticking numerator", () => {
    assert.match(css, /\.developer-cp-readiness__ring strong > span:not\(\.number-ticker\) \{/);
    assert.doesNotMatch(css, /\.developer-cp-readiness__ring strong span \{/);
  });

  it("the context facts style direct spans only", () => {
    assert.doesNotMatch(css, /\.developer-cp-context__facts span \{/);
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

describe("durations wear the unit their magnitude earns", () => {
  /**
   * The wire carries gate latency in ms; a 0.21 ms decision printed as "0.21
   * ms" hides everything the desk measures below a millisecond. Every surface
   * that shows a decision duration goes through formatDuration, which also
   * keeps the null → dash rule inside one function instead of five.
   */
  const SURFACES = [
    "components/execution/ExecutionQuality.tsx",
    "components/execution/DeskTape.tsx",
    "components/execution/OrderTicket.tsx",
    // The lifetime latency tiles and the by-instrument latency column moved
    // out of PortfolioWorkspace with the Performance section when that file was
    // split; the workspace itself now formats no duration at all.
    "components/portfolio/PerformanceSection.tsx",
  ];

  it("every decision-latency surface imports formatDuration and stops hand-appending ms", () => {
    for (const path of SURFACES) {
      const source = read(path);
      assert.match(source, /formatDuration/, `${path} must format durations through formatDuration`);
      assert.doesNotMatch(
        source,
        /fmt\([^)]*[lL]atency[^)]*\)\}?\s?ms/,
        `${path} still hand-appends "ms" to a latency figure`,
      );
    }
  });

  it("the histogram's axis takes a formatter so its ends read in the right unit", () => {
    const histogram = read("components/execution/LatencyHistogram.tsx");
    assert.match(histogram, /format\?: \(value: number\) => string/);
    const quality = read("components/execution/ExecutionQuality.tsx");
    assert.match(quality, /<LatencyHistogram[\s\S]{0,300}format=\{\(v\) => formatDuration\(v, "ms"\)\}/);
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
    for (const path of [
      "components/DeveloperConsole.tsx",
      "components/developer/DeveloperWorkQueue.tsx",
      "components/header/LatencyChip.tsx",
      "components/ReliabilityConsole.tsx",
    ]) {
      const source = read(path);
      assert.doesNotMatch(
        source,
        /NumberTicker value=\{[^}]*\?\? 0/,
        `${path} coerces a nullable into a ticker`,
      );
    }
  });
});
