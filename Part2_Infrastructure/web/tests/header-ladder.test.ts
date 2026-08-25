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

// RE-DERIVED 2026-08-25, WHEN THE TABS TOOK THEIR OWN LINE, and the list got
// SHORTER rather than longer — which is the whole point of the change.
//
// Eleven tabs and eight controls could not share one 1728px line: the reader
// met a settings control cut in half, and restoring even the word "Settings"
// re-clipped the row at 1800, 1740 and 1728. So the strip is `flex-basis: 100%`
// now and the ladder measures against LINE 1 alone — brand plus the cluster —
// which needs about 1361px unfolded instead of 2046. Every rung falls with it.
//
// Rungs 8 to 11 are RETIRED, not loosened. Re-derived against line 1 they land
// at 890, 810, 650 and 540, inside their own `min-width: 901px` floor — blocks
// that could never match. What they folded still folds below the desk band
// (`01:2081-2100`, `01:2125-2131`, and `max-[520px]:hidden` in the components),
// and the tab metrics go back to the 8px/14px they were designed at.
//
// Each width is still where the state above it stops fitting, rounded up to a
// ten, measured with the WIDEST string each chip can show. 14p carries the
// derivation and the before/after.
const RUNGS = [1380, 1280, 1180, 1120, 960] as const;

describe("the rungs exist, in priority order, and each takes only what it says", () => {
  it("rung 1 (≤1380): the Search label and the providers sentence → short form", () => {
    assert.match(css, /@media \(max-width: 1380px\) \{\n  \.header-command-button__label \{\n    display: none;/);
    const r = rung(1380);
    assert.match(r, /\.system-health__label \{\n    display: none;/);
    assert.match(r, /\.system-health__label--short \{\n    display: inline;/);
    assert.doesNotMatch(r, /header-settings|latency-chip|telegram/);
  });

  it("rung 2 (≤1280): only the chip's state word", () => {
    const r = rung(1280);
    assert.match(r, /\.latency-chip__state \{\n    display: none;/);
    assert.doesNotMatch(r, /\.latency-chip__copy|\.latency-chip__core|header-settings/);
  });

  it("rung 3 (≤1180): only the Settings label", () => {
    const r = rung(1180);
    assert.match(r, /\.workspace-header__utility > \.header-anchor > \.header-settings span,/);
    assert.doesNotMatch(r, /latency-chip|system-health|brand-copy/);
  });

  it("rung 4 (≤1120): the brand tagline, and nothing that carries a word", () => {
    // The promotion this ladder was reordered for. It is the only thing on the
    // row that is pure decoration, and at a measured 72px it outweighs either
    // of the two labels below it — which is what keeps both on a 1722px desk.
    const r = rung(1120);
    assert.match(r, /\.brand-copy small \{\n    display: none;/);
    assert.doesNotMatch(r, /data-tier|telegram|system-health|latency-chip|workspace-tabs/,
      "rung 4 took something that carries a word; only the tagline may go this early");
  });

  it("rung 5 (≤1050): the data-tier label; rung 6 (<990): the Connect label", () => {
    assert.match(css, /@media \(max-width: 1050px\) \{\n  \.data-tier__label \{\n    display: none;/);
    assert.match(read("components/header/TelegramCta.tsx"), /max-\[990px\]:hidden/);
  });

  it("both of those fold AFTER the tagline, so a 1722px desk keeps their words", () => {
    // The reported defect, as an ordering rather than as a pixel: at 1722 the
    // tagline's rung fires and neither label's does. If a later edit pushes
    // rung 4 below either of them, that reader loses "Live" and "Connect"
    // again and no other assertion here would notice.
    const tagline = 1120;
    const dataTier = Number(/@media \(max-width: (\d+)px\) \{\n  \.data-tier__label/.exec(css)?.[1]);
    const connect = Number(/max-\[(\d+)px\]:hidden/.exec(read("components/header/TelegramCta.tsx"))?.[1]);
    assert.ok(dataTier < tagline, `the data-tier label (${dataTier}) folds at or above the tagline (${tagline})`);
    assert.ok(connect < tagline, `the Connect label (${connect}) folds at or above the tagline (${tagline})`);
    // A 1728px desk now folds NEITHER — that is what the second line bought.
    assert.ok(dataTier < 1728 && connect < 1728, "a 1728px desk still folds one of the two labels");
  });

  it("the core annotation is NOT a rung — it adds no width and stays until the chip folds", () => {
    for (const max of RUNGS) {
      assert.doesNotMatch(rung(max), /\.latency-chip__core \{\n    display: none/, `rung ${max} hides the core figure`);
    }
    assert.match(css, /Not a rung: the core annotation inside the decision chip/);
  });

  it("rung 7 (≤960): the providers chip to its dot, aria keeps the sentence", () => {
    const r = rung(960);
    assert.match(r, /\.system-health-action \{[\s\S]*font-size: 0;/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-label=\{`Open reliability\. \$\{healthLabel\}`\}/);
  });

  it("rungs 8 to 11 are retired, and what they folded still folds below the desk band", () => {
    // THEY WERE NOT LOOSENED, THEY STOPPED BEING REACHABLE. Re-derived against
    // a line 1 that no longer carries eleven tabs, rung 8's tab metrics land at
    // 890, rung 9's p99 figure at 810, rung 10's kill and sign-in words at 650
    // and rung 11's wordmark at 540 — every one inside its own
    // `min-width: 901px` floor, i.e. a block that could never match. A rung
    // that cannot fire is a rule claiming a fold that does not happen, so they
    // are deleted rather than moved, which is the same close-out the relocation
    // table gives an id that is a section again.
    // Checked by what they FOLDED, not by the widths they used to sit at —
    // 1380, 1280 and 1170 are live rung widths again on the new ladder, so a
    // width-based check here would contradict itself and pass or fail for the
    // wrong reason. What must be true is that nothing on the ladder does these
    // four things any more.
    const everyRung = RUNGS.map(rung).join("\n");
    assert.doesNotMatch(everyRung, /\.workspace-tabs button \{\n    padding-inline:/,
      "a rung folds the tabs' padding again; two rows means they keep their designed metrics");
    assert.doesNotMatch(everyRung, /\.workspace-tabs button span \{\n    font-size:/,
      "a rung shrinks the tab type again");
    assert.doesNotMatch(everyRung, /\.latency-chip__copy \{\n    display: none/,
      "a rung folds the p99 figure again");
    assert.doesNotMatch(everyRung, /\.header-kill-label,\n  \.header-signin-label \{\n    display: none/,
      "a rung folds the kill and sign-in words again");
    assert.doesNotMatch(everyRung, /\.brand-copy \{\n    display: none/,
      "a rung folds the wordmark again");

    // Nothing they did is lost. Each still happens where a viewport genuinely
    // cannot hold it, below the band this ladder covers.
    assert.match(css, /@media \(max-width: 720px\)/, "the latency internals no longer fold at all");
    assert.match(css, /@media \(max-width: 520px\)/, "the wordmark no longer folds at all");
    assert.match(read("components/header/KillSwitchControl.tsx") + read("components/header/AccountChip.tsx"),
      /max-\[520px\]:hidden/, "the kill and sign-in words no longer fold at all");

    // And the tabs have their designed metrics back: the 6px/4px inline pad was
    // a stopgap bought for a single row that no longer exists.
    assert.match(css, /\.workspace-tabs button \{[^}]*padding: 8px 8px;/,
      "the tabs are still on the eleventh tab's emergency padding");
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
