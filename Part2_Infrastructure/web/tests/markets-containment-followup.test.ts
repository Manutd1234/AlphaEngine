import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const read = (path: string) => readFileSync(join(import.meta.dirname, "..", path), "utf8");

describe("Markets stake and fees own their narrow control containment", () => {
  const containment = read("components/coherence/MarketsSectionContainment.tsx");
  const css = read("components/coherence/MarketsSectionContainment.module.css");
  const surfaceCss = read("app/globals/10d-coherence-surface.css");
  const replay = read("components/coherence/AblationPane.tsx");
  const replayCss = read("components/coherence/FeeReplayInstrument.module.css");

  it("scopes the fix to the two affected Markets sections", () => {
    assert.match(containment, /variant: "stake" \| "fees"/);
    assert.match(read("components/coherence/StakePane.tsx"), /MarketsSectionContainment variant="stake"/);
    assert.match(read("components/coherence/FeesSection.tsx"), /MarketsSectionContainment variant="fees"/);
  });

  it("turns four choices into a two-column phone control instead of clipping them", () => {
    assert.match(css, /@media \(max-width: 520px\)/);
    assert.match(css, /grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /:global\(\.quant-view-switcher\)[\s\S]*inline-size:\s*100%/);
    assert.match(css, /:global\(\.quant-view-switcher \[data-slot="toggle-group-item"\]\)[\s\S]*min-inline-size:\s*0/);
  });

  it("contains the subject and analytical body without hiding data", () => {
    assert.match(css, /:global\(\.coh-section__subject\)[\s\S]*min-inline-size:\s*0/);
    assert.match(css, /:global\(\.coh-section__body\)[\s\S]*min-inline-size:\s*0/);
    assert.doesNotMatch(css, /display:\s*none/);
    assert.match(css, /animation:\s*none/);
    assert.match(surfaceCss, /\.coh-kelly\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s,
      "the Stake grid track must shrink before its folded exact table becomes the local scroll owner");
  });

  it("wraps the Fees replay status values inside their phone-width owner", () => {
    assert.match(replay, /coh-status__chips \$\{styles\.replayStatus\}/);
    assert.match(
      replayCss,
      /\.replayStatus > :global\(\.coh-chip\)\s*\{[^}]*min-inline-size:\s*0;[^}]*max-inline-size:\s*100%;/s,
    );
    assert.match(
      replayCss,
      /@media \(max-width: 720px\)[\s\S]*?\.replayStatus > :global\(\.coh-chip\)\s*\{[^}]*grid-template-columns:\s*auto auto minmax\(0, 1fr\);[^}]*inline-size:\s*100%;/s,
    );
    const valueRule = replayCss.match(/\.replayStatus :global\(\.coh-chip__value\)\s*\{([^}]*)\}/)?.[1] ?? "";
    assert.match(valueRule, /overflow-wrap:\s*anywhere/);
    assert.match(valueRule, /white-space:\s*normal/);
    assert.doesNotMatch(valueRule, /(?:^|;)\s*overflow:\s*(?:hidden|clip)/,
      "the phone fix must wrap the full replay verdict rather than conceal it");
  });

  it("keeps both live model readouts phrasing-only", () => {
    const readouts = [...replay.matchAll(/<output className=\{styles\.modelReadout\}[\s\S]*?<\/output>/g)];
    assert.equal(readouts.length, 2);
    for (const [readout] of readouts) assert.doesNotMatch(readout, /<p\b/);
    assert.equal((replay.match(/className=\{styles\.modelDescription\}/g) ?? []).length, 2);
  });
});

describe("Markets shell Map owns its wide command table", () => {
  const shell = read("components/coherence/ShellCommandReference.tsx");
  const css = read("components/coherence/ShellCommandReference.module.css");
  const pane = read("components/coherence/ShellPane.tsx");
  const paneCss = read("components/coherence/ShellPane.module.css");

  it("exposes one named, keyboard-focusable local horizontal scrollport", () => {
    assert.match(shell, /className=\{styles\.scrollport\}/);
    assert.match(shell, /role="region"/);
    assert.match(shell, /aria-label="Shell command and derived-reading reference"/);
    assert.match(shell, /tabIndex=\{0\}/);
    assert.match(css, /overflow-x:\s*auto/);
    assert.match(css, /max-inline-size:\s*100%/);
  });

  it("keeps the complete command table inside that owner", () => {
    const owner = shell.indexOf("styles.scrollport");
    const table = shell.indexOf('<table className="coh-table">');
    assert.ok(owner >= 0 && table > owner);
    for (const field of ["Name", "What it reads", "When it has no answer"]) assert.match(shell, new RegExp(field));
  });

  it("opts the Map surface out of geometry-changing entrance transforms", () => {
    assert.match(pane, /className=\{styles\.mapContainment\}/);
    assert.match(paneCss, /animation:\s*none/);
    assert.match(paneCss, /min-inline-size:\s*0/);
  });
});

describe("Markets section entry motion stays inside its layout owner", () => {
  const css = read("app/globals/14zza-markets-quant-workbench.css");

  it("does not let a frozen view timeline translate or erase a full-height section", () => {
    assert.match(
      css,
      /\.markets-plane \.workspace-subtab-panel > \.coh-section\s*\{[\s\S]*?animation:\s*none/,
    );
    assert.doesNotMatch(css, /markets-surface-fade-in|\.markets-plane[^{}]*opacity:\s*0/);
  });
});
