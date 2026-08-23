/**
 * The account chip: what the header shows while it does not yet know, what the
 * menu behind it offers, and the width at which the row stops fitting.
 *
 * Everything auth does eventually shows up in one 22px circle in the busiest
 * row of the app, and each of its failures is quiet in its own way. A "Sign in"
 * link rendered during the probe flashes a signed-out control at someone who is
 * signed in, which is what made sign-out feel unreliable even when it worked. A
 * menu item pointing at a route that does not exist is the same lie as an
 * unconfigured provider button. A skeleton that occupies a different box than
 * the control it replaces reflows the header when the answer lands.
 *
 * The house rules apply here in full and are asserted rather than assumed: a
 * dot AND a word for session state, the motion tokens in the shorthand that
 * actually compiles, one coarse-pointer block, and no new breakpoint invented
 * to buy room the ladder already measured.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { initialsFrom } from "../components/header/AccountChip";

import { globalsCss } from "./globals-css";
import { code } from "./helpers/auth-sources";
import { readSource } from "./helpers/source-files";

describe("the header does not guess while the probe is out", () => {
  const chip = readSource("components/header/AccountChip.tsx");

  it("renders a skeleton for loading, not a Sign in link", () => {
    // The bug: every page load flashed a signed-out control at someone who was
    // signed in, which is what made sign-out feel unreliable even when it
    // worked.
    assert.match(code(chip), /session\.status === "loading"/);
    const loading = code(chip).slice(code(chip).indexOf('session.status === "loading"'));
    const nextBranch = loading.indexOf('session.status === "signed-out"');
    assert.match(loading.slice(0, nextBranch), /className="skeleton/);
    assert.doesNotMatch(loading.slice(0, nextBranch), /href="\/login"/);
  });

  it("reuses the house skeleton rather than inventing a class", () => {
    // .skeleton is already shimmer-animated, already clamped by the single
    // reduced-motion block, and already referenced — a new class would cost a
    // dead-CSS slot for nothing.
    assert.match(code(chip), /skeleton block/);
    assert.doesNotMatch(code(chip), /account-skeleton|chip-skeleton/);
  });

  it("occupies the same box as the control it replaces", () => {
    // Otherwise the header reflows when the answer lands, which is the CLS
    // this branch exists to prevent.
    const loading = code(chip).slice(code(chip).indexOf('session.status === "loading"'));
    assert.match(loading.slice(0, 700), /gap-1\.5 rounded-\[9px\] border border-transparent px-1.5 py-1\.5/);
  });

  it("keeps the unconfigured guard byte-identical", () => {
    assert.match(code(chip), /if \(session\.status === "unconfigured"\) return null;/);
  });
});

describe("the account menu", () => {
  const chip = readSource("components/header/AccountChip.tsx");
  const header = readSource("components/WorkspaceHeader.tsx");
  const panel = readSource("components/header/QuickSettings.tsx");

  it("shows a monogram, not an image that may not exist", () => {
    // Provider avatars and uploads arrive with the profile page that can
    // manage them. Until then there is no URL, and a broken-image glyph would
    // be worse than initials.
    assert.match(code(chip), /initialsFrom\(null, session\.email\)/);
    assert.doesNotMatch(code(chip), /<img|avatar_url/);
  });

  it("derives sane initials", () => {
    assert.equal(initialsFrom(null, "ian.wangsa@example.com"), "IW");
    assert.equal(initialsFrom(null, "desk@example.com"), "D");
    assert.equal(initialsFrom("Ian Wangsa", "x@y.com"), "IW");
    assert.equal(initialsFrom(null, null), "?");
    // Never three characters: the circle is 22px.
    assert.ok(initialsFrom("a b c d", null).length <= 2);
  });

  it("states the session with a dot AND a word", () => {
    // Colour alone carries nothing for a reader who cannot see it, and the
    // house rule forbids it — which is also why this cannot be added to the
    // forced-colors allow-list.
    assert.match(code(chip), /Session active/);
    const dot = code(chip).slice(code(chip).indexOf("Session active") - 400);
    assert.match(dot.slice(0, 400), /aria-hidden/);
  });

  it("uses the token ladder for motion, in the shorthand that compiles", () => {
    // `duration-[--dur-fast]` emits `transition-duration: --dur-fast`, which is
    // invalid CSS — the transition silently does nothing while every test and
    // the build stay green. The `(--var)` shorthand is the one that works.
    assert.match(code(chip), /duration-\(--dur-fast\) ease-\(--ease\)/);
    assert.doesNotMatch(code(chip), /duration-\[--|ease-\[--/);
  });

  it("links to /profile, and only because the route now exists", () => {
    // This assertion was the inverse until the route landed: a menu item that
    // 404s for four commits is the same lie as an unconfigured provider
    // button. Kept as a pair rather than deleted, so the link and the page it
    // points at cannot be separated again — removing the route without
    // removing the item fails here.
    assert.match(code(chip), /href="\/profile"/);
    assert.ok(
      existsSync(fileURLToPath(new URL("../app/profile/page.tsx", import.meta.url))),
      "the account menu points at /profile but the route is gone",
    );
  });

  it("opens the settings panel without taking over its state", () => {
    // QuickSettings keeps owning `open`, so its dismissal logic and its
    // aria-expanded binding are untouched; a counter lets the same request be
    // made twice in a row, which a boolean could not.
    assert.match(code(chip), /onOpenPreferences\(\)/);
    // The handler is a `useCallback` now rather than an arrow written at the
    // call site — the header memoises its props so a keystroke in one control
    // cannot re-render the whole chrome. Both halves are pinned, because a
    // named handler can drift from the prop it is passed to in a way an inline
    // arrow could not: the counter bump, and the wiring that delivers it.
    assert.match(code(header), /const openPreferences = useCallback\(\(\) => setSettingsSignal\(\(n\) => n \+ 1\), \[\]\)/);
    assert.match(code(header), /onOpenPreferences=\{openPreferences\}/);
    assert.match(code(header), /openSignal=\{settingsSignal\}/);
    assert.match(code(panel), /if \(openSignal > 0\)/);
    assert.match(code(panel), /setOpen\(true\)/);
    assert.match(code(panel), /aria-expanded=\{open\}/);
  });

  it("offers the way back, and only from the door it was opened by", () => {
    /**
     * Preferences closes the account menu on its way to Quick settings, so
     * without a return path the only way back is to dismiss the panel and press
     * the avatar again — two panels that cannot reach each other, which is how
     * a two-page menu read as two dead ends.
     *
     * The condition is the part worth pinning. Quick settings has two doors —
     * the header gear and Preferences — and a "back to Account" shown to
     * someone who pressed the gear points at somewhere they have never been.
     * So the control is gated on the opening having come from the account menu,
     * and the gear resets that flag rather than leaving it set from last time.
     */
    assert.match(code(panel), /fromAccount && onBackToAccount/);
    assert.match(code(panel), /setFromAccount\(true\)/, "the account door must set the flag");
    assert.match(code(panel), /setFromAccount\(false\)/, "the gear must clear it");
    assert.match(code(panel), /onBackToAccount\(\)/);

    // Counters both ways, for the same reason the first one is a counter:
    // Preferences -> back -> Preferences -> back must work on every lap.
    // Memoised like its opposite number, and pinned the same way.
    assert.match(code(header), /const backToAccount = useCallback\(\(\) => setAccountSignal\(\(n\) => n \+ 1\), \[\]\)/);
    assert.match(code(header), /onBackToAccount=\{backToAccount\}/);
    assert.match(code(header), /openSignal=\{accountSignal\}/);
    assert.match(code(chip), /if \(openSignal > 0\) setOpen\(true\)/);
  });

  it("gives panel links a real touch target without a second coarse block", () => {
    const css = globalsCss;
    const coarse = css.slice(css.indexOf("@media (pointer: coarse)"));
    assert.match(coarse.slice(0, 900), /#account-panel a/);
    // Addressed by id, so no class is declared and the dead-CSS ratchet does
    // not move.
    assert.equal((css.match(/@media \(pointer: coarse\)/g) ?? []).length, 1);
  });
});

describe("the header cannot clip its own controls", () => {
  const css = globalsCss;
  const chip = readSource("components/header/AccountChip.tsx");

  it("shows a monogram, not the whole address, in the busiest row", () => {
    // The address was up to 132px of the most crowded row in the app, and it
    // is already the panel's heading. Carrying it twice cost the Settings gear
    // its place on screen at 1280px and 1440px.
    assert.doesNotMatch(code(chip), /truncate max-\[900px\]:hidden/);
    assert.match(code(chip), /aria-label=\{`Account menu for \$\{label\}`\}/);
  });

  it("wraps only in the band that cannot fit one row", () => {
    // Unconditional wrap costs 24px of height at 1440px for nothing: the
    // spacer's flex:1 makes the line overfull and wraps early. The band's top
    // is 1060px — measured as a guest with every rung of the header's priority
    // ladder applied (header-ladder.test.ts), the last width at which even the
    // icon-only row fits; it was 1024 when the ladder did not exist.
    assert.match(css, /@media \(max-width: 1110px\) \{\s*\.workspace-header__utility \{\s*flex-wrap: wrap;/);
  });

  it("does not shrink the tab strip to buy the room", () => {
    // Tried and rejected: min-width:0 on a flex:1 strip collapsed the eight
    // primary labels to a few pixels each.
    assert.doesNotMatch(css, /\.workspace-tabs \{\s*min-width: 0;/);
  });

  it("introduces no 768px breakpoint", () => {
    const widths = new Set([...css.matchAll(/@media \([^)]*?(\d+)px\)/g)].map((m) => Number(m[1])));
    assert.equal(widths.has(768), false, "768px is not one of this stylesheet's widths");
  });
});
