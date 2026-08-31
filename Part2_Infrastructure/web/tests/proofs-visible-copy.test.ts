/**
 * Source-derived Proofs summary-copy budget.
 *
 * The shared baseline intentionally measures the source-static import closure:
 * it is a conservative upper bound, not what an operator sees. This narrower
 * ledger projects the fixed strings associated with each of the 29 canonical
 * Proofs routes. It is not a browser-visible count: collapsed method rationale,
 * live payload rows, responsive CSS and repeated DOM ownership are outside this
 * deliberately narrow comparison.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ENGINE_VIEW_EVIDENCE } from "../components/coherence/EngineViewEvidence";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

type ProofsSection = keyof typeof SECTION_FILES;

const SECTION_FILES = {
  certificate: "CertificatePane.tsx",
  portfolio: "BasketSection.tsx",
  combos: "CombosSection.tsx",
  index: "IndexSection.tsx",
  calibration: "CalibrationPane.tsx",
  corpus: "CorpusSection.tsx",
  lessons: "LessonsPane.tsx",
} as const;

const PRIOR_HEADS: Record<ProofsSection, readonly string[]> = {
  certificate: [
    "Coherence test", "Whether these prices admit a probability measure", "one test per family",
    "The usual answer is coherent, and that is the claim: a detector that spoke only on a hit would leave no opportunity and the feed is down identical.",
    "Verdict", "Proof", "Prices",
  ],
  portfolio: [
    "Basket", "The portfolio the test hands back", "one basket per family, priced through all three fee components",
    "Where no probability measure fits, duality hands back a basket that wins in every state: the certificate of infeasibility is the trade.",
    "Cover", "Basket", "Size",
  ],
  combos: [
    "Parlays", "The bounds a parlay's own legs impose on it", "one band per parlay, from the legs the venue lists",
    "Two marginals do not determine a joint; the Fréchet–Hoeffding inequalities say they bound it.",
    "Bands", "Parlays", "Bounds",
  ],
  index: [
    "Coherence index", "How far these prices sit from admitting a probability", "measured every poll, on markets that have not settled",
    "Zero is prices that admit a probability exactly; above it is ‖p − q‖₁ to the nearest coherent vector.",
    "By poll", "By family",
  ],
  calibration: [
    "Scorecard", "Were the prices right, on what has settled", "the settled corpus",
    "A price vector can be arbitrage-free and still be wrong about the world, so this scores calibration instead: of the contracts priced near a dime, how many paid?",
    "Score", "Bands",
  ],
  corpus: [
    "Corpus", "What the score was computed on", "the settled sample, and how it accrued",
    "A Brier score is a score of whatever happened to settle, so the mixture it was taken over decides what the figure on Scorecard is a figure about.",
    "Composition", "Score trend",
  ],
  lessons: [
    "Lessons", "The curriculum and what guards it", "14 of 14 built",
    "Each lesson names the module it is about and the test that goes red if it stops being true, and each runs as a notebook under notebooks/coherence_lab against the same modules.",
    "Quotes", "Structure", "Bounds", "Record", "Coverage", "Episode states",
  ],
};

const CURRENT_HEADS: Record<ProofsSection, readonly string[]> = {
  certificate: ["Coherence test", "LP feasibility of quoted prices", "one LP per family", "Why no-hit is evidence", "Verdict", "Proof", "Checks", "Prices", "Sizes"],
  portfolio: ["Basket", "Infeasibility dual basket", "one basket per family; three fees", "Duality condition", "Cover", "Basket", "Size"],
  combos: ["Parlays", "Price ranges", "Method", "Ranges", "Test quote", "Leg prices", "Test legs", "Checks"],
  index: ["Coherence index", "L1 distance from coherence", "each poll; unsettled", "Distance definition", "By poll", "By family"],
  calibration: [
    "Scorecard", "Settled Brier calibration", "settled corpus", "Calibration question",
    "Overview", "Equation", "Component scale", "Measures", "Reliability", "Bands",
  ],
  corpus: ["Corpus", "Score composition", "settled sample accrual", "Sample caveat", "Composition", "Score trend"],
  lessons: ["Lessons", "Claim-to-test guard graph", "14 of 14 built", "Curriculum contract", "Quotes", "Structure", "Bounds", "Record", "Coverage", "Episode states"],
};

const CURRENT_COMMON = [
  "Proofs", "Prices tested as probabilities",
  "Coherence test", "Basket", "Parlays", "Coherence index", "Scorecard", "Corpus", "Lessons",
  "Lead readout", "Unit", "Method", "Source",
] as const;

const PRIOR_COMMON = [
  ...CURRENT_COMMON,
  "LP feasibility returns a basket that wins in every state; settled calibration tests the record.",
] as const;

const HEALTHY_LIVE_CHROME = [
  "Transport", "Transport current", "Reading the exchange", "Exchange reachable", "Fixed-point schema", "Read only",
] as const;

const words = (parts: readonly string[]) => parts
  .flatMap((part) => part.match(/[\p{L}\p{N}]+(?:[._'’+-][\p{L}\p{N}]+)*/gu) ?? [])
  .length;

function routeCopy(key: string, current: boolean): string[] {
  const [section] = key.split("/") as [ProofsSection];
  const evidence = ENGINE_VIEW_EVIDENCE.coherence[key as keyof typeof ENGINE_VIEW_EVIDENCE.coherence];
  const copy = [
    ...(current ? CURRENT_COMMON : PRIOR_COMMON),
    ...(section === "lessons" ? [] : HEALTHY_LIVE_CHROME),
    ...(current ? CURRENT_HEADS[section] : PRIOR_HEADS[section]),
    evidence.readout, evidence.unit, evidence.method, evidence.source,
  ];
  return copy;
}

describe("Proofs source-derived summary-copy budget", () => {
  const routes = Object.keys(ENGINE_VIEW_EVIDENCE.coherence);
  const priorWords = routes.reduce((sum, key) => sum + words(routeCopy(key, false)), 0);
  const currentWords = routes.reduce((sum, key) => sum + words(routeCopy(key, true)), 0);
  const reduction = (priorWords - currentWords) / priorWords;

  it("keeps the 29-route summary projection at least ten percent below its baseline", () => {
    assert.equal(routes.length, 29);
    assert.equal(priorWords, 2_850);
    assert.equal(currentWords, 1_600);
    assert.equal(priorWords - currentWords, 1_250);
    assert.ok(reduction >= 0.10, `expected at least a 10% source-summary reduction, got ${(reduction * 100).toFixed(2)}%`);
    const requestedSweep = (1_685 - currentWords) / 1_685;
    assert.ok(requestedSweep >= 0.05 && requestedSweep <= 0.10,
      `expected this sweep to remove 5–10%, got ${(requestedSweep * 100).toFixed(2)}%`);
  });

  it("ties every current head token to the rendered source", () => {
    for (const [section, file] of Object.entries(SECTION_FILES) as [ProofsSection, string][]) {
      const source = read(`components/coherence/${file}`);
      for (const token of CURRENT_HEADS[section]) {
        if (section === "lessons" && token === "14 of 14 built") {
          assert.match(source, /`\$\{shipped\} of \$\{COHERENCE_LESSONS\.length\} built`/);
          continue;
        }
        assert.ok(source.includes(token), `${section} at-rest ledger drifted at: ${token}`);
      }
    }
  });

  it("does not confuse the rendered metric with the source-static upper bound", () => {
    const shared = read("tests/frontend-content-baseline.test.ts");
    assert.match(shared, /source-static import-closure upper bound/);
    assert.match(shared, /browserObserved, false/);
  });

  it("keeps the exact Proofs premise in the bounded Evidence Sheet", () => {
    const consoleSource = read("components/CoherenceConsole.tsx");
    assert.ok(consoleSource.includes(
      "LP feasibility returns a basket that wins in every state; settled calibration tests the record.",
    ));
    assert.match(consoleSource, /<EngineViewEvidence[\s\S]*deskContext="LP feasibility returns a basket that wins in every state; settled calibration tests the record\."/);
    const head = consoleSource.slice(consoleSource.indexOf("<PageHead"), consoleSource.indexOf("<EngineStatePanel"));
    assert.doesNotMatch(head, /description=/);
  });
});
