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

const RUNGS = [1860, 1760, 1670, 1480, 1410, 1250, 1170] as const;

describe("the rungs exist, in priority order, and each takes only what it says", () => {
  it("rung 1 (≤1860): the Search label and the providers sentence → short form", () => {
    assert.match(css, /@media \(max-width: 1860px\) \{\n  \.header-command-button__label \{\n    display: none;/);
    const r = rung(1860);
    assert.match(r, /\.system-health__label \{\n    display: none;/);
    assert.match(r, /\.system-health__label--short \{\n    display: inline;/);
    assert.doesNotMatch(r, /header-settings|latency-chip|telegram/);
  });

  it("rung 2 (≤1760): only the chip's state word", () => {
    const r = rung(1760);
    assert.match(r, /\.latency-chip__state \{\n    display: none;/);
    assert.doesNotMatch(r, /\.latency-chip__copy|\.latency-chip__core|header-settings/);
  });

  it("rung 3 (≤1670): only the Settings label", () => {
    const r = rung(1670);
    assert.match(r, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
    assert.doesNotMatch(r, /latency-chip|system-health|brand-copy/);
  });

  it("rung 4 (≤1610): the data-tier label; rung 5 (≤1560): the Connect label", () => {
    assert.match(css, /@media \(max-width: 1610px\) \{\n  \.data-tier__label \{\n    display: none;/);
    assert.match(read("components/header/TelegramCta.tsx"), /max-\[1560px\]:hidden/);
  });

  it("the core annotation is NOT a rung — it adds no width and stays until the chip folds", () => {
    for (const max of RUNGS) {
      assert.doesNotMatch(rung(max), /\.latency-chip__core \{\n    display: none/, `rung ${max} hides the core figure`);
    }
    assert.match(css, /Not a rung: the core annotation inside the decision chip/);
  });

  it("rung 6 (≤1480): the providers chip to its dot, aria keeps the sentence", () => {
    const r = rung(1480);
    assert.match(r, /\.system-health-action \{[\s\S]*font-size: 0;/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
  });

  it("rung 7 (≤1410): brand tagline and tab padding, nothing of the chip", () => {
    const r = rung(1410);
    assert.match(r, /\.brand-copy small \{\n    display: none;/);
    assert.match(r, /\.workspace-tabs button \{\n    padding-inline: 5px;/);
    assert.doesNotMatch(r, /latency-chip/);
  });

  it("rung 8 (≤1250): the decision figure folds to its gauge — last of the chip", () => {
    assert.match(rung(1250), /\.latency-chip__copy \{\n    display: none;/);
  });

  it("rung 9 (≤1170): Kill switch and Sign in labels fold to icons that keep their names", () => {
    const r = rung(1170);
    assert.match(r, /\.header-kill-label,\n  \.header-signin-label \{\n    display: none;/);
    const kill = read("components/header/KillSwitchControl.tsx");
    assert.match(kill, /aria-label=\{halted \? "Trading is halted — open the resume control" : "Open the kill switch"\}/);
    assert.match(kill, /className=\{halted \? undefined : "header-kill-label max-\[520px\]:hidden"\}/);
    const account = read("components/header/AccountChip.tsx");
    assert.match(account, /aria-label="Sign in"/);
    assert.match(account, /className="header-signin-label max-\[520px\]:hidden"/);
  });

  it("the row wraps at 1090, where even the icons no longer fit on one row", () => {
    assert.match(css, /@media \(max-width: 1090px\) \{\n  \.workspace-header__utility \{\n    flex-wrap: wrap;/);
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
  it("tabs sit one rung above the chips; every chip word is 12px", () => {
    assert.match(css, /\.workspace-tabs button span \{[\s\S]{0,220}font-size: var\(--fs-xl\);/);
    for (const sel of ["\n.data-tier {", "\n.system-health {", "\n.header-settings span {"]) {
      const i = css.indexOf(sel);
      assert.notEqual(i, -1, sel);
      const block = css.slice(i, css.indexOf("\n}\n", i));
      assert.match(block, /font-size: var\(--fs-md\);/, `${sel.trim()} is not 12px`);
    }
    // The triggers, not the panels behind them (panel field labels are 11px on purpose).
    assert.match(read("components/header/KillSwitchControl.tsx"), /py-1\.5 text-\[12px\] font-semibold text-text-secondary hover:border-border/);
    assert.match(read("components/header/AccountChip.tsx"), /py-1\.5 text-\[12px\] font-semibold text-text-secondary no-underline/);
    assert.match(read("components/header/TelegramCta.tsx"), /text-\[12px\] font-semibold no-underline/);
  });
});
