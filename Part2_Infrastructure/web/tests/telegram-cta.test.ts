/**
 * The header's one outbound link.
 *
 * Two things about it are easy to get wrong in ways that only show up in
 * production: reading the bot username dynamically (Next substitutes
 * `NEXT_PUBLIC_*` textually, so a computed lookup is undefined in the bundle),
 * and rendering the button when nobody has configured a bot — a link that opens
 * a t.me 404 while looking exactly like a working one.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Block comments only. The usual stripper in this suite also removes `//` to
 * end of line, which here would swallow the `https://t.me/...` the component
 * exists to build — and this file carries no line comments anyway, only the
 * doc header and JSX `{/* … *\/}` blocks.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const cta = read("../components/header/TelegramCta.tsx");
const header = read("../components/WorkspaceHeader.tsx");
const envExample = read("../.env.example");

describe("the Telegram button is honest about being unconfigured", () => {
  it("renders nothing without a username", () => {
    assert.match(code(cta), /if \(!BOT_USERNAME\) return null;/);
  });

  it("reads the username statically at module scope", () => {
    // A dynamic lookup resolves to undefined in the browser bundle — code that
    // reads correctly and fails only once deployed.
    assert.match(code(cta), /process\.env\.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME/);
    assert.doesNotMatch(code(cta), /process\.env\[/);
    const declaration = code(cta).indexOf("const BOT_USERNAME");
    const component = code(cta).indexOf("export default function");
    assert.ok(declaration > 0 && declaration < component, "the read must not sit inside the component");
  });

  it("documents the variable where someone deploying will look", () => {
    assert.match(envExample, /^NEXT_PUBLIC_TELEGRAM_BOT_USERNAME=$/m);
    assert.match(envExample, /Unset is safe/);
  });

  it("never names the bot token", () => {
    // The username is public; the token is the credential, and it belongs to
    // the gateway's env alone.
    assert.doesNotMatch(cta + envExample.slice(envExample.indexOf("TELEGRAM")), /TELEGRAM_BOT_TOKEN/);
  });
});

describe("the link leaves this origin safely", () => {
  it("opens a new tab without handing over the opener", () => {
    assert.match(code(cta), /target="_blank"/);
    assert.match(code(cta), /rel="noopener noreferrer"/);
  });

  it("carries the start payload the gateway already accepts", () => {
    assert.match(code(cta), /https:\/\/t\.me\/\$\{BOT_USERNAME\}\?start=auth/);
  });

  it("is a link, not a button that navigates", () => {
    // Anchors get the browser's own affordances — middle-click, copy address,
    // and the global :focus-visible ring — for free.
    assert.match(code(cta), /<a\s/);
  });
});

describe("the brand mark stays legible in both themes", () => {
  it("uses the darker brand blue behind the white glyph", () => {
    // White on #0088cc is 3.89:1, clearing the 3:1 bar for graphical objects.
    // On the lighter #229ED9 it is 3.02:1 — technically passing, and not worth
    // shipping that close to the line on a fixed, theme-invariant tile.
    assert.match(code(cta), /bg-\[#0088cc\]/);
    assert.doesNotMatch(code(cta), /bg-\[#229ED9\]/);
  });

  it("mixes the accent into theme tokens rather than hardcoding a surface", () => {
    // color-mix against var(--surface-1)/var(--border) is what lets one class
    // list work in light and dark without a dark: variant, which this project
    // forbids because it keys off the OS rather than the theme toggle.
    assert.match(cta, /color-mix\(in_srgb,#229ED9_[0-9]+%,var\(--surface-1\)\)/);
    assert.match(cta, /color-mix\(in_srgb,#229ED9_[0-9]+%,var\(--border\)\)/);
    // Comments stripped first: the rationale beside the class list names the
    // variant it is avoiding, and a raw scan would report the explanation.
    assert.doesNotMatch(code(cta), /\bdark:/);
  });

  it("explains both raw hexes where they are used", () => {
    // The house rule for the Tailwind bridge: a raw hex needs a comment saying
    // why the token system could not carry it.
    assert.match(cta, /3\.89:1/);
    assert.match(cta, /3\.02:1/);
  });
});

describe("it sits in the header without disturbing the nav", () => {
  it("is rendered once, from the header", () => {
    assert.equal((header.match(/<TelegramCta \/>/g) ?? []).length, 1);
  });

  it("leads the utility cluster rather than joining the tablist", () => {
    // Inside the tablist it would become a ninth tab to arrow through, and
    // NAV_ITEMS is asserted elsewhere to be exactly the eight workspaces.
    const spacer = header.indexOf('<div className="header-spacer" />');
    const cta_ = header.indexOf("<TelegramCta />");
    const tablist = header.indexOf('role="tablist"');
    assert.ok(tablist < spacer && spacer < cta_, "the CTA must follow the spacer, outside the tabs");
  });

  it("keeps its label only where the header has room", () => {
    // Same collapse band the other header chips use; the icon tile carries the
    // meaning below it, and the aria-label carries it for everyone.
    assert.match(code(cta), /max-\[1380px\]:hidden/);
    assert.match(code(cta), /aria-label="Open the AlphaEngine Telegram companion in a new tab"/);
  });
});
