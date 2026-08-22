/**
 * Nothing on the Risk tab's Monte Carlo card is stretched, and nothing is clipped.
 *
 * Two defects, reported together: "reduce the size of the 10d 30d 90d dont need
 * occupy the entire row and also the seed thing is being covered by the border,
 * can we shift the paths onwards to the left to give more space for the seed."
 *
 * They are opposite failures of the same discipline — a box whose size was
 * asserted rather than derived from what goes in it. The horizon seg was told
 * to fill a `1fr` track, so four two-glyph labels claimed a desk-width panel.
 * The seed input was told `width: 12ch` under a universal `box-sizing:
 * border-box`, so its ten-digit placeholder was handed 12ch MINUS the box's own
 * padding and border and the last digit fell outside the border.
 *
 * WHY THE SEED ARITHMETIC IS PROVED AND NOT MEASURED
 * ------------------------------------------------------------------------
 * A test that multiplies out a font advance is a test that believes a font
 * metric it cannot see. This proves the fit without one: the width is
 * `calc(<n>ch + <allowance>px)`, so the box holds at least <n> characters at
 * ANY font size provided <allowance> covers the chrome on its own. Two integer
 * comparisons — n >= the seed's digits, allowance >= the widest chrome — settle
 * every text-size preset and both pointer regimes at once, which is a stronger
 * statement than any single measurement could be. The preset sweep below is
 * belt and braces: it walks the real `--type-step` values so a failure prints
 * pixels a human can check against a screenshot.
 *
 * The chrome figures are READ from the rules that paint them rather than typed
 * here, so widening the pill's padding without widening the allowance fails
 * this suite instead of quietly re-clipping the seed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { readSource } from "./helpers/source-files";

const css = globalsCss;
/** Selector text and declarations only: the prose names what it rejected. */
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
const density = readSource("app/globals/14e-density-risk.css").replace(/\/\*[\s\S]*?\*\//g, "");
const rail = readSource("components/risk/McParameterRail.tsx");

/** Every rule block whose selector mentions the horizon row. */
const horizonRules = [...rules.matchAll(/([^{}]*\.risk-horizon[^{}]*)\{([^}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }));

function token(name: string): number {
  const found = rules.match(new RegExp(`--${name}:\\s*(-?[\\d.]+)px`));
  assert.ok(found, `--${name} is not declared in px anywhere in the stylesheet`);
  return Number(found[1]);
}

describe("the forward-horizon seg is sized by its labels, not by the row", () => {
  it("no rule stretches the seg across the row", () => {
    // The exact shape of the retired fix, and every near neighbour of it. A
    // stretch reintroduced from ANY partial fails here, not only from 14e:
    // `globalsCss` is the whole concatenated sheet.
    for (const { selector, body } of horizonRules) {
      assert.doesNotMatch(body, /(^|;|\s)width:\s*100%/,
        `"${selector}" stretches the horizon control across the row`);
      assert.doesNotMatch(body, /(^|;|\s)(flex|flex-grow):\s*[1-9]/,
        `"${selector}" lets the horizon control grow into the row's spare width`);
      assert.doesNotMatch(body, /grid-template-columns:[^;]*\dfr/,
        `"${selector}" gives the horizon control a fractional track to fill`);
    }
  });

  it("each segment carries the fingertip target in its own width", () => {
    const floor = density.match(/\.risk-horizon > \.seg button \{[^}]*min-width:\s*(\d+)px/);
    assert.ok(floor, "the horizon segments have no min-width floor — unfloored they are ~37px wide");
    assert.equal(Number(floor[1]), 44,
      "44px is the target size 12's convergence note and 15's coarse block both name");
  });

  it("the floor is not smaller than the height the same control already gets", () => {
    // 15 gives `.seg button` 40px of height inside the seg's 3px frame and 1px
    // border, reaching 48. The frame is drawn once around the GROUP, so width
    // gets no such help and the segment must carry the full target itself —
    // which is why the two numbers differ and both have to be checked.
    const coarse = rules.match(/@media \(pointer: coarse\)[\s\S]*?\.seg button \{[^}]*min-height:\s*(\d+)px/);
    assert.ok(coarse, "15's coarse-pointer height floor for .seg button has moved");
    const segPadding = Number(/\.seg \{[^}]*padding:\s*(\d+)px/.exec(rules)?.[1]);
    assert.ok(Number.isFinite(segPadding), ".seg's own frame padding has moved");
    const height = Number(coarse[1]) + segPadding * 2 + 2;
    assert.ok(height >= 44, `the seg stands ${height}px at a coarse pointer, under the 44px target`);
  });

  it("the shared seg's own metrics are still not forked here", () => {
    // min-width is the one metric neither 00, 12 nor 15 declares on the seg,
    // which is why the floor is expressed in that axis. If one of them starts
    // declaring it, this partial is forking a shared control and must stop.
    for (const file of ["app/globals/00-tokens-and-base.css", "app/globals/12-workspace-standardisation.css"]) {
      const owner = readSource(file).replace(/\/\*[\s\S]*?\*\//g, "");
      assert.doesNotMatch(owner, /\.seg button \{[^}]*min-width:/,
        `${file} now owns min-width on .seg button — 14e's floor forks it`);
    }
  });
});

describe("the parameter rail cannot be squeezed through the card's border", () => {
  const railRule = /\.mc-parameter-rail \{([^}]*)\}/.exec(density);

  it("the rail is not told it may shrink below its own content", () => {
    assert.ok(railRule, ".mc-parameter-rail has no layout rule at all");
    assert.doesNotMatch(railRule[1], /min-width:\s*0/,
      "min-width: 0 is what let the rail's last pill paint across the card edge");
    assert.match(railRule[1], /min-width:\s*min-content/,
      "the rail wraps internally, so its honest floor is its widest pill");
  });

  it("the rail still wraps as one group rather than five loose children", () => {
    // McParameterRail's own comment records why the five controls share a
    // wrapper: as siblings of a `space-between` heading they were strung out
    // across it. The floor above must not be bought by undoing that.
    assert.match(railRule![1], /flex-wrap:\s*wrap/);
    assert.match(rail, /<div className="mc-parameter-rail">/);
    assert.equal((rail.match(/className="rail-toggle"/g) ?? []).length, 5,
      "all five parameter controls belong to the one rail");
  });

  it("the heading gives the rail a line of its own instead of overflowing", () => {
    assert.match(density, /\.portfolio-card-heading:has\(> \.mc-parameter-rail\) \{[^}]*flex-wrap:\s*wrap/,
      "with a real floor the rail needs somewhere to go when the card is narrow");
  });

  it("the wrap is scoped to the one heading that carries a rail", () => {
    // `.portfolio-card-heading` is 01-workspace-shell.css's and renders on all
    // eight tabs, most pairing a title with a single short control.
    for (const { 0: block, index } of density.matchAll(/[^{}]*\{[^}]*\}/g)) {
      if (!/\.portfolio-card-heading/.test(block)) continue;
      if (/:has\(/.test(block.slice(0, block.indexOf("{")))) continue;
      assert.doesNotMatch(block, /flex-wrap:/,
        `an unscoped .portfolio-card-heading wrap at offset ${index} reaches every tab`);
    }
  });

  it("nothing is hidden to make the overflow go away", () => {
    assert.doesNotMatch(railRule![1], /overflow:\s*(hidden|clip)/,
      "clipping a control trades a visible defect for one the reader cannot see");
  });
});

describe("the seed box holds the whole seed at every text size", () => {
  /** The premise the whole arithmetic rests on. */
  const borderBox = /\*\s*\{[^}]*box-sizing:\s*border-box/.test(rules);

  /** `width: "calc(<n>ch + <allowance>px)"` on the seed input. */
  const width = /style=\{\{ width: "calc\((\d+)ch \+ (\d+)px\)" \}\}/.exec(rail);

  /** 0xffffffff is 4294967295 — ten digits, and the placeholder shows it. */
  const seedDigits = String(0xffff_ffff).length;

  it("a width is still a border box, which is why an allowance is needed", () => {
    assert.ok(borderBox, "if * is no longer border-box the seed's px allowance is now surplus, not a fix");
  });

  it("the ch half holds every digit a uint32 seed can have", () => {
    assert.ok(width, "the seed input's width is no longer a calc of ch plus a px allowance");
    assert.equal(seedDigits, 10);
    assert.ok(Number(width[1]) > seedDigits,
      `${width[1]}ch leaves no slack over a ${seedDigits}-digit seed`);
  });

  it("the px half covers the box's chrome on its own, at either pointer", () => {
    // Fine pointer: 14e shrinks the rail's controls to the space ladder.
    // Coarse: 00's own padding stands, and 15 raises the height to 44.
    const fine = /@media \(pointer: fine\)[\s\S]*?\.mc-parameter-rail select,[\s\S]*?padding:\s*var\(--space-1\) var\(--space-2\)/.test(rules);
    assert.ok(fine, "14e's fine-pointer padding for the rail's controls has moved");
    const coarsePadding = /input:not\(\[type="range"\]\)[\s\S]{0,200}?padding:\s*\d+px (\d+)px/.exec(rules);
    assert.ok(coarsePadding, "00's base input padding has moved");

    const border = 2;
    const chromes = {
      fine: token("space-2") * 2 + border,
      coarse: Number(coarsePadding[1]) * 2 + border,
    };
    for (const [pointer, chrome] of Object.entries(chromes)) {
      assert.ok(Number(width![2]) >= chrome,
        `the seed's ${width![2]}px allowance is under the ${chrome}px of padding and border `
        + `it must cover at a ${pointer} pointer — the ch half would pay the difference `
        + "and the last digit would fall outside the border again");
    }
  });

  it("ten digits fit at compact, comfortable and large", () => {
    // Belt and braces over the two integer comparisons above, walking the real
    // ladder so a failure prints pixels. JetBrains Mono's advance is 0.6em
    // (app/layout.tsx); a wider fallback only makes both halves of the
    // comparison grow, so this is the tight case.
    const steps: Record<string, number> = { comfortable: 1 };
    for (const [, preset, step] of rules.matchAll(/:root\[data-text-size="(\w+)"\] \{[^}]*--type-step:\s*([\d.]+)/g)) {
      steps[preset] = Number(step);
    }
    assert.deepEqual(Object.keys(steps).sort(), ["comfortable", "compact", "large"]);

    const smRem = Number(/--fs-sm:\s*calc\(([\d.]+)rem/.exec(rules)![1]);
    const chrome = token("space-2") * 2 + 2;
    for (const [preset, step] of Object.entries(steps)) {
      const ch = smRem * 16 * step * 0.6;
      const content = Number(width![1]) * ch + Number(width![2]) - chrome;
      assert.ok(content >= seedDigits * ch,
        `${preset}: the seed box offers ${content.toFixed(1)}px of text, `
        + `and ${seedDigits} digits need ${(seedDigits * ch).toFixed(1)}px`);
    }
  });
});
