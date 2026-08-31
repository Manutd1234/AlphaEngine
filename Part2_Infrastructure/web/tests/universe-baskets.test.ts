/**
 * The Baskets view says how much is at stake, not only what it costs.
 *
 * Ian's fifth-review brief asked this section for three figures — what a dollar
 * of the watchlist costs, how many contracts are outstanding, how much resting
 * liquidity there is — and a compact grid of where each family's size sits.
 * None of it was buildable before the size fields reached the wire; all of it
 * is drawn by `BasketSize`, off `lib/coherence/universe-metrics.ts`.
 *
 * Two halves. The label helpers are exercised against real numbers, because a
 * formatter is the last place a measured zero can quietly become a dash. The
 * component itself is read as SOURCE — `npm test` has no DOM (CLAUDE.md, fact
 * 6) — so what is pinned is that a future edit has to break the honesty rules
 * deliberately rather than by reflex.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { contractsLabel, dollarsLabel, groupDigits } from "../lib/coherence/universe-metrics";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const wrapper = read("../components/coherence/BasketSize.tsx");
const instrument = `${read("../components/coherence/UniverseInstruments.tsx")}\n${read("../components/coherence/UniverseLiquidityCabinet.tsx")}`;
const source = `${wrapper}\n${instrument}\n${read("../components/coherence/UniverseLiquidity.module.css")}`;
/** Comments explain the traps; a scan that cannot tell them apart reads the
 *  explanation as the offence. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\/.*$/gm, "");

describe("the figures print as the exchange sent them", () => {
  it("a contract count keeps the two places the venue quotes", () => {
    // 2112.64 + 21126.86 + 0.00 across the watched families.
    assert.equal(contractsLabel(232_395_000), "23,239.50");
  });

  it("a measured zero prints as a zero", () => {
    assert.equal(contractsLabel(0), "0.00");
    assert.equal(dollarsLabel(0), "$0.0000");
  });

  it("and an absent figure prints as a dash, never as a zero", () => {
    assert.equal(contractsLabel(null), "—");
    assert.equal(dollarsLabel(null), "—");
  });

  it("grouping moves no digit and rounds nothing", () => {
    // The whole numeric contract on this engine is "truncated, never rounded",
    // so the separator has to be presentational and provably so: same digits,
    // same order, same fraction, three-digit groups from the right. A formatter
    // that reached for `toLocaleString` would round the fraction to make the
    // figure prettier, which is the one thing it may not do.
    assert.equal(groupDigits("641674.28"), "641,674.28");
    assert.equal(groupDigits("1000"), "1,000");
    assert.equal(groupDigits("999"), "999");
    assert.equal(groupDigits("-1234567.8900"), "-1,234,567.8900");
    assert.equal(groupDigits("0.0000"), "0.0000");
    for (const raw of ["1.0600", "641674.28", "23239.50", "-9.9"]) {
      assert.equal(groupDigits(raw).replace(/,/g, ""), raw, `${raw} changed under grouping`);
    }
  });

  it("a dollar keeps all four places, because the last one is a price", () => {
    assert.equal(dollarsLabel(10_600), "$1.0600");
  });
});

describe("the three figures the brief asked for are all drawn", () => {
  it("names each of them on screen", () => {
    for (const label of ["Family basket value", "Family open interest", "Family liquidity"]) {
      assert.ok(source.includes(label), `the Baskets view no longer draws "${label}"`);
    }
  });

  it("reads them from the tested module rather than recomputing inline", () => {
    // A figure computed in JSX is a figure no suite in this repository can
    // check, because there is no renderer. The readings live in a pure module
    // for exactly that reason and this keeps them there.
    assert.match(code, /from "@\/lib\/coherence\/universe-metrics"/);
    for (const reader of ["contractsLabel", "dollarsLabel", "exposureBands"]) {
      assert.match(code, new RegExp(`\\b${reader}\\b`), `${reader} is imported but never used`);
    }
  });
});

describe("nothing here turns 'we do not know' into 'it is fine'", () => {
  it("coerces no nullable figure to zero", () => {
    assert.doesNotMatch(code, /\?\?\s*0\b/, "a nullable measurement was defaulted to zero");
  });

  it("says why a figure is missing rather than only dashing it", () => {
    // A dash on its own is the same failure one step quieter: the reader is
    // told nothing is known and not why.
    assert.ok(
      source.includes("carries no") || source.includes("was not reported"),
      "an absent total dashes without naming what caused it",
    );
  });

  it("refuses a share against a denominator of zero", () => {
    // The never-traded ladder: 60 legs, every one reporting 0.00. A share is
    // 0/0 there, which is undefined and not zero.
    assert.ok(
      source.includes("No open interest to distribute") || source.includes("nothing has traded"),
      "a family with no open interest draws bands without saying the shares are undefined",
    );
  });
});

describe("colour never carries a meaning on its own", () => {
  it("every shaded cell prints its own figure", () => {
    // forced-colors strips the fill entirely, and the house rule is that
    // anything a colour says a mark or a label must also say.
    assert.match(code, /color-mix/, "the grid is not shaded from a house token");
    assert.match(code, /aria-label=|<caption/, "the grid is unnamed to a screen reader");
  });

  it("shades from house tokens rather than a raw hex", () => {
    // Both halves of the mix are theme variables, so the grid flips with
    // data-theme instead of needing a dark ramp of its own.
    assert.match(code, /var\(--series-1\)/);
    assert.match(code, /var\(--surface-1\)/);
    assert.doesNotMatch(code, /#[0-9a-fA-F]{6}/, "a raw hex needs a comment and a reason");
  });
});

describe("the section actually renders it", () => {
  it("the Positions view draws the size card", () => {
    const pane = read("../components/coherence/UniversePane.tsx");
    assert.match(pane, /import BasketSize from "\.\/BasketSize"/);
    assert.match(pane, /<BasketSize\b/, "the component exists and nothing renders it");
    assert.match(pane, /view === "positions"/, "open interest was not split into its own view");
  });

  it("the compatibility entry point delegates to the canonical live instrument", () => {
    assert.match(wrapper, /<UniverseLiquidityCabinet universe=\{universe\} selectedTicker=\{selectedTicker\} \/>/);
    assert.match(instrument, /export function UniverseLiquidityCabinet/);
  });

  it("its copy is guarded, like every other pane that renders words", () => {
    // A component that renders copy and is not on this list is a claim guarded
    // by nothing — the failure `coherence-reading-claims.test.ts` exists to
    // stop, and the reason it names its own FILES list in its header.
    const claims = read("./coherence-reading-claims.test.ts");
    assert.match(claims, /BasketSize\.tsx/, "BasketSize renders copy that no claim guard scans");
  });
});
