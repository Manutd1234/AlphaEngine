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

import { globalsCss } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");
const css = globalsCss;

/** The rules inside one `@media (min-width: 901px) and (max-width: Npx)` block. */
function rung(max: number): string {
  const head = `@media (min-width: 901px) and (max-width: ${max}px) {`;
  const start = css.indexOf(head);
  assert.notEqual(start, -1, `no rung at ${max}px`);
  const end = css.indexOf("\n}\n", start);
  return css.slice(start, end);
}

// Re-measured 2026-08-24 for the tenth tab, then REORDERED the same day: the
// first pass folded the data-tier and Connect labels at 1800 and 1740, so a
// 1722px desk lost the words "Live" and "Connect" while the brand tagline —
// which says nothing the wordmark does not — stayed. The tagline is rung 4 now.
// Each width is where the state above it stops fitting, rounded up to a ten,
// measured with the WIDEST string each chip can show — Telegram's five labels
// top out at "Unavailable", three characters past "Connected", and a ladder
// tuned while that chip happened to read "Telegram" clipped by a pixel at 1716
// the moment the companion went unreachable. 14p carries the eleven figures.
const RUNGS = [2050, 1950, 1850, 1790, 1590, 1520, 1380, 1280, 1170] as const;

describe("the rungs exist, in priority order, and each takes only what it says", () => {
  it("rung 1 (≤2050): the Search label and the providers sentence → short form", () => {
    assert.match(css, /@media \(max-width: 2050px\) \{\n  \.header-command-button__label \{\n    display: none;/);
    const r = rung(2050);
    assert.match(r, /\.system-health__label \{\n    display: none;/);
    assert.match(r, /\.system-health__label--short \{\n    display: inline;/);
    assert.doesNotMatch(r, /header-settings|latency-chip|telegram/);
  });

  it("rung 2 (≤1950): only the chip's state word", () => {
    const r = rung(1950);
    assert.match(r, /\.latency-chip__state \{\n    display: none;/);
    assert.doesNotMatch(r, /\.latency-chip__copy|\.latency-chip__core|header-settings/);
  });

  it("rung 3 (≤1850): only the Settings label", () => {
    const r = rung(1850);
    assert.match(r, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
    assert.doesNotMatch(r, /latency-chip|system-health|brand-copy/);
  });

  it("rung 4 (≤1790): the brand tagline, and nothing that carries a word", () => {
    // The promotion this ladder was reordered for. It is the only thing on the
    // row that is pure decoration, and at a measured 72px it outweighs either
    // of the two labels below it — which is what keeps both on a 1722px desk.
    const r = rung(1790);
    assert.match(r, /\.brand-copy small \{\n    display: none;/);
    assert.doesNotMatch(r, /data-tier|telegram|system-health|latency-chip|workspace-tabs/,
      "rung 4 took something that carries a word; only the tagline may go this early");
  });

  it("rung 5 (≤1720): the data-tier label; rung 6 (<1660): the Connect label", () => {
    assert.match(css, /@media \(max-width: 1720px\) \{\n  \.data-tier__label \{\n    display: none;/);
    assert.match(read("components/header/TelegramCta.tsx"), /max-\[1660px\]:hidden/);
  });

  it("both of those fold AFTER the tagline, so a 1722px desk keeps their words", () => {
    // The reported defect, as an ordering rather than as a pixel: at 1722 the
    // tagline's rung fires and neither label's does. If a later edit pushes
    // rung 4 below either of them, that reader loses "Live" and "Connect"
    // again and no other assertion here would notice.
    const tagline = 1790;
    const dataTier = Number(/@media \(max-width: (\d+)px\) \{\n  \.data-tier__label/.exec(css)?.[1]);
    const connect = Number(/max-\[(\d+)px\]:hidden/.exec(read("components/header/TelegramCta.tsx"))?.[1]);
    assert.ok(dataTier < tagline, `the data-tier label (${dataTier}) folds at or above the tagline (${tagline})`);
    assert.ok(connect < tagline, `the Connect label (${connect}) folds at or above the tagline (${tagline})`);
    assert.ok(dataTier < 1722 && connect < 1722, "a 1722px desk folds one of the two labels");
  });

  it("the core annotation is NOT a rung — it adds no width and stays until the chip folds", () => {
    for (const max of RUNGS) {
      assert.doesNotMatch(rung(max), /\.latency-chip__core \{\n    display: none/, `rung ${max} hides the core figure`);
    }
    assert.match(css, /Not a rung: the core annotation inside the decision chip/);
  });

  it("rung 7 (≤1590): the providers chip to its dot, aria keeps the sentence", () => {
    const r = rung(1590);
    assert.match(r, /\.system-health-action \{[\s\S]*font-size: 0;/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
  });

  it("rung 8 (≤1520): tab padding and tab type, nothing of the chip", () => {
    const r = rung(1520);
    // 4px since the eleventh tab, down from 5px. The reason it is a value and
    // not a rung MOVE is the whole of that pass: every rung from 1 to 7 sheds a
    // WORD, so paying for a tab by firing them ~30px earlier spends the
    // reader's vocabulary, and the instruction was the opposite. The tabs' own
    // side padding is the one thing on this row that can be given up without
    // costing anybody a word, and 14p reserved it for exactly this. Swept
    // 2100 → 910 in 10px steps: no clipping at any width with 6px/4px, and
    // seven narrow widths still clipping with only the base pad changed.
    assert.match(r, /\.workspace-tabs button \{\n    padding-inline: 4px;/);
    assert.doesNotMatch(r, /latency-chip/);
    assert.doesNotMatch(r, /\.brand-copy small/, "the tagline is rung 4 now, not this one");
  });

  it("rung 9 (≤1380): the decision figure folds to its gauge — last of the chip", () => {
    assert.match(rung(1380), /\.latency-chip__copy \{\n    display: none;/);
  });

  it("rung 10 (≤1280): Kill switch and Sign in labels fold to icons that keep their names", () => {
    const r = rung(1280);
    assert.match(r, /\.header-kill-label,\n  \.header-signin-label \{\n    display: none;/);
    const kill = read("components/header/KillSwitchControl.tsx");
    assert.match(kill, /aria-label=\{halted \? "Trading is halted — open the resume control" : "Open the kill switch"\}/);
    assert.match(kill, /className=\{halted \? undefined : "header-kill-label max-\[520px\]:hidden"\}/);
    const account = read("components/header/AccountChip.tsx");
    assert.match(account, /aria-label="Sign in"/);
    assert.match(account, /className="header-signin-label max-\[520px\]:hidden"/);
  });

  it("rung 11 (≤1170): the wordmark, leaving the mark that is still the button", () => {
    // The last thing on the row that is not a control, and the only rung that
    // touches the brand at desk width. The mark keeps the click target and the
    // label; this is the ≤520px fold pulled up, as rung 9's is.
    const r = rung(1170);
    assert.match(r, /\.brand-copy \{\n    display: none;/);
    assert.doesNotMatch(r, /\.brand-mark|\.workspace-tabs/, "rung 10 took the mark or the tabs, not just the words");
    assert.match(read("components/common/BrandLockup.tsx"), /aria-label=\{label\}|label=/);
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

  it("the chip's width reservation is the live fleet's own sentence, not a px floor", () => {
    // The old 180px/129px floors were sized for a "20/20" fleet this
    // deployment does not run, which read as a phantom gap beside the account
    // chip. The ghost pseudo-elements reserve exactly what the real total can
    // produce, and swap to the short form with rung 1 like the label does.
    const header = read("components/WorkspaceHeader.tsx");
    assert.match(header, /data-widest=\{providersTotal != null \? `\$\{providersTotal\}\/\$\{providersTotal\} providers routable` : undefined\}/);
    assert.match(header, /data-widest-short=\{providersTotal != null \? `\$\{providersTotal\}\/\$\{providersTotal\} providers` : undefined\}/);
    assert.match(css, /\.system-health-action::before,\n\.system-health-action::after \{\n  content: attr\(data-widest\);\n  visibility: hidden;/);
    assert.doesNotMatch(css, /\.system-health-action \{[^}]*min-width: 1[0-9]{2}px/);
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
