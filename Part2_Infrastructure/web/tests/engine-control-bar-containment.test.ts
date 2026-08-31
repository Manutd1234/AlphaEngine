import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const evidence = read("../components/coherence/EngineViewEvidence.tsx");
const sharedCss = read("../app/globals/14z-engine-evidence.css");
const marketsCss = read("../app/globals/14zza-markets-quant-workbench.css");
const proofsCss = [
  read("../app/globals/14zzb-proofs-workbench.css"),
  read("../app/globals/14zzbc-proofs-certificate-flow.css"),
  read("../app/globals/14zzbd-proofs-responsive.css"),
].join("\n");
const lessonsCss = read("../app/globals/14zzba-proofs-lessons.css");
const switcher = read("../components/workspace/QuantViewSwitcher.tsx");

describe("Markets and Proofs evidence tools remain discoverable", () => {
  it("gives the contextual action a shrinkable owner beside the persistent Evidence action", () => {
    assert.match(evidence, /className="coh-evidence__context-action"[\s\S]*?\{contextAction\}/);
    assert.match(evidence, /className="coh-evidence__open"[\s\S]*?>\s*Evidence\s*</);
    assert.match(
      sharedCss,
      /\.coh-evidence__tools\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content;[\s\S]*?width:\s*100%;/,
    );
    assert.match(
      sharedCss,
      /\.coh-evidence__context-action\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;/,
    );
  });

  it("stacks both complete action groups before either can be clipped on a phone", () => {
    assert.match(
      sharedCss,
      /@media \(max-width:\s*380px\)[\s\S]*?\.coh-evidence__tools\s*\{[\s\S]*?grid-template-columns:\s*1fr;/,
    );
    assert.match(sharedCss, /\.coh-evidence__open\s*\{[\s\S]*?width:\s*100%;/);
    assert.doesNotMatch(
      stripNonCode(sharedCss),
      /\.coh-evidence__tools\s*\{[^}]*overflow:\s*(?:hidden|clip)/,
    );
  });

  it("keeps every Markets route action and the complete Proofs method map", () => {
    const markets = read("../components/coherence/MarketsViewBar.tsx");
    const methods = read("../components/coherence/ProofsMethodMap.tsx");
    assert.match(markets, /Reset to the section's default view/);
    assert.match(markets, /Copy deep link/);
    assert.doesNotMatch(markets, /<Sheet\b|>\s*View contract\s*</,
      "Markets route actions duplicate the complete Evidence Sheet");
    for (const field of ["Decision question", "Lead surface", "Exact values", "Interpretation", "Deep link"]) {
      assert.ok(evidence.includes(field), `Evidence lost the Markets ${field} contract field`);
    }
    assert.match(methods, /PROOFS_OPERATORS\.map/);
    assert.match(methods, />\s*Method map\s*/);
  });
});

describe("Markets and Proofs view controls disclose every option", () => {
  it("wraps the shared roving-focus control into bounded tracks instead of a hidden scroller", () => {
    assert.match(switcher, /data-option-count=\{options\.length\}/);
    assert.match(
      sharedCss,
      /\.quant-view-switcher\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*[^)]+\),\s*1fr\)\);[\s\S]*?overflow:\s*visible;/,
    );
    assert.match(
      sharedCss,
      /\.quant-view-switcher \[data-slot="toggle-group-item"\]\s*\{[\s\S]*?min-inline-size:\s*0;[\s\S]*?white-space:\s*normal;/,
    );
    assert.doesNotMatch(
      stripNonCode(sharedCss),
      /\.quant-view-switcher\s*\{[^}]*overflow-x:\s*auto/,
    );
  });

  it("does not reintroduce horizontal hiding in either plane's later cascade layers", () => {
    assert.match(marketsCss, /\[data-market-section\] \.quant-view-switcher\s*\{[\s\S]*?overflow:\s*visible;/);
    assert.match(proofsCss, /\.proofs-view-control\[data-slot="toggle-group"\][\s\S]*?min-width:\s*0;/);
    assert.match(proofsCss, /\.coh-bar\s*\{[\s\S]*?overflow-x:\s*visible;/);
    assert.match(lessonsCss, /\.coh-lessons \.quant-view-switcher\s*\{[\s\S]*?overflow:\s*visible;/);

    for (const css of [marketsCss, proofsCss, lessonsCss]) {
      assert.doesNotMatch(
        stripNonCode(css),
        /quant-view-switcher[^{}]*\{[^}]*overflow-x:\s*auto/,
      );
    }
  });
});
