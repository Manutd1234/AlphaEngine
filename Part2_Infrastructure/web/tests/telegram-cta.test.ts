/**
 * The header's one outbound link, and the states it must not hide.
 *
 * Three things about it are easy to get wrong in ways that only show up in
 * production:
 *
 *  - reading the bot username from a build-time `NEXT_PUBLIC_*` inline, which
 *    cannot change without a redeploy and drifts from the bot actually running.
 *    The handle now comes from the gateway's own /telegram/health, which is
 *    where the live username already was;
 *  - rendering a link when nobody has configured a bot — an anchor that opens a
 *    t.me 404 while looking exactly like a working one;
 *  - answering "no bot" by rendering nothing, which is the shape
 *    `no-dead-ends.test.ts` bans: a chip that vanishes is indistinguishable
 *    from a header that failed to mount.
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
 * exists to build.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const cta = read("../components/header/TelegramCta.tsx");
const route = read("../app/api/telegram/link/route.ts");
const header = read("../components/WorkspaceHeader.tsx");
const envExample = read("../.env.example");

describe("the Telegram button names the bot that is actually running", () => {
  it("asks the gateway rather than a build-time inline", () => {
    // The username is already on the wire: the gateway publishes it on
    // /telegram/health, and main.py proxies TelegramBot.health() there.
    assert.match(code(route), /callGateway<TelegramHealth>\("\/telegram\/health"/);
    assert.doesNotMatch(code(cta), /process\.env\./, "the component must not read env at all");
  });

  it("keeps the environment variables as a fallback, not a dependency", () => {
    // A deployment with no gateway attached can still name its bot; a
    // deployment with one never has to remember to.
    assert.match(code(route), /TELEGRAM_BOT_USERNAME/);
    assert.match(code(route), /NEXT_PUBLIC_TELEGRAM_BOT_USERNAME/);
    // The gateway's answer is read first, so a stale env cannot win.
    assert.ok(
      code(route).indexOf("/telegram/health") < code(route).indexOf("NEXT_PUBLIC_TELEGRAM_BOT_USERNAME"),
      "the live handle must be preferred over the configured one",
    );
  });

  it("validates a handle that arrived over the network before putting it in a URL", () => {
    assert.match(code(route), /isBotHandle/);
    assert.match(read("../lib/telegram-link.ts"), /refusing to build a t\.me link from a handle that is not one/);
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

describe("no state renders nothing, and no state renders a link to nowhere", () => {
  it("never returns null", () => {
    // The rule from no-dead-ends.test.ts, asserted here too because this is the
    // component that violated it: every branch produces the same chip and says
    // which state it is in.
    assert.doesNotMatch(code(cta), /return null/);
  });

  it("only renders an anchor when there is an address to open", () => {
    assert.match(code(cta), /if \(!href\)/);
    assert.match(code(cta), /role="status"/);
  });

  it("says why it cannot connect, in words rather than by disappearing", () => {
    assert.match(code(cta), /label = "Unavailable"/);
    assert.match(cta, /No Telegram companion is reachable from this deployment/);
    // Every branch sets a description, and the description is what the label
    // and the tooltip both read from.
    assert.match(code(cta), /aria-label=\{description\}/);
  });
});

describe("the link leaves this origin safely", () => {
  it("opens a new tab without handing over the opener", () => {
    assert.match(code(cta), /target="_blank"/);
    assert.match(code(cta), /rel="noopener noreferrer"/);
  });

  it("carries a freshly minted single-use code, and degrades to the plain bot address", () => {
    assert.match(code(cta), /answer\?\.connect\?\.url \?\? \(handle \? `https:\/\/t\.me\/\$\{handle\}`/);
    assert.match(code(route), /deepLink\(handle, minted\.token\)/);
  });

  it("mints before the click rather than inside it", () => {
    // A fetch inside onClick cannot open a window without tripping a popup
    // blocker, and it would cost the anchor its middle-click and copy-address.
    assert.match(code(cta), /onPointerEnter=\{refreshIfStale\}/);
    assert.match(code(cta), /onFocus=\{refreshIfStale\}/);
    assert.doesNotMatch(code(cta), /onClick=/);
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
    assert.match(code(cta), /aria-label=\{description\}/);
  });
});
