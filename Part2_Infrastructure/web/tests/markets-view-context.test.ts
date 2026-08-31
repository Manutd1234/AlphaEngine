import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) => readFileSync(
  fileURLToPath(new URL(relative, import.meta.url)),
  "utf8",
);

const source = read("../components/coherence/MarketsViewBar.tsx");
const evidenceSource = read("../components/coherence/EngineViewEvidence.tsx");
const css = read("../app/globals/14zza-markets-quant-workbench.css");

describe("the Markets route context uses progressive disclosure", () => {
  it("does not repeat the active section and view at rest", () => {
    const triggerAt = evidenceSource.indexOf("<SheetTrigger");
    const contentAt = evidenceSource.indexOf("<SheetContent");
    assert.ok(triggerAt >= 0 && contentAt > triggerAt);
    assert.ok(evidenceSource.indexOf("marketContract.ordinal") > contentAt,
      "the route ordinal must be explained in the contract Sheet, not shown as progress at rest");
    assert.doesNotMatch(source, /contract\.(?:sectionLabel|viewLabel|ordinal)/);
    assert.doesNotMatch(evidenceSource.slice(0, contentAt), /<Badge|markets-viewbar__route-label/);
    assert.doesNotMatch(`${source}\n${evidenceSource}`, /<details/);
  });

  it("retains every technical field and labels the ordinal as route position", () => {
    for (const primitive of [
      "Sheet", "SheetContent", "SheetDescription", "SheetHeader", "SheetTitle", "SheetTrigger",
    ]) {
      assert.match(evidenceSource, new RegExp(`\\b${primitive}\\b`));
    }
    for (const field of [
      "Decision question", "Lead surface", "Exact values", "Interpretation", "Deep link",
    ]) {
      assert.ok(evidenceSource.lastIndexOf(field) > evidenceSource.indexOf("<SheetContent"), `${field} escaped the Sheet`);
    }
    assert.match(evidenceSource, /<TableCell>Route position<\/TableCell>/);
    assert.match(evidenceSource, /\{marketContract\.ordinal\}\s+of\s+\{marketContract\.total\}/);
  });

  it("names the evidence with its technical readout rather than a raw route separator", () => {
    assert.match(evidenceSource, /<SheetTitle>\{evidence\.readout\}<\/SheetTitle>/);
    assert.doesNotMatch(evidenceSource, /\{marketContract\.sectionLabel\}\s*·\s*\{marketContract\.viewLabel\}/);
  });

  it("keeps clipboard feedback inside a non-clipping command surface", () => {
    assert.doesNotMatch(css, /\.markets-plane \.markets-viewbar\s*\{[^}]*overflow:\s*clip/s);
    assert.doesNotMatch(css, /\.markets-viewbar__copy-state\s*\{[^}]*(?:inline-size|width):\s*100%/s);
    assert.match(source, /role="status"/);
    assert.match(source, /aria-live="polite"/);
  });

  it("invalidates clipboard feedback from route identity without an effect reset", () => {
    assert.doesNotMatch(source, /useEffect/);
    assert.match(source, /copyResult\?\.deepLink === contract\.deepLink/);
    assert.match(source, /setCopyResult\(\{ deepLink: contract\.deepLink, state: "copied" \}\)/);
  });
});
