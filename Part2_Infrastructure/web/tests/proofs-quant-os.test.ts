/**
 * Proofs' 2026-08-27 quant-OS pass.
 *
 * This suite pins the parts a screenshot cannot: every addressable view keeps
 * an evidence contract, all view switchers share the keyboard-safe source-owned
 * control, transport failures carry a bounded retry and a correlation id, and
 * the registry-backed Lessons views remain outside that transport grammar.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { ENGINE_VIEW_EVIDENCE } from "../components/coherence/EngineViewEvidence";
import {
  coherenceTransportMeta,
  nextRetryReading,
} from "../lib/coherence/transport-state";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const readProofsCss = () => [
  read("app/globals/14zzb-proofs-workbench.css"),
  read("app/globals/14zzbc-proofs-certificate-flow.css"),
  read("app/globals/14zzbd-proofs-responsive.css"),
  read("app/globals/14zzbe-proofs-path-inspector.css"),
].join("\n");
const readMethodMapCss = () => read("components/coherence/ProofsMethodMap.module.css");

const SECTIONS = [
  "CertificatePane.tsx",
  "BasketSection.tsx",
  "CombosSection.tsx",
  "IndexSection.tsx",
  "CalibrationPane.tsx",
  "CorpusSection.tsx",
  "LessonsPane.tsx",
] as const;

describe("all 29 Proofs views use one technical interaction contract", () => {
  it("keeps exactly 29 evidence rows, with method, unit and source", () => {
    const views = Object.entries(ENGINE_VIEW_EVIDENCE.coherence);
    assert.equal(views.length, 29);
    assert.equal(new Set(views.map(([key]) => key)).size, 29);
    for (const [key, evidence] of views) {
      assert.ok(evidence.readout.length > 5, `${key} lost its readout`);
      assert.ok(evidence.unit.length > 2, `${key} lost its unit`);
      assert.ok(evidence.method.length > 4, `${key} lost its method`);
      assert.ok(evidence.source.length > 4, `${key} lost its source`);
    }
  });

  it("uses the source-owned ToggleGroup control in every section", () => {
    const control = read("components/coherence/ProofsViewControl.tsx");
    const switcher = read("components/workspace/QuantViewSwitcher.tsx");
    assert.match(control, /<QuantViewSwitcher\b/);
    assert.match(switcher, /from "@\/components\/ui\/toggle-group"/);
    assert.match(switcher, /<ToggleGroup\b/);
    assert.match(switcher, /<ToggleGroupItem\b/);
    assert.match(switcher, /type="single"/);
    assert.match(switcher, /aria-label=\{label\}/);

    for (const section of SECTIONS) {
      const source = read(`components/coherence/${section}`);
      assert.match(source, /<ProofsViewControl\b/, `${section} kept a bespoke switcher`);
      assert.doesNotMatch(source, /<button\b/, `${section} kept a raw view button`);
    }
  });

  it("keeps the certificate views compact, ahead of the family picker", () => {
    const pane = read("components/coherence/CertificatePane.tsx");
    const family = read("components/coherence/FamilyChoice.tsx");
    const picker = read("components/coherence/FamilyPicker.tsx");
    const planeCss = read("app/globals/10a-coherence-plane.css");
    const css = readProofsCss();

    assert.match(pane, /\["verdict", "Verdict"\][\s\S]*\["proof", "Proof"\][\s\S]*\["checks", "Checks"\][\s\S]*\["prices", "Prices"\][\s\S]*\["sizes", "Sizes"\]/);
    assert.doesNotMatch(pane, /descriptions=|subjectFirst|Answer|Why it holds|Inputs tested/);
    assert.match(family, /<div className="coh-bar">\s*\{switcher\}\s*\{picker\}/);
    assert.doesNotMatch(css, /certificate-view|quant-view-switcher__description/);

    assert.match(picker, /aria-haspopup="listbox"[\s\S]*?aria-expanded=\{open\}/,
      "the family control lost its explicit dropdown state");
    assert.match(picker, /role="listbox"[\s\S]*?aria-activedescendant/);
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "Escape"]) {
      assert.match(picker, new RegExp(key), `${key} is missing from the family dropdown keyboard contract`);
    }
    assert.match(picker, /onPointerUp=\{\(\) => commit\(at\)\}/);
    assert.match(planeCss, /\.coh-family__control \{[\s\S]*?position: relative;[\s\S]*?min-width: 0;/);
    assert.match(planeCss, /\.coh-family__list \{[\s\S]*?position: absolute;[\s\S]*?width: min\(34rem, calc\(100vw[\s\S]*?max-height: min\([\s\S]*?overflow: auto;/,
      "the opened family list is not anchored and viewport-contained");
  });

  it("maps the seven proof operators without fabricating a measurement", () => {
    const map = read("components/coherence/ProofsMethodMap.tsx");
    for (const operator of [
      "LP feasibility",
      "Farkas dual",
      "Fréchet–Hoeffding",
      "L1 projection",
      "Brier score",
      "Murphy decomposition",
      "Guard graph",
    ]) assert.match(map, new RegExp(operator));
    assert.match(map, /activeSection/);
    assert.match(map, /onSection/);
    for (const field of ["question", "inputs", "formula", "explanation", "output", "handoff"]) {
      assert.match(map, new RegExp(`${field}:`), `method-map stages lost their ${field}`);
    }
    assert.match(map, /pᵢ = P\(Aᵢ\)/);
    assert.match(map, /L = max\(0, Σpᵢ − n \+ 1\); U = minᵢ pᵢ; L ≤ P\(∩Aᵢ\) ≤ U/);
    assert.match(map, /Inside means feasible—not fair value—and Πpᵢ remains only an independence reference/);
    assert.doesNotMatch(map, /useCoherenceRead|fetch\(/);
  });

  it("flows seven detailed stages down one numbered spine and wraps long formulae", () => {
    const map = read("components/coherence/ProofsMethodMap.tsx");
    const css = readProofsCss();
    const methodCss = readMethodMapCss();
    assert.match(map, /data-proof-operator-card=\{item\.section\}/);
    assert.match(map, /aria-label=\{`\$\{item\.operator\} formula: \$\{item\.formula\}`\}/);
    assert.match(map, /import \{ ArrowRight, ListTree \} from "lucide-react"/);
    assert.match(map, /<article className=\{styles\.card\} aria-current=\{active \? "step" : undefined\}>/);
    assert.match(map, /<h3>Inputs<\/h3>[\s\S]*<h3>Operation<\/h3>[\s\S]*<h3>Output and hand-off<\/h3>/);
    assert.match(map, /<SheetClose asChild>[\s\S]*onClick=\{\(\) => onSection\(item\.section\)\}[\s\S]*<ArrowRight aria-hidden="true" \/>/);
    assert.match(map, /Each row names its inputs, operation, output, and hand-off/);
    assert.match(map, /w-\[min\(96rem,calc\(100vw-1rem\)\)\] max-w-none/,
      "the seven-step map is still forced into the narrow default sheet");

    assert.match(methodCss, /\.rail\s*\{[^}]*display:\s*grid;[^}]*gap:\s*var\(--space-3\)/s);
    assert.match(methodCss, /\.stage\s*\{[^}]*grid-template-columns:\s*2\.75rem minmax\(0, 1fr\)/s);
    assert.match(methodCss, /\.stage:not\(:last-child\)::after\s*\{[^}]*inset-inline-start:[^}]*width:\s*2px/s,
      "the stages lost their aligned vertical hand-off spine");
    assert.match(methodCss, /\.details\s*\{[^}]*grid-template-columns:\s*minmax\(12rem, 0\.72fr\) minmax\(20rem, 1\.35fr\) minmax\(14rem, 0\.93fr\)/s);

    const formulaAt = methodCss.indexOf(".operation code {");
    const formulaRule = methodCss.slice(formulaAt, methodCss.indexOf("\n}", formulaAt) + 2);
    assert.ok(formulaAt > -1, "the formula rule is absent");
    assert.match(formulaRule, /overflow-wrap: anywhere;/);
    assert.match(formulaRule, /white-space: normal;/);
    assert.doesNotMatch(formulaRule, /overflow-[xy]:/,
      "each formula owns a nested scrollport instead of wrapping inside its card");

    assert.match(css, /\.proofs-method-sheet\[data-slot="sheet-content"\] \{[\s\S]*?overflow-y: auto;/,
      "the sheet is not the one vertical scroll owner");
    const bodyAt = css.indexOf(".proofs-plane .proofs-method-sheet__body {");
    const bodyRule = css.slice(bodyAt, css.indexOf("\n}", bodyAt) + 2);
    assert.doesNotMatch(bodyRule, /overflow-y:/,
      "the method-map body competes with the sheet as a nested vertical scroller");
    assert.match(methodCss, /@media \(max-width: 900px\)[\s\S]*?\.details\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      "the detailed stage columns do not stack before they become cramped");
    assert.match(css, /\.coh-decision-flow__rail \{[\s\S]*?display: flex;[\s\S]*?gap: 2\.25rem;/);
    assert.match(css, /\.coh-decision-flow__step \{[\s\S]*?position: relative;[\s\S]*?flex: 1 1 0;/,
      "the verdict flow cards do not own equal widths");
    assert.match(css, /\.coh-decision-flow__arrow \{[\s\S]*?inset-inline-start: 100%;[\s\S]*?width: 2\.25rem;/,
      "verdict arrows consume a card column instead of occupying the gaps");
    assert.match(css, /\.coh-proof-loom \{[\s\S]*?position: relative;[\s\S]*?overflow: hidden;/,
      "the interactive solver proof lost its bounded woven drawing surface");
    assert.match(css, /\.coh-proof-loom__thread\[data-active="true"\] \{[\s\S]*?stroke-dasharray: 3 9;/,
      "the selected evidence strand is no longer visibly inspectable");
    assert.match(css, /\.coh-proof-loom__stages button \{[\s\S]*?display: flex;[\s\S]*?cursor: pointer;/,
      "proof gates no longer expose keyboard-operable stage controls");
    assert.match(css, /\.coh-proof-path__inspector \{[\s\S]*?display: grid;[\s\S]*?border-inline-start: 3px solid var\(--series-1\);/,
      "the proof loom has no stable exact-value inspector");
    assert.match(css, /\.coh-proof-path__metrics \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/,
      "the selected stage's live measurements have no comparable reading grid");
    assert.match(css, /@media \(max-width: 900px\)[\s\S]*?\.coh-decision-flow__rail[\s\S]*?flex-direction: column;[\s\S]*?gap: 2rem;/,
      "the certificate decision flow lost its narrower vertical breakpoint");
    assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.coh-proof-path__metrics \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/,
      "the proof metrics do not reflow before their exact values become cramped");
  });
});

describe("Proofs transport is bounded and diagnosable", () => {
  it("prefers the response correlation header and retains the endpoint class", () => {
    const response = new Response(null, {
      status: 503,
      headers: {
        "X-AlphaEngine-Request-Id": "proof-request-1234",
        "X-AlphaEngine-Budget-Class": "H4",
      },
    });
    const meta = coherenceTransportMeta(response, {
      code: "gateway_unreachable",
      requestId: "body-request-ignored",
      endpointClass: "H3",
      hint: "Check the risk gateway listener.",
    }, "client-request-5678", 28_000);
    assert.deepEqual(meta, {
      requestId: "proof-request-1234",
      endpointClass: "H4",
      status: 503,
      code: "gateway_unreachable",
      hint: "Check the risk gateway listener.",
      deadlineMs: 28_000,
    });
  });

  it("reports the first effective deadline instead of the browser's wider guard", () => {
    const response = new Response(null, {
      status: 504,
      headers: {
        "X-AlphaEngine-Request-Id": "proof-request-9012",
        "X-AlphaEngine-Budget-Class": "H2",
        "X-AlphaEngine-Budget-Ms": "8000",
      },
    });
    const meta = coherenceTransportMeta(response, { code: "gateway_timeout" }, "client-request-9012", 9_000);
    assert.equal(meta.endpointClass, "H2");
    assert.equal(meta.deadlineMs, 8_000);
  });

  it("states the capped retry without promising an exact wall-clock second", () => {
    assert.equal(nextRetryReading(null, 0), null);
    assert.equal(nextRetryReading(new Date("2026-08-27T10:00:08Z"), 1, new Date("2026-08-27T10:00:00Z")), "Retry in about 8s");
    assert.equal(nextRetryReading(new Date("2026-08-27T10:01:00Z"), 4, new Date("2026-08-27T10:00:00Z")), "Circuit probe in at most 30s");
  });

  it("formats the endpoint budget and retry as one compact telemetry row", () => {
    const notice = read("components/coherence/ProofsTransportNotice.tsx");
    const css = readProofsCss();
    assert.match(notice, /className="proofs-transport__telemetry"/);
    assert.match(notice, /className="proofs-transport__status is-budget"/);
    assert.match(notice, /className="proofs-transport__status is-retry"/);
    assert.match(notice, /<dt>Budget<\/dt>[\s\S]*?<dd>\{transport\?\.endpointClass \?\? "browser"\} \/ \{deadline\}<\/dd>/);
    assert.match(notice, /<dt>Retry<\/dt>[\s\S]*?<dd>\{retry \?\? "manual"\}<\/dd>/);
    assert.match(css, /\.proofs-plane \.proofs-transport__telemetry \{[\s\S]*?display: flex;[\s\S]*?flex-wrap: nowrap;[\s\S]*?font-family: var\(--font-mono\);/);
    assert.match(css, /\.proofs-plane \.proofs-transport__status::before \{[\s\S]*?border-radius: 50%;/);
    assert.match(css, /\.proofs-plane \.proofs-transport__status\.is-budget::before \{[\s\S]*?background: var\(--status-good\);/);
    assert.match(css, /\.proofs-plane \.proofs-transport__status\.is-retry::before \{[\s\S]*?background: var\(--status-warning\);/);
  });

  it("shows one retry surface on live views and none on Lessons", () => {
    const console_ = read("components/CoherenceConsole.tsx");
    const notice = read("components/coherence/ProofsTransportNotice.tsx");
    const hook = read("lib/coherence/use-coherence.ts");
    assert.match(console_, /\{sectionVisible && status\.error && \(/);
    assert.match(console_, /<ProofsTransportNotice\b/);
    assert.match(notice, /from "@\/components\/ui\/alert"/);
    assert.match(notice, /from "@\/components\/ui\/button"/);
    assert.match(notice, /Correlation/);
    assert.match(notice, /Retry now/);
    assert.match(hook, /COHERENCE_REQUEST_ID_HEADER/);
    assert.match(hook, /onSchedule/);
    assert.match(console_, /const statusLive = active && !paused && !rearming;/);
    assert.match(console_, /const sectionLive = statusLive && section !== "lessons";/);
    assert.match(console_, /const sectionVisible = active && section !== "lessons";/);
  });
});

describe("the Proofs-only CSS is responsive and non-colour-exclusive", () => {
  const css = readProofsCss();

  it("stays scoped and gives dense diagrams a small-screen route", () => {
    assert.match(css, /\.proofs-plane/);
    assert.match(css, /@media \(max-width:/);
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /grid-template-columns/);
  });

  it("keeps keyboard affordances explicit and delegates motion to the one global contract", () => {
    const motion = read("app/globals/12-workspace-standardisation.css");
    assert.match(css, /:focus-visible/);
    assert.doesNotMatch(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(motion, /@media \(prefers-reduced-motion:\s*reduce\)/);
    assert.match(motion, /transition-duration:\s*1ms\s*!important/);
    assert.match(css, /\[data-state="unavailable"\]/);
    assert.match(css, /\[data-state="stale"\]/);
  });
});
