/**
 * Four places that turned "not measured" into a number, and one that turned a
 * list into bullets.
 *
 * The doctrine these violate is the repo's oldest: null is never coerced to
 * zero, because zero is a measurement and absence is not. Each of these shipped
 * anyway, and each is the same defect wearing different clothes — a beta of
 * 0.00 invents an exposure, a latency of 0ms invents the fastest possible
 * response, and $0 of depth invents an empty book where there is only an
 * unread one.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments explain the trap; a scan that cannot tell them apart reads the
 *  explanation as the offence. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/.*$/gm, "");

describe("an unmeasured number is dashed, not zeroed", () => {
  it("stress test withholds a beta it could not compute", () => {
    // The file's own header says beta-as-1 "quietly invents exposure"; `?? 0`
    // was doing the same thing one decimal lower.
    const source = code(read("../components/portfolio/StressTest.tsx"));
    assert.doesNotMatch(source, /beta \?\? 0/);
    assert.match(source, /p\.beta == null \? "β —"/);
  });

  it("the latency trend does not tell a screen reader it is instant", () => {
    const source = code(read("../components/systems/LatencyTrend.tsx"));
    assert.doesNotMatch(source, /p99 \?\? 0/);
    assert.match(source, /currently not measured/);
  });

  it("depth tiles dash when the spread tile beside them dashes", () => {
    const source = code(read("../components/LiveMarket.tsx"));
    assert.doesNotMatch(source, /depthUsdBid \?\? 0/);
    assert.doesNotMatch(source, /depthUsdAsk \?\? 0/);
    assert.match(source, /depthUsdBid == null \? "—"/);
  });
});

describe("an order that gets no answer says so", () => {
  const source = read("../components/execution/OrderTicket.tsx");

  it("carries a deadline, so a hung gateway cannot spin forever", () => {
    assert.match(source, /AbortSignal\.timeout\(ORDER_TIMEOUT_MS\)/);
  });

  it("outlives the gateway's own deadline rather than pre-empting it", () => {
    // If the browser gave up first, a slow-but-real verdict would be discarded
    // and reported as a transport failure.
    const browser = Number(/ORDER_TIMEOUT_MS = ([\d_]+)/.exec(source)?.[1]?.replace(/_/g, ""));
    const server = Number(
      /DEFAULT_TIMEOUT_MS = ([\d_]+)/.exec(read("../lib/gateway.ts"))?.[1]?.replace(/_/g, ""),
    );
    assert.ok(browser > server, `browser ${browser}ms must outlast gateway ${server}ms`);
  });

  it("never claims nothing was sent when it does not know that", () => {
    /**
     * An abort cannot prove the request failed to arrive — the gateway may have
     * decided it. Reporting "could not be submitted" would be a claim this code
     * is not entitled to make, and it invites a blind resubmit.
     */
    assert.match(source, /TimeoutError/);
    assert.match(source, /may still have been decided/);
    assert.match(source, /Check the blotter before resubmitting/);
  });
});

describe("legends are lists without being bulleted", () => {
  it("resets list-style, which four ul call sites depend on", () => {
    /**
     * Nothing else suppresses the marker: the global reset clears padding only,
     * and Tailwind preflight is deliberately never loaded. Without this the
     * swatch rows render as "• — Add to reach target".
     */
    const css = read("../app/globals.css");
    const rule = /\.legend \{([^}]*)\}/.exec(css)?.[1] ?? "";
    assert.match(rule, /list-style:\s*none/);
  });

  it("still has no bare ul call site relying on a rule that does not exist", () => {
    // Prefix match, not exact: a call site may legitimately add a modifier
    // class beside `legend`. What matters is that it is a `<ul>` reaching for
    // the rule that now resets the marker.
    for (const file of [
      "../components/portfolio/DriftBars.tsx",
      "../components/portfolio/ExposureHeatmap.tsx",
      "../components/systems/RouteLatencyBars.tsx",
      "../components/execution/SpreadDecomposition.tsx",
    ]) {
      assert.match(read(file), /<ul className="legend[ "]/, `${file} stopped using the legend list`);
    }
  });
});

describe("imports that resolved to nothing are gone", () => {
  it("leaves no identifier imported and never referenced", () => {
    // Nothing in the toolchain catches these: there is no ESLint config and
    // tsconfig sets neither noUnusedLocals nor noUnusedParameters.
    for (const [file, name] of [
      ["../components/execution/ExecutionCockpit.tsx", "OrderBlotter"],
      ["../components/portfolio/PnlWaterfall.tsx", "fmt"],
      ["../components/research/ExperimentHistory.tsx", "signedPct"],
      // A directory since quant became a package: the check is that the name
      // appears in NO file of the module, which one path could assert while it
      // was one file and cannot now.
      ["../lib/quant", "FactorLoading"],
    ] as const) {
      const targets = file.endsWith(".ts") || file.endsWith(".tsx")
        ? [file]
        : readdirSync(new URL(file, import.meta.url)).map((entry) => `${file}/${entry}`);
      const hits = targets.reduce(
        (total, target) => total + (read(target).match(new RegExp(`\\b${name}\\b`, "g"))?.length ?? 0),
        0,
      );
      assert.equal(hits, 0, `${file} still imports ${name} without using it`);
    }
  });
});
