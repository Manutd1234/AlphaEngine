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
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

describe("the Developer console is fed, stamped and pulsing", () => {
  /**
   * The console is a shell and six sections since it passed the length
   * ceiling, so its three properties are pinned where each one landed rather
   * than at one path that now holds only the first. The stamp stayed on the
   * shell — it is the head's, above the rail. The counters went to the
   * Overview section with the readiness ring and the queue tile. The pills are
   * everywhere, so the pulse scan reads the shell AND every section: pointing
   * it at one file would leave the others free to pulse unconditionally.
   */
  const shell = read("components/DeveloperConsole.tsx");
  const overview = read("components/developer/DeveloperOverview.tsx");
  const sections = readdirSync(`${root}components/developer`)
    .filter((entry) => entry.endsWith(".tsx"))
    .map((entry) => [`components/developer/${entry}`, read(`components/developer/${entry}`)] as const);

  it("renders the shared poll's age through FreshnessStamp", () => {
    assert.match(shell, /<FreshnessStamp updatedAt=\{view\.updatedAt\}/);
  });

  it("counts through NumberTicker where the value can actually move", () => {
    assert.match(overview, /NumberTicker value=\{readyCount\}/);
    assert.match(overview, /NumberTicker value=\{openWork\.length\}/);
  });

  it("pulses only states fed by the live poll", () => {
    // The pill's live prop must always be conditional on a live-read tone or
    // a running simulation — a bare `live` with no condition would let a
    // committed-evidence pill impersonate a live conclusion.
    let pills = 0;
    for (const [path, source] of [["components/DeveloperConsole.tsx", shell] as const, ...sections]) {
      for (const match of source.matchAll(/[^-]\blive=\{([^}]+)\}/g)) {
        pills += 1;
        assert.match(
          match[1],
          /tone === "good"|status === "running"/,
          `${path}: StatusPill live={${match[1]}} is not gated on a live-read state`,
        );
      }
      assert.doesNotMatch(
        source, /<StatusPill[^>]*\slive\s[^=]/,
        `${path}: a bare live prop pulses unconditionally`,
      );
    }
    // A scan that finds no pill is a scan pointed at the wrong files, which is
    // exactly how this check would have gone quiet when the console split.
    assert.ok(pills >= 3, "the console's pulsing pills moved again; this check is reading nothing");
  });
});

describe("a NumberTicker keeps its box wherever it counts", () => {
  // The ticker renders as a span of its own. A descendant `span` rule on the
  // surface around it restyles that span too — the readiness rows made it a
  // grid box, so "8/8" rendered as "8" over "/8", and the ring demoted its
  // numerator to the muted denominator size. Direct-child selectors only.
  const css = globalsCss;

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
    // The decision latency prints in the verdict, which left OrderTicket
    // when that file passed the length ceiling.
    "components/execution/OrderVerdict.tsx",
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
    // fine" with an animation on top. The two consoles wired so far —
    // the Developer console's own tickers are in its Overview section since
    // the split, and the shell it left behind renders none.
    for (const path of [
      "components/developer/DeveloperOverview.tsx",
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
