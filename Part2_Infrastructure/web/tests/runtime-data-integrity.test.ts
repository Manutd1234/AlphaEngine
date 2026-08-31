/**
 * Runtime data integrity across the eleven workspace tabs.
 *
 * This suite guards provenance boundaries, not literals in general. Static
 * labels, SVG geometry, mathematical constants, and versioned policy are valid
 * application code. What is forbidden is a production read path silently
 * turning a fixed snapshot or generated sandbox into an observed result.
 *
 * The checks intentionally combine two levels:
 *
 * - scan the runtime source tree for the fixed fixtures and permanent feature
 *   branches that previously bypassed live inputs;
 * - exercise the shared source machine to prove that a failed probe cannot
 *   select generated data, while an explicit Sandbox choice still can.
 *
 * Keeping those two levels together makes the contract broad enough to cover
 * the shared dependencies behind all tabs without banning harmless numbers or
 * presentation copy.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { DeskSourceMachine } from "../lib/desk-source";
import { NAV_ITEMS } from "../lib/workspace-nav";
import { stripCode } from "./helpers/source-files";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const runtimeRoots = ["app", "components", "lib"] as const;

interface RuntimeSource {
  path: string;
  code: string;
}

function runtimeSources(): RuntimeSource[] {
  const sources: RuntimeSource[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
      } else if (/\.tsx?$/.test(entry.name)) {
        sources.push({
          path: relative(webRoot, path).split(sep).join("/"),
          code: stripCode(readFileSync(path, "utf8")),
        });
      }
    }
  };
  for (const root of runtimeRoots) visit(join(webRoot, root));
  return sources;
}

const runtime = runtimeSources();
const source = (path: string) => {
  const match = runtime.find((candidate) => candidate.path === path);
  assert.ok(match, `${path} is part of the runtime contract but could not be read`);
  return match.code;
};

const offenders = (pattern: RegExp) => runtime
  .filter((candidate) => pattern.test(candidate.code))
  .map((candidate) => candidate.path);

const canonicalTabs = [
  ["overview", "Overview"],
  ["research", "Research"],
  ["live", "Execution"],
  ["portfolio", "Portfolio"],
  ["risk", "Risk"],
  ["data", "Data"],
  ["reliability", "Reliability"],
  ["developer", "Developer"],
  ["markets", "Markets"],
  ["coherence", "Proofs"],
  ["diffusion", "Diffusion"],
] as const;

describe("the provenance contract covers the canonical workspace", () => {
  it("names exactly the eleven tabs in their routed order", () => {
    assert.equal(NAV_ITEMS.length, 11);
    assert.deepEqual(
      NAV_ITEMS.map(({ id, label }) => [id, label]),
      canonicalTabs,
    );
  });
});

describe("fixed analytical snapshots are test fixtures, never runtime inputs", () => {
  it("keeps coherence fallback modules and their loader names out of production", () => {
    const runtimeFallbackFiles = runtime
      .map((candidate) => candidate.path)
      .filter((path) => /^lib\/coherence\/fallback-(?:data|market|diffusion)/.test(path));
    assert.deepEqual(runtimeFallbackFiles, []);
    assert.deepEqual(
      offenders(/\b(?:withCoherenceFallback|coherenceFallbackFor)\b/),
      [],
      "a production module can still hydrate fixed coherence data",
    );
    assert.deepEqual(
      offenders(/(?:from\s+|import\s*\(\s*)["'][^"']*coherence-fallback[^"']*["']/),
      [],
      "a production module imports a test-only coherence snapshot",
    );
  });

  it("starts Research without importing the committed seed run", () => {
    assert.deepEqual(
      offenders(/(?:from\s+|import\s*\(\s*)["'][^"']*seed-run(?:\.json)?["']/),
      [],
      "a runtime module imports the committed research result",
    );
    assert.match(source("lib/use-sweep-run.ts"), /useState<SweepResponse \| null>\(null\)/);
  });

  it("keeps generated OHLCV builders and authored work rows in test fixtures", () => {
    assert.deepEqual(
      offenders(/\bsyntheticBars\b/),
      [],
      "a production module can still manufacture market bars",
    );
    assert.deepEqual(
      offenders(/(?:from\s+|import\s*\(\s*)["'][^"']*tests\/helpers\/(?:synthetic-bars|data-work-items)[^"']*["']/),
      [],
      "a production module imports authored test rows",
    );
  });

  it("lets provider exhaustion remain an error instead of authoring a quote or issuer", () => {
    const facades = source("lib/providers/facades.ts");
    assert.doesNotMatch(
      facades,
      /withSandboxFallback|sandboxQuote|sandboxFundamentals|SANDBOX_PROVIDER/,
    );
    assert.match(facades, /return dispatch\(/);
  });
});

describe("generated desks require a reader's Sandbox choice", () => {
  it("keeps failures empty or measured and reserves generation for choose('sandbox')", () => {
    const measured = { equity: 125 };
    const machine = new DeskSourceMachine<typeof measured>({ now: () => 1_700_000_000_000 });

    machine.observe({ ok: false, failure: { code: "gateway_unreachable" } });
    assert.equal(machine.state.showing.kind, "empty");

    machine.observe({ ok: true, payload: measured });
    machine.observe({ ok: false, failure: { code: "gateway_unreachable" } });
    assert.deepEqual(machine.state.showing, {
      kind: "measured",
      payload: measured,
      tier: "cached",
      lastGoodAt: new Date(1_700_000_000_000),
    });

    machine.choose("sandbox");
    assert.deepEqual(machine.state.showing, { kind: "generated", cause: "chosen" });
  });

  it("routes Portfolio, Risk, and Execution through the shared source decision", () => {
    const bookHook = source("lib/use-book.ts");
    const cockpitHook = source("components/execution/use-cockpit-feed.ts");

    assert.match(bookHook, /useDeskSource<PortfolioPayload>\(\)/);
    assert.match(bookHook, /const book: PortfolioPayload \| null = sandbox \? generated : measured;/);
    assert.equal(
      (bookHook.match(/\bchoose\(/g) ?? []).length,
      1,
      "the book hook has a second, non-control path into a generated source",
    );
    assert.doesNotMatch(bookHook, /setSandbox\(true\)/);

    assert.match(cockpitHook, /new DeskSourceMachine<PortfolioSnapshot>\(\)/);
    assert.match(
      cockpitHook,
      /showing\.kind === "generated" \? "sandbox" : "outage"/,
      "an unavailable cockpit collapses into the generated mode",
    );
    assert.equal(
      (cockpitHook.match(/\.choose\(/g) ?? []).length,
      2,
      "the cockpit has a sandbox choice outside its two-way source control",
    );
    assert.doesNotMatch(cockpitHook, /setBook\(null\)/);
  });

  it("lets the generic gateway generator run only while explicitly paused", () => {
    const connection = source("lib/use-gateway-connection.ts");
    const pausedStart = connection.indexOf("if (paused) {");
    const pausedEnd = connection.indexOf("return () => { alive.current = false; };", pausedStart);
    assert.ok(pausedStart >= 0 && pausedEnd > pausedStart, "the explicit paused branch moved or disappeared");
    const pausedBranch = connection.slice(pausedStart, pausedEnd);
    const rest = connection.slice(0, pausedStart) + connection.slice(pausedEnd);

    assert.match(pausedBranch, /const generate = fallbackRef\.current/);
    assert.match(pausedBranch, /setTier\("sandbox"\)/);
    assert.doesNotMatch(rest, /const generate = fallbackRef\.current|setTier\("sandbox"\)/);
  });
});

describe("first visits do not begin with production-looking work", () => {
  it("starts the gateway Data queue empty", () => {
    const queueHook = source("lib/use-data-work-queue.ts");
    assert.match(queueHook, /useState<DataWorkItem\[\]>\(\[\]\)/);
    assert.doesNotMatch(queueHook, /createInitialDataWorkItems|DATA_WORK_SEEDS/);
    assert.doesNotMatch(source("lib/data-work-queue.ts"), /createInitialDataWorkItems|DATA_WORK_SEEDS/);
  });

  it("starts the browser-owned Developer queue empty", () => {
    const dashboard = source("app/dashboard/page.tsx");
    const developerWork = source("lib/developer-work.ts");
    assert.match(dashboard, /useState<DeveloperWorkItem\[\]>\(\[\]\)/);
    assert.doesNotMatch(dashboard, /createInitialDeveloperWorkItems/);
    assert.doesNotMatch(developerWork, /createInitialDeveloperWorkItems|DEVELOPER_WORK_SEEDS/);
  });
});

describe("diagram implementations do not ship behind permanent branches", () => {
  it("contains no const redesigned = true switch in production source", () => {
    assert.deepEqual(
      offenders(/\bconst\s+redesigned\s*=\s*true\b/),
      [],
      "a permanent redesign switch leaves a stale diagram implementation reachable in source",
    );
  });
});
