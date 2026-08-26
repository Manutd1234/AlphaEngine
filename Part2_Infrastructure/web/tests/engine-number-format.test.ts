/**
 * Every number on the engine tabs is printed by the helper for its kind.
 *
 * The rule `lib/coherence/decimals.ts` states: a fixed-point wire string is
 * printed from the string, truncated, never through a float; a browser-derived
 * quantity may round, through `lib/format.ts`; the call site says which by the
 * helper it calls. What this file refuses is the third thing — a formatter
 * written in a component. On 2026-08-26 there were two `decimalLabel`s, two
 * `spanLabel`s, two `centsOf`s, a private `count`, two locale calls, and a
 * `Math.round(x * 100)}%` beside a `pct()`.
 *
 * THREE RATCHETS, NOT BANS, because three of the shapes are sometimes right:
 * `toFixed` on a float axis tick, `?? 0` seeding a counter or sizing a track,
 * a `$` template on the reader's own slider cents. Each is listed per file
 * with a count and a reason; a count may fall, never rise, and an entry that
 * reaches zero must leave — the shape `tabular-numerals.test.ts` set.
 *
 * COMMENTS ONLY are stripped. The formatters' own doc blocks quote the calls
 * this file bans, and `stripNonCode` would blank the string literals the `$`
 * and `%` rules read.
 */

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const code = (source: string) =>
  source.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

function engineSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "diffusion" || entry === "lesson-figures") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, `${rel}/${entry}`);
      else if (/\.tsx?$/.test(entry)) out.push([`${rel}/${entry}`, code(read(`../${rel}/${entry}`))]);
    }
  };
  walk(join(process.cwd(), "components", "coherence"), "components/coherence");
  return out.sort(([a], [b]) => a.localeCompare(b));
}
const SOURCES = engineSources();
const lineOf = (source: string, index: number) => source.slice(0, index).split("\n").length;

/** A ratchet: per-file allowance with its reason. Counts may only fall; a zero must leave. */
function ratchet(name: string, pattern: RegExp, allow: Record<string, { count: number; reason: string }>) {
  describe(`${name} appears only where it is allowed, and no more often`, () => {
    const seen = new Map<string, number>();
    for (const [file, source] of SOURCES) {
      const hits = [...source.matchAll(pattern)];
      if (hits.length) seen.set(file, hits.length);
    }
    for (const [file, count] of seen) {
      it(`${file.split("/").pop()} — ${count}`, () => {
        const allowed = allow[file];
        assert.ok(allowed, `${file} has ${count} ${name} site(s) and no allowance; print through the helper for its kind, or list it with a reason`);
        assert.ok(count <= allowed.count, `${file} grew from ${allowed.count} to ${count} ${name} site(s) — the ratchet turns one way`);
      });
    }
    it("every allowance still describes a file that needs it", () => {
      const stale = Object.entries(allow).filter(([file, { count }]) => (seen.get(file) ?? 0) < count);
      assert.deepEqual(stale.map(([file, { count }]) => `${file}: allowed ${count}, has ${seen.get(file) ?? 0}`), [],
        "an allowance above the count it describes stops describing the tree and starts excusing it — lower it or remove it");
    });
  });
}

describe("a formatter is declared once, in lib/coherence/decimals.ts", () => {
  const decimals = read("../lib/coherence/decimals.ts");
  it("the module exports the one of each", () => {
    for (const name of ["decimalLabel", "truncateDecimal", "statValue", "unitOf", "toUnit", "probLabel", "countLabel", "secondsLabel"]) {
      assert.match(decimals, new RegExp(`export function ${name}\\(`), `decimals.ts does not export ${name}`);
    }
  });
  it("no component declares one of its own", () => {
    // `count` only as a FUNCTION: `const count = …` is a counter in five files
    // and a formatter in none of them.
    const declared = /(?:export )?(?:function|const) (decimalLabel|truncateDecimal|statValue|unitOf|toUnit|probLabel|spanLabel)\b|function (count)\(/g;
    // The Markets session's two `spanLabel(ms)` copies leave with slice 19;
    // listed so the debt is visible, and asserted to still exist.
    const KNOWN_DECLARED = new Set(["components/coherence/BookHistory.tsx spanLabel", "components/coherence/LiveTape.tsx spanLabel"]);
    const offenders: string[] = [];
    const debts: string[] = [];
    for (const [file, source] of SOURCES) {
      for (const match of source.matchAll(declared)) {
        const name = match[1] ?? match[2];
        if (KNOWN_DECLARED.has(`${file} ${name}`)) debts.push(`${file} ${name}`);
        else offenders.push(`${file}:${lineOf(source, match.index)} ${name}`);
      }
    }
    assert.deepEqual(offenders, [], "a formatter written in a component is the second definition of the same number");
    assert.deepEqual(debts.sort(), [...KNOWN_DECLARED].sort(), "a KNOWN_DECLARED debt that is repaid must leave the list");
  });
  it("no engine file reaches a locale to print a number", () => {
    const offenders: string[] = [];
    for (const [file, source] of SOURCES) {
      for (const match of source.matchAll(/toLocaleString\(|Intl\.NumberFormat|"en-GB"|"en-US"/g)) {
        offenders.push(`${file}:${lineOf(source, match.index)}`);
      }
    }
    assert.deepEqual(offenders, [], "a locale call rounds the fraction to make it prettier; groupDigits keeps the figure");
  });
  it("metricRow has no engine caller — the middle dot stays out of these rows", () => {
    for (const [file, source] of SOURCES) assert.doesNotMatch(source, /\bmetricRow\b/, file);
  });
});

describe("a share printed in JSX goes through pct(), a cut string through decimalLabel", () => {
  it("no Math.round(x * 100)% in rendered text", () => {
    // The Markets session's one, applied with slice 19; asserted to still exist.
    // Repaid 2026-08-26 (BasketSize prints `pct(share, 0)`); the list stays so
    // the next debt has somewhere to be declared, and is asserted empty-or-red.
    const KNOWN: string[] = [];
    const offenders: string[] = [];
    const debts: string[] = [];
    for (const [file, source] of SOURCES) {
      // Inside `style={{` a rounded percentage is a colour-mix stop, not a printed number.
      for (const match of source.matchAll(/Math\.round\([^)]*\* ?100\)\}%/g)) {
        const before = source.slice(Math.max(0, match.index - 160), match.index);
        if (/style=\{\{[^}]*$/.test(before)) continue;
        (KNOWN.includes(file) ? debts : offenders).push(`${file}:${lineOf(source, match.index)}`);
      }
    }
    assert.deepEqual(offenders, []);
    if (KNOWN.length) assert.ok(debts.length, "a KNOWN rounded share is repaid — remove it from KNOWN");
  });
  it("no wire string is shortened with .slice() in a cell", () => {
    const offenders: string[] = [];
    for (const [file, source] of SOURCES) {
      for (const match of source.matchAll(/<td[^>]*>\{[^}]*\.slice\(0, ?\d+\)[^}]*\}<\/td>/g)) {
        offenders.push(`${file}:${lineOf(source, match.index)}`);
      }
    }
    assert.deepEqual(offenders, [], "a sliced decimal is a truncation nobody declared; decimalLabel says how many places and marks the cut");
  });
});

ratchet("toFixed(", /\.toFixed\(/g, {
  // Axis ticks and geometry on float scales — a pixel is not a fixed-point quantity.
  "components/coherence/BasketWhatIf.tsx": { count: 10, reason: "the reader's slider cents: integer cents ÷ 100 is exact at two places" },
  "components/coherence/surface/MomentsShape.tsx": { count: 9, reason: "float moments drawn on a float axis; the table prints the wire strings" },
  "components/coherence/ReliabilityDiagram.tsx": { count: 8, reason: "axis ticks and dot geometry on a float scale; every printed statistic goes through decimalLabel" },
  "components/coherence/ShortfallScale.tsx": { count: 1, reason: "orders of magnitude, a float by nature" },
  "components/coherence/LadderChart.tsx": { count: 8, reason: "its own comment: cumulative depth at a float level" },
  "components/coherence/SurvivalChart.tsx": { count: 6, reason: "strike-axis ticks" },
  "components/coherence/FeeCurve.tsx": { count: 3, reason: "float points — use-live-series does not retain the wire string" },
  "components/coherence/surface/EdgeScatter.tsx": { count: 2, reason: "scatter axis ticks" },
  "components/coherence/IndexSeriesChart.tsx": { count: 4, reason: "lane ticks on a float scale" },
  "components/coherence/CorpusShares.tsx": { count: 2, reason: "slope-axis ticks" },
  "components/coherence/CombosBounds.tsx": { count: 2, reason: "slack-axis ticks" },
  "components/coherence/CalibrationTrend.tsx": { count: 4, reason: "skill-axis ticks" },
  "components/coherence/StateCoverage.tsx": { count: 2, reason: "a coverage share drawn, not printed" },
  "components/coherence/SettlementPane.tsx": { count: 1, reason: "degrees of a float temperature" },
  "components/coherence/LiveTape.tsx": { count: 1, reason: "float tape points" },
  "components/coherence/LessonCoverage.tsx": { count: 2, reason: "a coverage share drawn" },
  "components/coherence/LadderPrices.tsx": { count: 1, reason: "a float radius" },
  "components/coherence/IndexBasisChart.tsx": { count: 2, reason: "float index readings" },
  "components/coherence/FeeParabola.tsx": { count: 2, reason: "a sampled float curve" },
  "components/coherence/FamilyRidge.tsx": { count: 2, reason: "a lane tick" },
  "components/coherence/ConstraintLadder.tsx": { count: 2, reason: "a decade tick" },
  "components/coherence/BookHistory.tsx": { count: 1, reason: "float history points" },
});

ratchet("?? 0 / || 0", /\?\? 0\b|\|\| 0\b/g, {
  "components/coherence/ValueStrip.tsx": { count: 2, reason: "an axis extent seeded at zero — geometry, the values themselves are never coerced" },
  "components/coherence/IndexSeriesChart.tsx": { count: 1, reason: "a counter: (map.get(k) ?? 0) + 1" },
  "components/coherence/UniverseSection.tsx": { count: 1, reason: "a counter" },
  "components/coherence/IndexPane.tsx": { count: 1, reason: "a counter" },
  "components/coherence/HorizonAxis.tsx": { count: 1, reason: "axis width only, argued in place; the null mark is withheld" },
  "components/coherence/ConstraintLadder.tsx": { count: 2, reason: "counts of rows a missing set contributes none of" },
  "components/coherence/surface/StakeBars.tsx": { count: 1, reason: "a track width floor" },
  "components/coherence/FamilyRidge.tsx": { count: 2, reason: "an ordinal slot lookup that cannot miss, and a shared-y scale floor — geometry; the peak itself prints through fromCenticents" },
  "components/coherence/FrechetBand.tsx": { count: 1, reason: "violated_rows is a row COUNT the wire omits when it checked none; the reading names the rows, so a null here is not a metric coerced" },
  "components/coherence/BasketComposition.tsx": { count: 1, reason: "a counter: (map.get(k) ?? 0) + 1" },
});

ratchet("$-template", /`\$\$\{|\$\$\{/g, {
  "components/coherence/BasketWhatIf.tsx": { count: 3, reason: "the reader's own slider total, in cents ÷ 100" },
});

describe("the tabular-numerals ratchet knows every engine formatter", () => {
  it("NUMERIC names the six helpers whose output is a number", () => {
    const numerals = read("./tabular-numerals.test.ts");
    const line = /const NUMERIC = "([^"]+)"/.exec(numerals)?.[1] ?? "";
    for (const name of ["priceLabel", "dollarsLabel", "contractsLabel", "countLabel", "secondsLabel", "probLabel"]) {
      assert.ok(line.split("|").includes(name), `tabular-numerals' NUMERIC lacks ${name}, so a cell printing it is invisible to the .num ratchet`);
    }
  });
});
