/** Focused contract for the Coherence-test and Basket instrument upgrade. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toMicros } from "../lib/coherence/payoff-by-state";
import { MEANINGFUL_EDGE } from "../lib/coherence/thresholds";
import { read, stripNonCode } from "./helpers/workspace-sources";

const views = read("../components/coherence/CertificateViews.tsx");
const check = read("../components/coherence/CheckLadder.tsx");
const formation = read("../components/coherence/FormationDiagram.tsx");
const constraints = read("../components/coherence/ConstraintLadder.tsx");
const solverProof = read("../components/coherence/SolverProofLoom.tsx");
const ladder = read("../components/coherence/LadderPrices.tsx");
const sizes = read("../components/coherence/LegSizes.tsx");
const payoff = read("../components/coherence/PayoffByState.tsx");
const coverage = read("../components/coherence/StateCoverage.tsx");
const footprint = read("../components/coherence/BasketFootprint.tsx");
const sparse = read("../components/coherence/BasketNullInstrument.tsx");

describe("every Coherence-test view is a stable exact reading", () => {
  it("Verdict follows the actual four-step decision path in one full-width figure", () => {
    const verdict = views.slice(views.indexOf("export function VerdictView("));
    assert.match(verdict, /<CheckLadder certificate=\{data\} \/>/);
    assert.doesNotMatch(verdict.slice(0, verdict.indexOf("export function ProofView(")),
      /MarginAxis|coh-grid--2/,
      "the verdict still splits one decision between two cramped figures");
    for (const stage of ["Quote set", "Feasibility test", "Decision line", "Verdict"]) {
      assert.match(check, new RegExp(`title: "${stage}"`), `${stage} is missing from the verdict flow`);
    }
    assert.match(check, /caption="Quoted prices → feasibility test → decision line → verdict"/);
    assert.match(check, /keyLine="Read left to right: each box hands one decision to the next\."/);
  });

  it("keeps a priced-out quote violation separate from the fee-aware programme result", () => {
    assert.match(check, /const programmeIncoherent = certificate\.verdict === "incoherent";/,
      "the decision-line result is not named independently");
    assert.match(check, /const priceIncoherent = programmeIncoherent \|\| Boolean\(certificate\.priced_out\);/,
      "priced_out does not preserve the raw quote violation for the final verdict");

    const decisionAt = check.indexOf('title: "Decision line"');
    const verdictAt = check.indexOf('title: "Verdict"', decisionAt);
    const stagesEnd = check.indexOf("  ];", verdictAt);
    assert.ok(decisionAt > -1 && verdictAt > decisionAt && stagesEnd > verdictAt,
      "the two verdict stages cannot be isolated");
    const decisionStage = check.slice(decisionAt, verdictAt);
    const finalStage = check.slice(verdictAt, stagesEnd);

    assert.match(decisionStage, /holds: crossesDecisionLine == null \? null : !crossesDecisionLine/,
      "the fee-aware programme stage is not driven by its printed margin");
    assert.doesNotMatch(decisionStage, /priceIncoherent/,
      "priced_out incorrectly marks the programme decision line as failed");
    assert.match(check, /const verdictWord = untestable[\s\S]*?: priceIncoherent[\s\S]*?certificate\.priced_out \? "Incoherent, priced out" : "Incoherent"/,
      "the final verdict label does not name the priced-out quote violation");
    assert.match(finalStage, /value: verdictWord/,
      "the final box does not render the price-aware verdict label");
    assert.match(finalStage, /holds: untestable \? null : priceIncoherent \? false : true/,
      "the final box can render a priced-out violation as holding");
    assert.match(check, /certificate\.priced_out[\s\S]*?The quote test failed, but fees kept the programme inside its trade line; the final box keeps those two conclusions separate\./,
      "the priced-out reading does not explain why the programme and price verdict differ");
  });

  it("compares the exact margin to the decision line independently of an untestable verdict", () => {
    assert.match(check, /import \{ toMicros \} from "@\/lib\/coherence\/payoff-by-state"/);
    assert.match(check, /import \{ MEANINGFUL_EDGE \} from "@\/lib\/coherence\/thresholds"/);
    assert.match(check, /const DECISION_LINE_MICROS = Math\.round\(MEANINGFUL_EDGE \* 1_000_000\);/,
      "the displayed decision line and comparison threshold do not share one constant");
    assert.match(check, /function marginCrossesDecisionLine\(margin: string \| null\): boolean \| null \{[\s\S]*?const marginMicros = toMicros\(margin\);/,
      "the six-decimal wire margin is not converted through the exact helper");
    assert.match(check, /return marginMicros == null \? null : marginMicros > DECISION_LINE_MICROS;/,
      "the decision line does not use a strict exact-micro comparison");
    assert.match(check, /const crossesDecisionLine = marginCrossesDecisionLine\(certificate\.margin\);/,
      "the certificate margin does not drive the shared decision-line comparison");

    const thresholdMicros = Math.round(MEANINGFUL_EDGE * 1_000_000);
    assert.equal(toMicros("0.000100"), thresholdMicros,
      "a margin exactly on the line must still hold");
    assert.ok((toMicros("0.000101") ?? 0) > thresholdMicros,
      "the next six-decimal margin above the line must cross it");

    const decisionAt = check.indexOf('title: "Decision line"');
    const verdictAt = check.indexOf('title: "Verdict"', decisionAt);
    const stagesEnd = check.indexOf("  ];", verdictAt);
    assert.ok(decisionAt > -1 && verdictAt > decisionAt && stagesEnd > verdictAt,
      "the decision and final stages cannot be isolated");
    const decisionStage = check.slice(decisionAt, verdictAt);
    const finalStage = check.slice(verdictAt, stagesEnd);
    assert.match(decisionStage, /holds: crossesDecisionLine == null \? null : !crossesDecisionLine/,
      "an available margin does not control the decision-line mark");
    assert.doesNotMatch(stripNonCode(decisionStage), /untestable|certificate\.verdict/,
      "an untestable final verdict suppresses an exact crossed-margin finding");
    assert.match(check, /const verdictWord = untestable\s*\? "Untestable"/,
      "an untestable certificate loses its final verdict label");
    assert.match(finalStage, /holds: untestable \? null : priceIncoherent \? false : true/,
      "the final box does not remain untestable independently of the crossed margin");
    assert.match(finalStage, /the continuous optimum crossed the line, but no whole-hundredth position could hold it/,
      "the final note misattributes an execution-quantum refusal to missing inputs");
  });

  it("the verdict ladder prints cards and arrows without plot interaction state", () => {
    assert.match(formation, /<ol className="coh-decision-flow__rail">/);
    assert.match(formation, /<article className="coh-decision-flow__card" data-state=\{state\}>/);
    assert.match(formation, /stage\.value \?\? "Not measured"/);
    assert.match(formation, /index < stages\.length - 1[\s\S]*?<ArrowRight \/>/);
    assert.match(formation, /reserveInteractionRow=\{false\}/);
    assert.doesNotMatch(stripNonCode(formation), /<Plot\b|sharedX=|useHot\(|useState\(/,
      "the static decision chain still carries hover, pin or selection state");
  });

  it("Proof and Checks split the derivation from the zero-boundary ledger", () => {
    assert.match(views, /export function ProofView[\s\S]*?<ConstraintLadder event=\{event\} certificate=\{data\} view="proof" \/>/);
    assert.match(views, /export function ChecksView[\s\S]*?<ConstraintLadder event=\{event\} certificate=\{data\} view="checks" \/>/);
    assert.match(constraints, /if \(view === "proof"\)[\s\S]*?<SolverProofLoom certificate=\{certificate\} event=\{event\} \/>/,
      "the solver proof and browser checks are still one derivation");
    for (const stage of ["Observed vector", "Solver system", "Decision boundary", "Solver verdict"]) {
      assert.match(solverProof, new RegExp(`title: "${stage}"`), `${stage} is missing from the solver proof`);
    }
    for (const field of [
      "observation.markets_observed",
      "solver.variables",
      "solver.state_rows",
      "solver.optimum",
      "solver.decision_boundary",
      "constraints.rows",
    ]) {
      assert.ok(solverProof.includes(field), `${field} does not drive the proof`);
    }
    assert.match(solverProof, /This view will not manufacture one from frontend quote checks/,
      "a missing structured proof can still be replaced by browser arithmetic");
    assert.doesNotMatch(stripNonCode(solverProof), /constraintsOf\(/,
      "the solver proof still re-derives its own evidence in the browser");

    assert.match(constraints, /The six tightest independent checks/);
    assert.match(constraints, /zero is the decision boundary/);
    assert.match(constraints, /money\(constraint\.slack\)/,
      "ranked checks do not keep the exact slack beside their geometry");
    assert.match(constraints, /All \$\{tested\.length\} independent quote checks/);
    assert.match(constraints, /<td className="num">\{money\(constraint\.slack\)\}<\/td>/);
    assert.match(constraints, /skipped, never counted as passes/,
      "missing quote sides can be mistaken for passing constraints");
    assert.doesNotMatch(stripNonCode(`${constraints}\n${solverProof}`), /<Plot\b|sharedX=|pin: true|useHot\(/,
      "the proof still relies on fragile per-mark inspection state");
    assert.doesNotMatch(
      stripNonCode(constraints),
      /constraint\.slack\s*\?\?\s*0\b/,
      "an absent slack must not be compared as a measured zero",
    );

    assert.match(solverProof, /const \[selectedStage, setSelectedStage\] = useState\(0\)/,
      "the Proof path has no inspectable stage state");
    assert.match(solverProof, /className="coh-proof-loom__stages"[\s\S]*?aria-pressed=\{selectedStage === index\}/,
      "the Proof path does not expose its active stage");
    for (const event of ["onPointerEnter", "onFocus", "onClick", "onKeyDown"]) {
      assert.match(solverProof, new RegExp(event), `${event} does not operate the Proof path inspector`);
    }
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      assert.match(solverProof, new RegExp(`${key}:`), `${key} is missing from the Proof path keyboard map`);
    }
    assert.match(solverProof, /<output className="coh-proof-path__inspector" aria-live="polite" aria-atomic="true">/,
      "the selected proof stage is not announced as one stable exact reading");

    const proofView = views.slice(
      views.indexOf("export function ProofView("),
      views.indexOf("export function ChecksView("),
    );
    const summaries = [...proofView.matchAll(/<summary>([^<]+)<\/summary>/g)].map((match) => match[1]);
    assert.deepEqual(summaries, [
      "The solver&rsquo;s own words",
      "What the solver had to assume to reach this verdict",
    ], "Proof disclosure summaries must omit both '4 lines' and a trailing note count");
  });

  it("Prices and Sizes each own one exact inspectable curve", () => {
    const pricesAt = views.indexOf("export function PricesView(");
    const sizesAt = views.indexOf("export function SizesView(");
    const prices = views.slice(pricesAt, sizesAt);
    const sizeView = views.slice(sizesAt);
    assert.match(prices, /<LadderPrices event=\{event\}/);
    assert.doesNotMatch(prices, /<LegSizes event=\{event\}/);
    assert.match(sizeView, /<LegSizes event=\{event\}/);
    assert.doesNotMatch(`${prices}\n${sizeView}`, /<LinkedX>|coh-grid--2/);
    for (const [name, source] of [["LadderPrices", ladder], ["LegSizes", sizes]] as const) {
      assert.match(source, /<Plot\b/, `${name} has no streamlined outcome curve`);
      assert.match(source, /sharedX=\{\(width\) => \(\{/,
        `${name} does not expose outcomes through the shared inspector`);
      assert.match(source, /pin: true/, `${name} does not let the reader pin an exact outcome`);
      assert.match(source, /readout=/, `${name} has no at-rest summary`);
      assert.match(source, /Exact (?:quote|size) ledger/,
        `${name} has no persistent exact ledger`);
    }
    assert.match(ladder, /const bidPath = linePath[\s\S]*?const askPath = linePath/,
      "the price view does not draw separate bid and ask curves");
    assert.match(sizes, /role="group" aria-label="Size measure"[\s\S]*?aria-pressed=\{scale\.metric\.key === metricKey\}/,
      "the size curve has no explicit one-unit-at-a-time selector");
  });
});

describe("Basket and Size keep exact readings in populated and zero-leg results", () => {
  it("pins one state across payoff and coverage", () => {
    assert.match(payoff, /link: "basket-states"/);
    assert.match(payoff, /pin: true/);
    assert.match(payoff, /readout=/);
    assert.match(coverage, /link,/);
    assert.match(coverage, /pin: true/);
    assert.match(coverage, /readout=/);
  });

  it("Size selects every leg with exact numerator, denominators and both shares", () => {
    assert.match(footprint, /columns\.map\(\(column, index\)/);
    assert.match(footprint, /aria-pressed=\{selected === index\}/);
    for (const event of ["onPointerEnter", "onFocus", "onClick"]) {
      assert.match(footprint, new RegExp(event), `${event} does not select an exact capacity row`);
    }
    for (const label of ["Solver size", "Open interest", "Share of OI", "Traded volume", "Share of traded"]) {
      assert.match(footprint, new RegExp(`>${label}<`), `${label} is absent from the exact leg reading`);
    }
    assert.match(footprint, /data-selected-detail=""/);
    assert.match(footprint, /aria-live="polite"/);
    assert.match(footprint, /missingReason/);
    assert.match(footprint, /tradedMissingReason/);
    assert.match(footprint, /familyUnread[\s\S]*?the selected family has not been read yet/,
      "an unread family is mislabeled as an off-family market");
    assert.match(footprint, /aria-label=\{`Inspect[\s\S]*?Requirement[\s\S]*?Open interest[\s\S]*?Share of open interest/,
      "capacity controls do not expose the exact visible quantities in their accessible names");
    assert.match(footprint, /selectedTicker/);
    assert.doesNotMatch(footprint, /const \[selectedIndex,/,
      "live leg reordering can move a positional selection to another market");
    assert.match(footprint, /if \(!columns\.length\)/);
    assert.doesNotMatch(footprint, /if \(!columns\.length \|\| !drawn\.length\)/,
      "an all-unmeasurable basket is replaced by a static empty figure");
    assert.match(footprint, /!drawn\.length[\s\S]*?Select any leg to inspect its exact refusal/,
      "unmeasurable legs do not retain their interactive exact-refusal stops");
    assert.doesNotMatch(footprint, /<Plot|sharedX=/,
      "the capacity rows route selection through a conditional-height plot readout");
    assert.doesNotMatch(stripNonCode(footprint), /\?\?\s*0\b/);
  });

  it("Coverage chooses label density against the phone plot, not a desktop estimate", () => {
    assert.match(coverage, /const REFERENCE_W = 264/);
    assert.doesNotMatch(coverage, /const REFERENCE_W = 680/);
  });

  it("the common zero-leg answer is an inspectable dependency circuit", () => {
    assert.match(sparse, /className=\{styles\.dependencyRail\}/);
    assert.match(sparse, /className=\{styles\.dependencyGauge\}/);
    assert.match(sparse, /className=\{styles\.dependencyInspector\}/);
    assert.match(sparse, /role="tablist"/);
    assert.match(sparse, /role="tab"/);
    assert.match(sparse, /aria-selected=\{selected === index\}/);
    assert.match(sparse, /tabIndex=\{selected === index \? 0 : -1\}/);
    assert.match(sparse, /aria-controls=\{`\$\{circuitId\}-detail`\}/);
    assert.match(sparse, /role="tabpanel"/);
    assert.match(sparse, /aria-labelledby=\{`\$\{circuitId\}-stage-\$\{selected\}`\}/);
    for (const event of ["onPointerEnter", "onFocus", "onClick", "onKeyDown"]) {
      assert.match(sparse, new RegExp(event), `${event} does not select a process stage`);
    }
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
      assert.match(sparse, new RegExp(`${key}:`), `${key} is missing from the circuit keyboard map`);
    }
    assert.match(sparse, /readout=/);
    assert.match(sparse, /certificate\.legs\.length/,
      "the returned leg count is hard-coded instead of read from the certificate");
    assert.match(sparse, /event\.markets\.length/,
      "the Size circuit is stagnant instead of reading the selected family");
    assert.match(sparse, /open_interest[\s\S]*volume[\s\S]*liquidity/,
      "the Size circuit omits live venue activity fields");
    assert.match(sparse, /data-selected-detail=""/);
    assert.match(sparse, /aria-live="polite"/);
    assert.match(sparse, /aria-atomic="true"/);
    assert.doesNotMatch(sparse, /<Plot|sharedX=/,
      "the process routes selection through a conditional-height plot readout");
  });
});
