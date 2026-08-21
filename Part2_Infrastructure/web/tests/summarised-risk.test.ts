/**
 * The Risk tab's REWRITING pass, pinned fact by fact.
 *
 * Three passes have now run over this tab. The first DELETED what was
 * redundant and stopped at 1.9%, because what was left was load-bearing. The
 * second FOLDED prose behind `<details>` byte-identically —
 * `tests/disclosure-risk.test.ts` is that pass's guard, and it asserts a list
 * of sentences VERBATIM. This pass is neither: it says the same fact in fewer
 * words.
 *
 * WHY THIS FILE EXISTS
 * ------------------------------------------------------------------------
 * Commit 8d091a3, "Cut 610 words from the frontend, then put 16 facts back",
 * is what a rewriting pass looks like when nothing counts the facts. A cut
 * that loses a number, a threshold, a named entity, a negation or a qualifier
 * reads BETTER than the original — that is precisely why it survives review.
 * So every sentence this pass touched is decomposed below into the tokens it
 * asserts, and each token is checked to still be reachable in the file that
 * renders it. A rewrite that drops "usually", "not", "at least" or "20" fails
 * here rather than shipping as a tidier screen.
 *
 * WHAT IS NOT ASSERTED, DELIBERATELY
 * ------------------------------------------------------------------------
 * No word ceiling. `tests/copy-audit.test.ts` opens by refusing to cap length,
 * on the grounds that "detailed" and "wordy" are different properties and a
 * test that cannot tell them apart pushes the desk toward saying less than it
 * knows. A ratchet on prose volume would be exactly that test. What is pinned
 * instead is the FACT, in both directions: the token must still be there, and
 * the specific filler this pass removed must not come back.
 *
 * THE EMPTY-HAYSTACK TRAP
 * ------------------------------------------------------------------------
 * Every `doesNotMatch` below scans a string that has already been asserted
 * non-empty by `readSource` and again by the first suite here. A scan of ""
 * passes every negative assertion in this file and proves nothing; that trap
 * has been found repeatedly in this tree.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode } from "./helpers/source-files";

/**
 * The nine files this pass rewrote in.
 *
 * The first six are the ones `tests/disclosure-risk.test.ts` calls the Risk
 * tab's sources. `CorrelationMatrix` and `HeadroomBar` are Risk surfaces that
 * suite does not list — the drivers subtab mounts the first through
 * `RiskEngine`, the limits subtab mounts the second directly. `UnrealisedSpread`
 * is mounted by `PositionsSection` on the Portfolio tab, alongside
 * `ExposureHeatmap`; both speak the limit-and-open-P&L vocabulary this pass was
 * given, and the Risk tab's cross-link tile is what sends a reader to them.
 */
const PATHS = [
  "components/RiskWorkspace.tsx",
  "components/portfolio/RiskEngine.tsx",
  "components/portfolio/StressTest.tsx",
  "components/portfolio/VarBacktestChart.tsx",
  "components/portfolio/OracleVarPanel.tsx",
  "components/portfolio/ExposureHeatmap.tsx",
  "components/portfolio/CorrelationMatrix.tsx",
  "components/portfolio/HeadroomBar.tsx",
  "components/portfolio/UnrealisedSpread.tsx",
] as const;

type Path = (typeof PATHS)[number];

const raw = new Map<Path, string>();
const code = new Map<Path, string>();
for (const path of PATHS) {
  const text = readSource(path);
  raw.set(path, text);
  // Comments stripped: a comment recording what a rewrite kept must not be
  // what satisfies the assertion that it was kept.
  code.set(path, stripCode(text).replace(/\s+/g, " "));
}

const rendered = (path: Path) => code.get(path) as string;

/**
 * Fact matching is case-insensitive, deliberately.
 *
 * A rewrite that promotes a clause to the head of its sentence capitalises its
 * first word — "That is close to one position…" became "Close to one position…"
 * — and a case-sensitive check would call that a lost fact. Capitalisation is
 * not a fact. Every token below is still matched as a contiguous phrase, which
 * is what stops the check from passing on scattered words.
 */
const carries = (path: Path, token: string) =>
  rendered(path).toLowerCase().includes(token.toLowerCase());

/**
 * One sentence this pass rewrote.
 *
 * `facts` are the assertable tokens the ORIGINAL carried — numbers, units,
 * thresholds, named entities, negations, qualifiers, and the reason a
 * measurement is missing. Every one must survive the rewrite. `filler` is the
 * throat-clearing that came out, asserted gone so the sentence cannot silently
 * grow back.
 */
interface Rewrite {
  path: Path;
  what: string;
  facts: string[];
  filler: string[];
}

const REWRITES: Rewrite[] = [
  {
    path: "components/RiskWorkspace.tsx",
    what: "how effective positions is derived",
    facts: [
      "1 ÷ the Herfindahl index",
      "book&apos;s weights",
      "equally-sized positions",
      "would carry",
      "{positions.length} position",
      "concentration.effective_positions",
      "one bet",
    ],
    filler: ["this much concentration", "really one bet"],
  },
  {
    path: "components/portfolio/ExposureHeatmap.tsx",
    what: "why only utilisation is drawn",
    facts: [
      "Utilisation is nearness",
      "risk gate",
      "enforced cap",
      "small position",
      "nearest a hard stop",
      "Share of gross has no 100% to draw against",
    ],
    filler: ["can be the one nearest"],
  },
  {
    path: "components/portfolio/ExposureHeatmap.tsx",
    what: "the chart's aria-label",
    facts: [
      "Symbol-limit utilisation for ${rows.length} positions, ranked",
      "${withheld} have no published limit",
      "${tight.length} at or above",
      "${pct(TIGHT, 0)} of their limit",
      "figures in the table below",
    ],
    filler: ["The same figures are in the table below"],
  },
  {
    path: "components/portfolio/CorrelationMatrix.tsx",
    what: "the 0.8-correlation banner",
    facts: [
      "close to one position of their combined size",
      "less diversified",
      "the position count suggests",
    ],
    filler: ["That is close to one position"],
  },
  {
    path: "components/portfolio/UnrealisedSpread.tsx",
    what: "the flat-book empty state",
    facts: [
      "No open position carries an unrealised figure",
      "nothing to distribute",
      "A flat book",
      "not an unmeasured one",
    ],
    filler: ["so there is nothing to distribute"],
  },
  {
    path: "components/portfolio/UnrealisedSpread.tsx",
    what: "what a small total can hide",
    facts: [
      "two large positions cancelling",
      "the same total",
      "only one",
      "is quiet",
    ],
    filler: ["only one of them is quiet"],
  },
  {
    path: "components/portfolio/HeadroomBar.tsx",
    what: "the gauge appended for an uncovered binding constraint",
    facts: ["gateway", "reported", "tightest constraint"],
    filler: ["reported by the gateway as the tightest constraint"],
  },
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    what: "the no-exceptions note",
    facts: [
      "No day in this window",
      "lost more than its own forecast",
      "At 95%",
      "never breached",
      "usually",
      "too wide",
    ],
    filler: ["a model that is never breached"],
  },
  {
    path: "components/portfolio/StressTest.tsx",
    what: "the not-measurable source tooltip",
    facts: ["No beta measured", "no move was assumed"],
    filler: ["No beta could be measured"],
  },
  {
    path: "components/portfolio/StressTest.tsx",
    what: "the not-propagated source tooltip",
    facts: ["No move is set for ${referenceSymbol}", "beta has nothing to propagate"],
    filler: ["nothing to propagate from"],
  },
  {
    path: "components/portfolio/VarBacktestChart.tsx",
    what: "the forecast-against-realised subhead",
    facts: ["where the model was breached", "whether breaches clustered"],
    filler: ["whether the breaches clustered"],
  },
  {
    path: "components/portfolio/CorrelationMatrix.tsx",
    what: "the single-instrument empty state",
    facts: [
      "One measurable instrument",
      "Correlation needs a pair",
      "nothing shows",
      "a second position has enough history",
    ],
    filler: ["a pair, so nothing shows"],
  },
  {
    path: "components/portfolio/CorrelationMatrix.tsx",
    what: "the measured-not-assumed note",
    facts: [
      "daily closes of the instruments actually held",
      "not from assumed factor loadings",
      "The diagonal is 1.00 by construction",
      "not measurement",
    ],
    filler: ["not by measurement"],
  },
];

describe("the Risk tab's sources are actually being read", () => {
  // Without this, every doesNotMatch below would pass by scanning nothing and
  // the whole suite would be green over an empty string.
  it("every file loads with content and renders a component", () => {
    for (const path of PATHS) {
      const text = raw.get(path) as string;
      assert.ok(text.length > 500, `${path} read as ${text.length} chars — too short to be real`);
      assert.match(text, /export default function/, `${path} renders no component`);
      assert.ok(
        rendered(path).length > 200,
        `${path} is all comment once stripped — nothing rendered to assert over`,
      );
    }
  });

  it("finds a sentence for every rewrite it claims to be checking", () => {
    assert.ok(REWRITES.length >= 13, `expected the thirteen rewrites, found ${REWRITES.length}`);
    for (const { path, what, facts } of REWRITES) {
      assert.ok(facts.length >= 2, `"${what}" in ${path} enumerates ${facts.length} fact — decompose it`);
    }
  });
});

describe("every fact the original carried survives the rewrite", () => {
  for (const { path, what, facts } of REWRITES) {
    for (const fact of facts) {
      it(`${path.split("/").pop()} — ${what}: still asserts ${JSON.stringify(fact)}`, () => {
        assert.ok(
          carries(path, fact),
          `this token is GONE from ${path}. A shorter sentence that stopped asserting it is `
          + `not a summary of the old one, it is a different claim:\n    ${fact}`,
        );
      });
    }
  }
});

describe("the filler this pass removed does not grow back", () => {
  for (const { path, what, filler } of REWRITES) {
    for (const phrase of filler) {
      it(`${path.split("/").pop()} — ${what}: no longer says ${JSON.stringify(phrase)}`, () => {
        assert.ok(
          !carries(path, phrase),
          `this wording was rewritten away and is back in ${path}:\n    ${phrase}`,
        );
      });
    }
  }
});

/**
 * The five kinds of token a rewrite is most likely to drop, checked where this
 * tab actually carries them — independently of which sentence was touched.
 *
 * Every entry here is a sentence this pass REFUSED to shorten, or a bound
 * inside one it did. They are the failure recorded in 8d091a3: a number, a
 * threshold, a negation, a qualifier and the reason a measurement is missing
 * are each removable without the sentence reading broken.
 */
describe("the tokens a rewrite is most likely to drop", () => {
  it("the covariance floor keeps its number, its unit and its refusal", () => {
    const engine = rendered("components/portfolio/RiskEngine.tsx");
    assert.ok(engine.includes("at least 20 aligned observations per instrument"),
      "the sample floor lost its threshold, its unit or its scope");
    assert.ok(engine.includes("Nothing is shown rather than a figure built on an assumed correlation"),
      '"rather than" is the whole claim — without it this says a figure IS shown');
  });

  it("the thin-sample banner keeps the odds it is a sample of", () => {
    const chart = rendered("components/portfolio/VarBacktestChart.tsx");
    assert.ok(chart.includes("one-in-twenty event"), "the 95% quantile lost its plain-English odds");
    assert.ok(chart.includes("weak evidence, not a validation"),
      "without the negation a green zone reads as a validation");
  });

  it("the exclusion notes keep the direction of the error", () => {
    assert.ok(
      rendered("components/portfolio/RiskEngine.tsx").includes("understated"),
      "the VaR tiles stopped saying which way the missing history biases them",
    );
    assert.ok(
      rendered("components/portfolio/VarBacktestChart.tsx").includes("this model looks better than it is"),
      "the backtest stopped saying which way the undercount flatters it",
    );
  });

  it("the divergence note keeps its threshold and its two named methods", () => {
    const oracle = rendered("components/portfolio/OracleVarPanel.tsx");
    assert.ok(oracle.includes("more than 15%"), "the divergence threshold went");
    assert.ok(oracle.includes("Oracle 23ai"), "the database that computed the figure went unnamed");
    assert.ok(oracle.includes("not the one-day book VaR"),
      "without the negation the two VaRs read as one number with two sources");
  });

  it("the stress panel keeps beta's two different silences apart", () => {
    const stress = rendered("components/portfolio/StressTest.tsx");
    assert.ok(stress.includes("no move was assumed"), "the not-measurable case lost its reason");
    assert.ok(stress.includes("beta has nothing to propagate"),
      "the not-propagated case lost its reason and collapses into the other one");
  });

  it("the pinned-flat note keeps the qualifier that makes it a warning", () => {
    assert.ok(
      rendered("components/portfolio/StressTest.tsx").includes("pinned flat, not left alone"),
      "without the negation a slider at 0% reads as an untouched row",
    );
  });

  it("the safety line above the two destructive buttons is untouched", () => {
    assert.ok(
      rendered("components/RiskWorkspace.tsx")
        .includes("holds no gateway credential and cannot move risk"),
      "the sentence that makes Flatten and Halt read as request composers",
    );
  });
});
