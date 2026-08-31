/**
 * Every addressable Markets and Proofs view publishes the technical contract
 * needed to read its lead figure: what the readout is, its unit, the estimator
 * or identity behind it, and the evidence source. The inventory is derived
 * from section-views, so adding a button without evidence is red immediately.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ENGINE_VIEW_EVIDENCE,
  evidenceFor,
  transportReading,
} from "../components/coherence/EngineViewEvidence";
import { VIEWS_BY_TAB, viewsFor } from "../lib/section-views";
import { read, stripNonCode } from "./helpers/workspace-sources";

const TABS = ["markets", "coherence"] as const;
const figure = read("../components/coherence/Figure.tsx");
const figureCode = stripNonCode(figure);
const figureDialog = read("../components/coherence/FigureDialogFrame.tsx");
const figureDialogCode = stripNonCode(figureDialog);
const dialog = read("../components/ui/dialog.tsx");
const chrome = read("../app/globals/14z-engine-evidence.css");

function canonicalKeys(tab: (typeof TABS)[number]): string[] {
  return Object.keys(VIEWS_BY_TAB[tab] ?? {})
    .flatMap((section) => viewsFor(tab, section).map(([view]) => `${section}/${view}`))
    .sort();
}

describe("the engine evidence contract covers the canonical view inventory", () => {
  for (const tab of TABS) {
    it(`${tab} has one evidence row per canonical view and no orphan rows`, () => {
      assert.deepEqual(Object.keys(ENGINE_VIEW_EVIDENCE[tab]).sort(), canonicalKeys(tab));
    });
  }

  it("covers all 26 Markets and all 29 Proofs views", () => {
    assert.equal(canonicalKeys("markets").length, 26);
    assert.equal(canonicalKeys("coherence").length, 29);
  });

  it("keeps every row compact, technical and fully populated", () => {
    for (const tab of TABS) {
      for (const key of canonicalKeys(tab)) {
        const evidence = evidenceFor(tab, ...key.split("/") as [string, string]);
        assert.ok(evidence, `${tab}/${key} has no evidence`);
        for (const field of ["readout", "unit", "method", "source"] as const) {
          const value = evidence[field].trim();
          assert.ok(value.length > 1, `${tab}/${key} has no ${field}`);
          assert.ok(value.length <= 72, `${tab}/${key} ${field} is prose rather than a compact technical label`);
        }
      }
    }
  });
});

describe("transport state is explicit and never overclaims the dataset", () => {
  it("keeps method and source in one on-demand evidence Sheet", () => {
    const source = read("../components/coherence/EngineViewEvidence.tsx");
    const sheetAt = source.indexOf("<SheetContent");
    assert.ok(sheetAt >= 0, "the evidence row still expands every technical field at rest");
    assert.doesNotMatch(source.slice(0, sheetAt), /<dt>Method<\/dt>|<dt>Source<\/dt>/,
      "method or source still consumes the primary analytical row");
    assert.match(source.slice(sheetAt), /<TableCell>Method<\/TableCell><TableCell>\{evidence\.method\}<\/TableCell>/);
    assert.match(source.slice(sheetAt), /<TableCell>Source<\/TableCell><TableCell>\{evidence\.source\}<\/TableCell>/);
    assert.match(source, /<SheetTrigger asChild>/);
  });

  it("distinguishes loading, unavailable, stale, degraded and current", () => {
    assert.deepEqual(transportReading(null, null), { state: "loading", mark: "◌", label: "Loading transport" });
    assert.deepEqual(transportReading(null, "timeout"), { state: "unavailable", mark: "✕", label: "Transport unavailable" });
    assert.deepEqual(transportReading({ state: "ok" }, "timeout"), { state: "stale", mark: "▲", label: "Last good response retained" });
    assert.deepEqual(transportReading({ state: "degraded" }, null), { state: "degraded", mark: "▲", label: "Transport degraded" });
    assert.deepEqual(transportReading({ state: "ok" }, null), { state: "current", mark: "●", label: "Transport current" });
  });

  it("is mounted by both consoles with live status, error and timestamp", () => {
    for (const file of ["MarketsConsole.tsx", "CoherenceConsole.tsx"]) {
      const source = read(`../components/${file}`);
      assert.match(source, /<EngineViewEvidence\b/);
      assert.match(source, /status=\{status\.data\}/);
      assert.match(source, /error=\{status\.error\}/);
      assert.match(source, /updatedAt=\{status\.updatedAt\}/);
    }
  });
});

describe("every engine figure has technical chrome and an inspection affordance", () => {
  it("segregates kind, caption, live readout and controls without changing caption content", () => {
    const figureSources = `${figure}\n${figureDialog}`;
    for (const className of [
      "coh-figure__caption-copy",
      "coh-figure__kind",
      "coh-figure__caption-title",
      "coh-figure__tools",
      "coh-figure__focus",
    ]) assert.match(figureSources, new RegExp(`className="${className}"`));
    assert.match(figureDialog, /<span className="coh-figure__caption-title">\{caption\}<\/span>/);
    assert.match(figure, /<FigureDialogFrame[\s\S]*?renderBody=\{renderFigureBody\}/);
  });

  it("uses one controlled, modal Radix portal with native dismissal and focus return", () => {
    assert.match(figureDialog, /<Dialog open=\{focused\} onOpenChange=\{setDialogOpen\} modal>/);
    assert.match(figureDialog, /<DialogTrigger asChild>[\s\S]*?aria-label=\{`Focus figure:/);
    assert.match(figureDialog, /<DialogContent[\s\S]*?className="coh-figure-dialog"[\s\S]*?showCloseButton=\{false\}/);
    assert.match(figureDialog, /onPointerDownOutside=\{[\s\S]*?viewportRef\.current\?\.contains\(target\)/,
      "the relocated chart is misclassified as a backdrop interaction");
    assert.match(figureDialog, /<DialogClose asChild>[\s\S]*?aria-label=\{CLOSE_FIGURE\}/);
    assert.match(figureDialog, /<DialogTitle asChild>/);
    assert.match(figureDialog, /<DialogDescription className="sr-only">\{ariaLabel\}<\/DialogDescription>/);
    assert.doesNotMatch(figureDialogCode, /document\.addEventListener|onBlur=|aria-pressed=/,
      "Figure is competing with the dialog's Escape, focus trap or trigger semantics");
    assert.doesNotMatch(figureDialog, /coh-figure__backdrop|is-focused/,
      "the inline fixed-descendant modal survived beside the portal");

    assert.match(dialog, /DialogPrimitive\.Portal/);
    assert.match(dialog, /DialogPrimitive\.Overlay/);
    assert.match(dialog, /z-\[var\(--z-overlay\)\]/);
    assert.match(dialog, /<XIcon \/>[\s\S]*?<span className="sr-only">Close<\/span>/,
      "the dialog has no explicit, named X close control");
  });

  it("mounts one chart subtree at a time and keeps its inline footprint and IDs stable", () => {
    assert.match(figureDialogCode, /const inlineFigureRef = useRef<HTMLElement>\(null\)/);
    assert.match(figureDialogCode, /getBoundingClientRect\(\)\.height/);
    assert.match(figureDialog, /style=\{focused && inlineBlockSize \? \{ blockSize: inlineBlockSize \} : undefined\}/);
    assert.match(figureDialog, /const inlinePlotId = `figure-plot-inline-\$\{figureId\}`/);
    assert.match(figureDialog, /const dialogPlotId = `figure-plot-dialog-\$\{figureId\}`/);
    assert.match(figureDialog, /const plotId = inlinePlotId/,
      "the moved chart changes identity when it enters the dialog");
    assert.match(figureDialog, /data-relocation-host=\{dialogPlotId\}/);
    assert.equal(figureDialogCode.match(/renderBody\(plotId\)/g)?.length, 1,
      "Focus mounts a second plot instead of preserving the active chart state");
    assert.match(figureDialogCode, /target\.appendChild\(viewport\)/,
      "the single mounted plot is not relocated into the dialog host");
    assert.match(figure, /id=\{plotId\}[\s\S]*?role="group"/);
  });

  it("keeps inline chrome scoped while the portaled inspector owns bounded geometry", () => {
    assert.match(chrome, /:is\(\.markets-plane, \.proofs-plane\) \.coh-figure/);
    assert.match(chrome, /\[data-slot="dialog-content"\]\.coh-figure-dialog[\s\S]*?max-height:\s*calc\(100dvh/);
    assert.match(chrome, /\.coh-figure-dialog__body[\s\S]*?overflow:\s*auto/);
    assert.match(chrome, /\.coh-figure-dialog__body \.coh-figure__plot[\s\S]*?min-height:\s*0/);
    assert.doesNotMatch(chrome, /min\(70dvh|min\(62dvh/);
    assert.match(chrome, /\.coh-figure\.is-dialog-open[\s\S]*?overflow:\s*hidden/);
    assert.doesNotMatch(chrome, /coh-figure__backdrop|\.coh-figure\.is-focused|100vmax/);
    assert.match(chrome, /@media \(max-width: 700px\)/);
    assert.doesNotMatch(chrome, /\.diffusion-plane/);
  });

  it("supports map-style pointer panning without swallowing chart selection", () => {
    assert.match(figureDialogCode, /setPointerCapture\(event\.pointerId\)/);
    assert.match(figureDialogCode, /scrollLeft = origin\.scrollLeft - deltaX/);
    assert.match(figureDialogCode, /scrollTop = origin\.scrollTop - deltaY/);
    assert.match(figureDialogCode, /startsOnControl\(event\.target\)/);
    assert.match(figureDialogCode, /onClickCapture=\{suppressClickAfterPan\}/);
    assert.match(chrome, /\.coh-figure-dialog__body\[data-pannable="true"\][\s\S]*?cursor:\s*grab/);
    assert.match(chrome, /\.coh-figure-dialog__body\[data-panning="true"\][\s\S]*?cursor:\s*grabbing/);
    assert.doesNotMatch(chrome, /\.coh-figure-dialog__tools \.coh-figure__readout\s*\{[^}]*text-overflow:\s*ellipsis/s);
  });
});
