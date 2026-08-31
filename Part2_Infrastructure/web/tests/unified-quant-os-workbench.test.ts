/**
 * Seventh-round workbench contracts.
 *
 * These are source-shape tests on purpose. The defects they pin are ownership
 * defects: a permanent method rail, every lesson expanded at once, a shared
 * `.seg` selector controlling domain navigation, and more than one layer
 * claiming the same figure boundary. Browser geometry covers the rendered
 * result; this suite makes the responsible component impossible to forget.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { stripNonCode } from "./helpers/workspace-sources";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => readFileSync(join(root, relative), "utf8");
const readProofsCss = () => [
  read("app/globals/14zzb-proofs-workbench.css"),
  read("app/globals/14zzbc-proofs-certificate-flow.css"),
  read("app/globals/14zzbd-proofs-responsive.css"),
].join("\n");

describe("Proofs keeps its complete operator sequence on demand", () => {
  const source = read("components/coherence/ProofsMethodMap.tsx");
  const consoleSource = read("components/CoherenceConsole.tsx");
  const evidenceSource = read("components/coherence/EngineViewEvidence.tsx");
  const sharedCss = read("app/globals/14z-engine-evidence.css");
  const proofsCss = readProofsCss();

  it("keeps only a compact method-map trigger at rest", () => {
    assert.match(source, /from "@\/components\/ui\/sheet"/);
    assert.match(source, /<SheetTrigger\b/);
    assert.match(source, /<SheetContent\b/);
    assert.match(source, /proofs-method-trigger/);
    assert.doesNotMatch(source, /activeOperator/);

    const returned = source.slice(source.indexOf("return ("), source.indexOf("<SheetContent"));
    assert.doesNotMatch(returned, /<code>|proofs-method-map__index|proofs-method-context__copy/);

    const sheet = source.indexOf("<SheetContent");
    const rail = source.indexOf("className={styles.rail}");
    assert.ok(sheet >= 0 && rail > sheet, "the full numbered rail escaped the on-demand Sheet");
  });

  it("integrates the trigger with the evidence band that already names method and source", () => {
    assert.match(evidenceSource, /contextAction\?: ReactNode/);
    assert.match(evidenceSource, /className="coh-evidence__tools"/);
    const detailsAt = evidenceSource.indexOf("<SheetContent");
    assert.ok(detailsAt >= 0, "technical provenance has no progressive disclosure");
    assert.match(evidenceSource.slice(detailsAt), /<TableCell>Method<\/TableCell><TableCell>\{evidence\.method\}<\/TableCell>/);
    assert.match(evidenceSource.slice(detailsAt), /<TableCell>Source<\/TableCell><TableCell>\{evidence\.source\}<\/TableCell>/);
    assert.match(
      consoleSource,
      /<EngineViewEvidence[\s\S]*contextAction=\{\s*<ProofsMethodMap[\s\S]*\/\>\s*\}/,
    );
    assert.doesNotMatch(
      consoleSource,
      /<WorkspaceSubtabs[\s\S]*\/\>\s*<ProofsMethodMap\b/,
      "the method trigger must not remain a standalone full-width row",
    );
  });

  it("auto-fits the evidence facts and contains both visible actions", () => {
    assert.match(
      sharedCss,
      /\.coh-evidence__grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*[^)]+\),\s*1fr\)\)/,
    );
    assert.match(
      sharedCss,
      /\.coh-evidence__tools\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/,
    );
    assert.match(
      proofsCss,
      /\.proofs-method-trigger\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*0;/,
    );
    assert.doesNotMatch(
      stripNonCode(sharedCss),
      /\.coh-evidence__tools\s*\{[^}]*(?:overflow:\s*(?:hidden|clip)|overflow-x:\s*auto)/,
    );
  });

  it("does not render the historical full-width map as the outer component", () => {
    assert.doesNotMatch(source, /return \(\s*<nav className="proofs-method-map"/);
  });
});

describe("Lessons is a compact index with one detail surface", () => {
  const source = read("components/coherence/LessonsPane.tsx");

  it("renders compact lesson entries and one controlled Sheet", () => {
    assert.match(source, /useState/);
    assert.match(source, /coh-lesson-index-card/);
    assert.match(source, /selectedLesson/);
    assert.match(source, /<Sheet\b/);
    assert.match(source, /<SheetContent\b/);
    assert.match(source, /<LessonDetail\b/);
    assert.equal((source.match(/<SheetContent\b/g) ?? []).length, 1);
  });

  it("keeps full figures and guard paths in the detail component", () => {
    const detail = source.indexOf("function LessonDetail");
    const compact = source.indexOf("function LessonIndexCard");
    assert.ok(detail >= 0 && compact > detail);
    const detailSource = source.slice(detail, compact);
    assert.match(detailSource, /<LessonFigure\b/);
    assert.match(detailSource, /lesson\.whenItHolds/);
    assert.match(detailSource, /lesson\.whenItFails/);
    assert.match(detailSource, /lesson\.guards/);
    assert.match(detailSource, /lesson\.pinnedBy/);
  });
});

describe("analytical view controls own content-safe geometry", () => {
  const frame = read("components/coherence/SectionFrame.tsx");
  const proofs = read("components/coherence/ProofsViewControl.tsx");
  const switcher = read("components/workspace/QuantViewSwitcher.tsx");
  const css = read("app/globals/14z-engine-evidence.css");

  it("routes Markets and Proofs through one domain switcher", () => {
    assert.match(frame, /QuantViewSwitcher/);
    assert.doesNotMatch(frame, /from "@\/components\/ui\/toggle-group"/);
    assert.match(proofs, /QuantViewSwitcher/);
    assert.match(switcher, /from "@\/components\/ui\/toggle-group"/);
    assert.match(switcher, /data-quant-view-switcher/);
  });

  it("auto-fits every choice into visible wrapping tracks", () => {
    assert.match(css, /\.quant-view-switcher/);
    assert.match(
      css,
      /\.quant-view-switcher\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*[^)]+\),\s*1fr\)\);[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*visible;/,
    );
    assert.match(
      css,
      /\.quant-view-switcher \[data-slot="toggle-group-item"\]\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-inline-size:\s*0;[\s\S]*?white-space:\s*normal;[\s\S]*?overflow-wrap:\s*anywhere;/,
    );
    assert.doesNotMatch(
      stripNonCode(css),
      /\.quant-view-switcher\s*\{[^}]*(?:overflow-x:\s*auto|min-inline-size:\s*max-content)/,
    );
  });

  it("retains Radix single-select keyboard and accessible-name semantics", () => {
    assert.match(switcher, /<ToggleGroup[\s\S]*?type="single"/);
    assert.match(switcher, /value=\{value\}/);
    assert.match(switcher, /onValueChange=\{\(next\) =>/);
    assert.match(switcher, /aria-label=\{label\}/);
    assert.match(
      switcher,
      /<ToggleGroupItem key=\{name\} value=\{name\} aria-label=\{optionLabel\(text\)\}>/,
    );
  });
});

describe("a technical figure has one isolated exterior boundary", () => {
  const figure = read("components/coherence/Figure.tsx");
  const frame = read("components/coherence/FigureDialogFrame.tsx");
  const sharedCss = read("app/globals/14z-engine-evidence.css");
  const proofsCss = readProofsCss();

  it("publishes a named surface and contains its local effects", () => {
    assert.match(figure, /<FigureDialogFrame/);
    assert.match(frame, /data-quant-surface="figure"/);
    assert.match(sharedCss, /isolation:\s*isolate/);
    assert.match(sharedCss, /overflow:\s*hidden/);
  });

  it("keeps the caption separator in the shared owner", () => {
    assert.match(sharedCss, /\.coh-figure__caption[\s\S]*border-bottom:/);
    assert.doesNotMatch(proofsCss, /\.proofs-plane \.coh-figure__caption\s*\{/);
  });
});

describe("Proofs entry motion stays inside its subtab owner", () => {
  const proofsCss = readProofsCss();

  it("keeps the reveal but removes translation from the two analytical card families", () => {
    const surface = proofsCss.match(
      /\.proofs-plane \.workspace-subtab-panel > :is\(\.coh-certificate, \.coh-calib\)\s*\{([\s\S]*?)\}/,
    );
    assert.ok(surface, "Proofs cards still inherit the translating workspace reveal");
    assert.match(surface[1], /animation-name:\s*proofs-surface-fade-in/);
    assert.doesNotMatch(surface[1], /transform|translate/);
    assert.match(
      proofsCss,
      /@keyframes proofs-surface-fade-in\s*\{\s*from\s*\{\s*opacity:\s*0;\s*\}\s*to\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
  });
});
