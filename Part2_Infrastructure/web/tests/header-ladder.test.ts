/**
 * The header's priority ladder — the row never clips its own controls.
 *
 * `.workspace-header__utility` is `overflow-x: clip`, so a row wider than the
 * viewport silently loses whatever sits furthest right: Settings, and for a
 * guest, Sign in. Measured on production as a guest, the fully-labelled row
 * needs ~1735px and nothing collapsed above 1380px, so Settings was clipped
 * from 1722px down. These contracts pin the ladder that replaced that band:
 * seven rungs, lowest priority first, each measured to land before the next
 * clip, one structure for guest and signed-in alike. The measurements live in
 * the CSS comment; this file keeps the rungs from drifting back into one
 * all-at-once band and keeps the essentials off the ladder entirely.
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
  // Blocks are top-level; the next top-level close brace ends it.
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

describe("the rungs exist, in priority order, and each takes only what it says", () => {
  it("rung 1 (≤1780): Connect and Search labels, providers sentence → short form", () => {
    assert.match(read("components/header/TelegramCta.tsx"), /max-\[1780px\]:hidden/);
    assert.match(css, /@media \(max-width: 1780px\) \{\n  \.header-command-button__label \{\n    display: none;/);
    const r = rung(1780);
    assert.match(r, /\.system-health__label \{\n    display: none;/);
    assert.match(r, /\.system-health__label--short \{\n    display: inline;/);
  });

  it("rung 2 (≤1620): the Settings label and the chip's state word", () => {
    const r = rung(1620);
    assert.match(r, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
    assert.match(r, /\.latency-chip__state \{\n    display: none;/);
    assert.doesNotMatch(r, /\.latency-chip__copy/, "the decision figure is not rung 2");
  });

  it("rung 3 (≤1430): only the core annotation", () => {
    const r = rung(1430);
    assert.match(r, /\.latency-chip__core \{\n    display: none;/);
    assert.doesNotMatch(r, /latency-chip__copy|system-health-action|brand-copy/);
  });

  it("rung 4 (≤1420): the providers chip to its dot, aria keeps the sentence", () => {
    const r = rung(1420);
    assert.match(r, /\.system-health-action \{[\s\S]*font-size: 0;/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
  });

  it("rung 5 (≤1360): brand tagline and tab padding, nothing else", () => {
    const r = rung(1360);
    assert.match(r, /\.brand-copy small \{\n    display: none;/);
    assert.match(r, /\.workspace-tabs button \{\n    padding-inline: 5px;/);
    assert.doesNotMatch(r, /latency-chip/);
  });

  it("rung 6 (≤1220): the decision figure folds to its gauge — last of the chip", () => {
    const r = rung(1220);
    assert.match(r, /\.latency-chip__copy \{\n    display: none;/);
  });

  it("rung 7 (≤1120): Kill switch and Sign in labels fold to icons that keep their names", () => {
    const r = rung(1120);
    assert.match(r, /\.header-kill-label,\n  \.header-signin-label \{\n    display: none;/);
    const kill = read("components/header/KillSwitchControl.tsx");
    assert.match(kill, /aria-label=\{halted \? "Trading is halted — open the resume control" : "Open the kill switch"\}/);
    // HALTED never folds: the span carries the ladder class only when not halted.
    assert.match(kill, /className=\{halted \? undefined : "header-kill-label max-\[520px\]:hidden"\}/);
    const account = read("components/header/AccountChip.tsx");
    assert.match(account, /aria-label="Sign in"/);
    assert.match(account, /className="header-signin-label max-\[520px\]:hidden"/);
  });

  it("the row wraps at 1060, where even the icons no longer fit on one row", () => {
    assert.match(css, /@media \(max-width: 1060px\) \{\n  \.workspace-header__utility \{\n    flex-wrap: wrap;/);
  });
});

describe("the essentials are never on the ladder", () => {
  it("no rung hides Settings, the account chip, the kill switch button or the tabs", () => {
    for (const max of [1780, 1620, 1430, 1420, 1360, 1220, 1120]) {
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
