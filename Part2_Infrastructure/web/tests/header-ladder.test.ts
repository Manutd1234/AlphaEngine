/**
 * The header's priority ladder — the row never clips its own controls.
 *
 * `.workspace-header__utility` is `overflow-x: clip`, so a row wider than the
 * viewport silently loses whatever sits furthest right: Settings, and for a
 * guest, Sign in. Measured on production as a guest, the fully-labelled row
 * needs ~1805px at the header's type size and nothing used to collapse above
 * 1380px, so Settings was clipped from 1722px down. These contracts pin the
 * ladder that replaced that band: nine small rungs, lowest priority first,
 * each measured to land just before the next clip, one structure for guest
 * and signed-in alike. The measurements live in the CSS comment; this file
 * keeps the rungs from drifting back into one all-at-once band and keeps the
 * essentials off the ladder entirely.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const css = read("app/globals.css");

/** The rules inside one `@media (min-width: 901px) and (max-width: Npx)` block. */
function rung(max: number): string {
  const head = `@media (min-width: 901px) and (max-width: ${max}px) {`;
  const start = css.indexOf(head);
  assert.notEqual(start, -1, `no rung at ${max}px`);
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

const RUNGS = [1940, 1840, 1750, 1560, 1470, 1300, 1140] as const;

describe("the rungs exist, in priority order, and each takes only what it says", () => {
  it("rung 1 (≤1940): the Search label and the providers sentence → short form", () => {
    assert.match(css, /@media \(max-width: 1940px\) \{\n  \.header-command-button__label \{\n    display: none;/);
    const r = rung(1940);
    assert.match(r, /\.system-health__label \{\n    display: none;/);
    assert.match(r, /\.system-health__label--short \{\n    display: inline;/);
    assert.doesNotMatch(r, /header-settings|latency-chip|telegram/);
  });

  it("rung 2 (≤1840): only the chip's state word", () => {
    const r = rung(1840);
    assert.match(r, /\.latency-chip__state \{\n    display: none;/);
    assert.doesNotMatch(r, /\.latency-chip__copy|\.latency-chip__core|header-settings/);
  });

  it("rung 3 (≤1750): only the Settings label", () => {
    const r = rung(1750);
    assert.match(r, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
    assert.doesNotMatch(r, /latency-chip|system-health|brand-copy/);
  });

  it("rung 4 (≤1690): the data-tier label; rung 5 (≤1640): the Connect label", () => {
    assert.match(css, /@media \(max-width: 1690px\) \{\n  \.data-tier__label \{\n    display: none;/);
    assert.match(read("components/header/TelegramCta.tsx"), /max-\[1640px\]:hidden/);
  });

  it("the core annotation is NOT a rung — it adds no width and stays until the chip folds", () => {
    for (const max of RUNGS) {
      assert.doesNotMatch(rung(max), /\.latency-chip__core \{\n    display: none/, `rung ${max} hides the core figure`);
    }
    assert.match(css, /Not a rung: the core annotation inside the decision chip/);
  });

  it("rung 6 (≤1560): the providers chip to its dot, aria keeps the sentence", () => {
    const r = rung(1560);
    assert.match(r, /\.system-health-action \{[\s\S]*font-size: 0;/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
  });

  it("rung 7 (≤1470): brand tagline and tab padding, nothing of the chip", () => {
    const r = rung(1470);
    assert.match(r, /\.brand-copy small \{\n    display: none;/);
    assert.match(r, /\.workspace-tabs button \{\n    padding-inline: 5px;/);
    assert.doesNotMatch(r, /latency-chip/);
  });

  it("rung 8 (≤1300): the decision figure folds to its gauge — last of the chip", () => {
    assert.match(rung(1300), /\.latency-chip__copy \{\n    display: none;/);
  });

  it("rung 9 (≤1140): Kill switch and Sign in labels fold to icons that keep their names", () => {
    const r = rung(1140);
    assert.match(r, /\.header-kill-label,\n  \.header-signin-label \{\n    display: none;/);
    const kill = read("components/header/KillSwitchControl.tsx");
    assert.match(kill, /aria-label=\{halted \? "Trading is halted — open the resume control" : "Open the kill switch"\}/);
    assert.match(kill, /className=\{halted \? undefined : "header-kill-label max-\[520px\]:hidden"\}/);
    const account = read("components/header/AccountChip.tsx");
    assert.match(account, /aria-label="Sign in"/);
    assert.match(account, /className="header-signin-label max-\[520px\]:hidden"/);
  });

  it("the row wraps at 1110, where even the icons no longer fit on one row", () => {
    assert.match(css, /@media \(max-width: 1110px\) \{\n  \.workspace-header__utility \{\n    flex-wrap: wrap;/);
  });

  it("the rungs descend — no rung is wider than the one before it", () => {
    for (let i = 1; i < RUNGS.length; i++) assert.ok(RUNGS[i] < RUNGS[i - 1]);
  });
});

describe("the essentials are never on the ladder", () => {
  it("no rung hides Settings, the account chip, the kill switch button or the tabs", () => {
    for (const max of RUNGS) {
      const r = rung(max);
      assert.doesNotMatch(r, /\.header-settings \{\n    display: none/, `rung ${max} hides Settings`);
      assert.doesNotMatch(r, /\.workspace-tabs \{\n    display: none/, `rung ${max} hides the tabs`);
      assert.doesNotMatch(r, /\.header-anchor \{\n    display: none/, `rung ${max} hides an anchored control`);
    }
  });

  it("the providers short form is a second label, hidden at rest, never both painted", () => {
    const header = read("components/WorkspaceHeader.tsx");
    assert.match(header, /<span className="system-health__label">\{healthLabel\}<\/span>/);
    assert.match(header, /<span className="system-health__label--short" aria-hidden>\{healthLabelShort\}<\/span>/);
    assert.match(css, /\.system-health__label--short \{\n  display: none;/);
  });
});

describe("the header's words are one size class", () => {
  // The header is chrome: its words use the four fixed --fs-chrome-* tokens,
  // never a content rung, so the ladder below — a px measurement — cannot be
  // moved by the Text-size preference or by a rung retarget it was not
  // measured under. Tabs sit one token above the chips.
  it("tabs sit one token above the chips; every chip word is the --fs-chrome-chip token", () => {
    assert.match(css, /\.workspace-tabs button span \{[\s\S]{0,220}font-size: var\(--fs-chrome-tab\);/);
    for (const sel of ["\n.data-tier {", "\n.system-health {", "\n.header-settings span {"]) {
      const i = css.indexOf(sel);
      assert.notEqual(i, -1, sel);
      const block = css.slice(i, css.indexOf("\n}\n", i));
      assert.match(block, /font-size: var\(--fs-chrome-chip\);/, `${sel.trim()} is not the --fs-chrome-chip token`);
    }
    // The chrome tokens are fixed px — no viewport term, no --type-step.
    const root = css.slice(css.indexOf(":root {"), css.indexOf("\n}\n", css.indexOf(":root {")));
    for (const token of ["--fs-chrome-tab", "--fs-chrome-chip", "--fs-chrome-caption", "--fs-chrome-brand"]) {
      const value = root.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1] ?? "";
      assert.match(value, /^\d+(\.\d+)?px$/, `${token} must be a fixed px value, got ${value}`);
    }
    assert.ok(Number(root.match(/--fs-chrome-tab:\s*([\d.]+)px/)![1]) > Number(root.match(/--fs-chrome-chip:\s*([\d.]+)px/)![1]));
    // The triggers, not the panels behind them (panel copy uses content rungs).
    assert.match(read("components/header/KillSwitchControl.tsx"), /py-1\.5 text-fs-chrome-chip font-semibold text-text-secondary hover:border-border/);
    assert.match(read("components/header/AccountChip.tsx"), /py-1\.5 text-fs-chrome-chip font-semibold text-text-secondary no-underline/);
    assert.match(read("components/header/TelegramCta.tsx"), /text-fs-chrome-chip font-semibold no-underline/);
  });
});
