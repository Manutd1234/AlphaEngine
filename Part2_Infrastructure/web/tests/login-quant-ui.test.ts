import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const card = read("components/auth/LoginCard.tsx");
const screen = read("components/auth/LoginScreen.tsx");
const manifest = read("app/globals.css");

describe("the access portal uses the reviewed source-owned control system", () => {
  it("composes the configured form from shadcn primitives", () => {
    for (const name of ["Alert", "Button", "Card", "Checkbox", "Input", "Label", "Separator"]) {
      assert.match(card, new RegExp(`\\b${name}\\b`), `${name} is absent from the configured login card`);
    }
    assert.match(card, /from "@\/components\/ui\/alert"/);
    assert.match(card, /from "@\/components\/ui\/button"/);
    assert.match(card, /from "@\/components\/ui\/card"/);
    assert.match(card, /from "@\/components\/ui\/checkbox"/);
    assert.match(card, /from "@\/components\/ui\/input"/);
    assert.match(card, /from "@\/components\/ui\/label"/);
    assert.match(card, /from "@\/components\/ui\/separator"/);
    assert.doesNotMatch(card, /<input\b|<label\b/);
  });

  it("uses the same primitive language for guest-only deployments", () => {
    assert.match(screen, /from "@\/components\/ui\/alert"/);
    assert.match(screen, /from "@\/components\/ui\/button"/);
    assert.match(screen, /from "@\/components\/ui\/card"/);
    assert.doesNotMatch(screen, /<button\b/);
  });
});

describe("the migrated form keeps its operational and accessibility contracts", () => {
  it("discloses the active mode and busy state without changing auth logic", () => {
    assert.match(card, /data-auth-mode=\{mode\}/);
    assert.match(card, /aria-busy=\{busy\}/);
    assert.match(card, /autoComplete="username"/);
    assert.match(card, /autoComplete=\{mode === "signin" \? "current-password" : "new-password"\}/);
    assert.match(card, /aria-controls="auth-password"/);
  });

  it("retains the stable provider region and a labelled separator", () => {
    assert.match(card, /className="auth-providers" role="status" aria-live="polite"/);
    assert.match(card, /<Separator[^>]*aria-hidden="true"/s);
    assert.match(card, /className="auth-provider-separator__label\b/);
    assert.match(card, /className="auth-providers__options flex flex-col gap-2"/);
  });

  it("does not add marketing claims or imply a real order path", () => {
    const combined = `${screen}\n${card}`;
    assert.doesNotMatch(combined, /AI-powered|seamless|revolutionary|guaranteed returns|live trading/i);
    assert.match(combined, /Nothing is shared between guests, and no order\s+reaches a real venue/);
  });
});

describe("the access portal reads as an AlphaEngine surface", () => {
  it("loads a scoped late quant-UI layer without disturbing the trailing contract", () => {
    assert.match(manifest, /@import "\.\/globals\/14kk-login-quant-ui\.css";/);
    const css = read("app/globals/14kk-login-quant-ui.css");
    for (const selector of [
      ".auth-shell::before",
      ".card.auth-card",
      ".auth-provider-separator",
      ".auth-card .primary-action",
      ".auth-guest",
    ]) {
      assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(css, /@media \(max-width: 620px\)/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, "the login layer must consume house tokens");
  });

  it("keeps the portal copy operational rather than promotional", () => {
    const combined = `${screen}\n${card}`;
    assert.match(combined, /same live-data workspace/);
    assert.match(combined, /no generated values are substituted/);
    assert.match(combined, /preferences stay on this device/);
    assert.doesNotMatch(combined, /unlock|next-generation|effortless|world-class/i);
  });
});
