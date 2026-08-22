/**
 * The three Text size presets, pinned to the pixels they were asked for.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Text size control shipped with steps of 0.9375 / 1 / 1.125. Those put
 * compact at 13.125px against comfortable's 14 — 0.88px apart, and under one
 * pixel on seven of the nine reading rungs — so a reader switching between the
 * first two segments saw nothing move. Nothing failed, because no test had
 * ever asserted what a preset RESOLVES TO; `type-scale.test.ts` pins the
 * ladder's shape and `text-size.test.ts` pins the plumbing, and a step is a
 * number that satisfies both while making the control inert.
 *
 * So this file does the arithmetic the browser does: rem × 16 × step, per
 * preset, read out of the stylesheet rather than restated here. On
 * 2026-08-22 the steps became 6/7 and 17/14, landing --fs-body on exactly
 * 12 / 14 / 17px. If a future revision moves --fs-body or either step, this
 * file names the pixel that changed instead of letting the control go quiet
 * again.
 *
 * The monotonicity assertion is the general form of the same guard: every
 * content rung shares one multiplier, so a step that is zero, negative or
 * non-numeric collapses or inverts the whole ladder at once, and every other
 * suite would still pass.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const css = globalsCss;
const toggle = read("components/TextSizeToggle.tsx");
const store = read("lib/text-size.ts");

/** The control's own copy, isolated from the comments that discuss it. */
const labels = toggle.slice(toggle.indexOf("const LABELS"), toggle.indexOf("};", toggle.indexOf("const LABELS")));

/** Comment bodies blanked, newlines kept — the same treatment type-scale.test.ts gives. */
const declarations = css.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));

/** The first `:root` block: the ladder itself. */
const rootBlock = declarations.slice(
  declarations.indexOf(":root {"),
  declarations.indexOf("\n}\n", declarations.indexOf(":root {")),
);

/** The browser's default root size. Every rung is rem, so this is the multiplier. */
const ROOT_PX = 16;

/** The reading floor: prose must stay clear of --fs-tick, which is chart furniture. */
const READING_FLOOR_PX = 10.5;

/** The content ladder in the order it must stay in, tick and input excluded. */
const LADDER = [
  "--fs-2xs", "--fs-xs", "--fs-sm", "--fs-body", "--fs-md", "--fs-lg",
  "--fs-xl", "--fs-2xl", "--fs-title", "--fs-h2", "--fs-h1", "--fs-figure",
  "--fs-display",
] as const;

/** A rung's rem value: the plain literal, or a clamp's minimum for the hero rungs. */
function rem(token: string): number {
  const m = rootBlock.match(new RegExp(`${token}:\\s*calc\\((?:clamp\\()?([\\d.]+)rem`));
  assert.ok(m, `${token} must be calc(<rem> * var(--type-step))`);
  return Number(m![1]);
}

/** A preset's step, read from the stylesheet, never restated. */
function step(preset: string): number {
  if (preset === "comfortable") {
    const m = rootBlock.match(/--type-step:\s*([\d.]+);/);
    assert.ok(m, "comfortable is the :root value of --type-step");
    return Number(m![1]);
  }
  const m = declarations.match(
    new RegExp(`\\[data-text-size="${preset}"\\]\\s*\\{[^}]*--type-step:\\s*([\\d.]+)\\s*;`),
  );
  assert.ok(m, `the ${preset} override must set --type-step to a bare decimal`);
  return Number(m![1]);
}

const STEPS = { compact: step("compact"), comfortable: step("comfortable"), large: step("large") };

/** A rung's computed px under one preset, at the browser's default root size. */
const px = (token: string, preset: keyof typeof STEPS) => rem(token) * ROOT_PX * STEPS[preset];

describe("the three presets land on the sizes they promise", () => {
  it("reading text is 12px, 14px and 17px", () => {
    // The request, in the user's own numbers. Asserted on --fs-body because
    // that is the rung the word "reading text" names in the control's prose.
    assert.ok(Math.abs(px("--fs-body", "compact") - 12) < 1e-6, `compact body: ${px("--fs-body", "compact")}`);
    assert.equal(px("--fs-body", "comfortable"), 14);
    assert.ok(Math.abs(px("--fs-body", "large") - 17) < 1e-6, `large body: ${px("--fs-body", "large")}`);
  });

  it("the steps are the exact fractions, written as decimals", () => {
    // 6/7 and 17/14 to nine places. A decimal and not `calc(6 / 7)` on
    // purpose: the reading-floor guard in type-scale.test.ts matches a bare
    // number, so a calc() there would disarm it in silence rather than fail.
    assert.ok(Math.abs(STEPS.compact - 6 / 7) < 1e-8, `compact step ${STEPS.compact}`);
    assert.equal(STEPS.comfortable, 1);
    assert.ok(Math.abs(STEPS.large - 17 / 14) < 1e-8, `large step ${STEPS.large}`);
    assert.doesNotMatch(declarations, /--type-step:\s*calc/, "a calc() step disarms the floor guard");
  });

  it("no two segments are within a pixel of each other on the reading rungs", () => {
    // The defect this revision fixes: 0.9375 against 1 was 0.88px at
    // --fs-body and under a pixel on seven of the nine reading rungs, so the
    // first two segments were indistinguishable. One pixel is the floor of
    // what a reader can see; the rung with the least room is the smallest.
    for (const token of ["--fs-2xs", "--fs-xs", "--fs-sm", "--fs-body"]) {
      assert.ok(
        px(token, "comfortable") - px(token, "compact") >= 1,
        `${token}: compact and comfortable are ${(px(token, "comfortable") - px(token, "compact")).toFixed(2)}px apart — a control a reader cannot see is not a control`,
      );
      assert.ok(
        px(token, "large") - px(token, "comfortable") >= 1,
        `${token}: comfortable and large are ${(px(token, "large") - px(token, "comfortable")).toFixed(2)}px apart`,
      );
    }
  });
});

describe("the ladder holds its order at every step", () => {
  it("no rung crosses another under any preset", () => {
    // Every content rung shares one multiplier, so this can only break by a
    // bad step (zero, negative, unparseable) or a bad rem value — and both of
    // those pass every other suite in the sheet.
    for (const preset of ["compact", "comfortable", "large"] as const) {
      for (let i = 1; i < LADDER.length; i += 1) {
        assert.ok(
          px(LADDER[i], preset) > px(LADDER[i - 1], preset),
          `${preset}: ${LADDER[i]} (${px(LADDER[i], preset).toFixed(2)}px) must sit above ${LADDER[i - 1]} (${px(LADDER[i - 1], preset).toFixed(2)}px)`,
        );
      }
      // The three hero rungs are their own chain — --fs-hero-line's minimum
      // sits below --fs-display on purpose, because a hero line is one line
      // of type and a display figure is a number in a tile.
      assert.ok(px("--fs-hero-sub", preset) > px("--fs-hero-line", preset), `${preset}: --fs-hero-sub above --fs-hero-line`);
      assert.ok(px("--fs-hero", preset) > px("--fs-hero-sub", preset), `${preset}: --fs-hero above --fs-hero-sub`);
    }
  });

  it("prose never falls into the chart-furniture zone, at any preset", () => {
    // --fs-2xs is not a kicker rung: the bare `small` rule, two prose
    // selectors, a log stream, table bodies and 21 controls read it. --fs-tick
    // is SVG axis furniture at a fixed 10px, and the desk depends on prose
    // reading as larger than the numbers drawn beside a chart. 0.75rem at 6/7
    // was 10.29px — 0.29px of separation — which is why the bottom two rungs
    // moved to 0.78125rem and 0.796875rem.
    const tick = Number(rootBlock.match(/--fs-tick:\s*([\d.]+)px;/)![1]);
    const smallest = px("--fs-2xs", "compact");
    assert.ok(smallest >= READING_FLOOR_PX, `--fs-2xs at compact is ${smallest.toFixed(2)}px, under the ${READING_FLOOR_PX}px reading floor`);
    assert.ok(smallest - tick >= 0.5, `--fs-2xs at compact sits only ${(smallest - tick).toFixed(2)}px above --fs-tick`);
  });
});

describe("what the presets must not reach", () => {
  it("the chrome tokens carry no step, and neither do the tick or the input threshold", () => {
    // The header's priority ladder is a px measurement taken at one size; a
    // preference that moved it would invalidate the measurement and can cost
    // a reader on Large a toolbar that fits.
    for (const token of ["--fs-chrome-tab", "--fs-chrome-chip", "--fs-chrome-caption", "--fs-chrome-brand"]) {
      assert.match(rootBlock, new RegExp(`${token}:\\s*\\d+px;`), `${token} must be a fixed px`);
      assert.doesNotMatch(rootBlock, new RegExp(`${token}:[^;]*--type-step`), `${token} must not step`);
    }
    assert.match(rootBlock, /--fs-tick:\s*\d+px;/);
    assert.match(rootBlock, /--fs-input:\s*16px;/);
    for (const token of ["--fs-tick", "--fs-input"]) {
      assert.doesNotMatch(rootBlock, new RegExp(`${token}:[^;]*--type-step`), `${token} must not step`);
    }
  });

  it("comfortable stamps no attribute — the default and an unset preference are one state", () => {
    // The same rule the theme's System setting follows. A stamped
    // "comfortable" would be a state that matches no rule while looking like
    // a choice, and the stylesheet would answer it with the :root value
    // anyway.
    assert.doesNotMatch(css, /data-text-size="comfortable"/, "no rule may exist for comfortable");
    assert.match(store, /if \(size === DEFAULT_TEXT_SIZE\) delete root\.dataset\.textSize;/);
    for (const preset of ["compact", "large"]) {
      assert.match(css, new RegExp(`:root\\[data-text-size="${preset}"\\]`), `${preset} needs its override block`);
    }
  });
});

describe("the control says what it does", () => {
  it("the descriptions quote the pixels the stylesheet resolves to", () => {
    // The old prose named fractions ("fifteen sixteenths", "nine eighths")
    // and, after the content ladder stopped being fluid on 2026-08-20, a
    // wide-monitor step that no longer existed. Nothing pinned it, so it
    // drifted for two days in the one place a reader looks while changing
    // the setting. Pinned here against the stylesheet's own arithmetic.
    for (const preset of ["compact", "comfortable", "large"] as const) {
      const size = `${Math.round(px("--fs-body", preset))}px`;
      assert.ok(
        labels.includes(`Reading text at ${size}`) || labels.includes(`reading text at ${size}`),
        `TextSizeToggle must state ${size} for ${preset}`,
      );
    }
    // Scoped to the LABELS object, not the whole file: the comment above it
    // quotes the retired wording to say why it was retired, and a scan of the
    // file would read that quotation as the defect coming back.
    assert.doesNotMatch(labels, /fifteen sixteenths|nine eighths/, "a fraction is not a size a reader can check");
    assert.doesNotMatch(labels, /a step more on a wide monitor|fluid between/, "the content ladder stopped being fluid on 2026-08-20");
    assert.match(store, /12px, 14px and 17px/, "lib/text-size.ts states the sizes the three steps resolve to");
  });
});
