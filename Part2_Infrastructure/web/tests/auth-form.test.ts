/**
 * The form itself: the controls the desk asked for, and the deployment that
 * has no Supabase at all.
 *
 * Two structural hazards live here. The first is a build-time one — CI builds
 * this app with zero environment variables and prerenders every route, this one
 * included, so an unconfigured login must render an honest state rather than
 * throw. The second is an ordering one: persistence is chosen *before* the
 * session is minted, because a token minted first lands in whichever store was
 * last marked, and a "remember me" that silently did nothing is worse than one
 * that is not offered.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { card, code, screen, submitSource } from "./helpers/auth-sources";
import { readSource } from "./helpers/source-files";

describe("the login page survives a deployment with no Supabase", () => {
  it("renders an honest unconfigured state instead of throwing", () => {
    // CI builds this app with zero environment variables and prerenders every
    // route, this one included.
    assert.match(code(screen), /authConfigured\(\)/);
    assert.match(screen, /not configured in this deployment/i);
  });

  it("the account chip disappears rather than offering a dead link", () => {
    const chip = readSource("components/header/AccountChip.tsx");
    assert.match(code(chip), /status === "unconfigured"\) return null/);
  });
});

describe("the form carries the controls the desk asked for", () => {
  it("has a show-password toggle that announces its state", () => {
    assert.match(code(card), /aria-pressed=\{showPassword\}/);
    assert.match(code(card), /showPassword \? "text" : "password"/);
  });

  it("has remember me, create account and forgot password", () => {
    assert.match(code(card), /id="auth-remember"/);
    // "Create account" is the mode table's submit label AND the footer's switch
    // button; both left the screen, so both are read where they landed.
    assert.match(readSource("components/auth/login-copy.ts"), /Create account/);
    assert.match(card, /Create account/);
    assert.match(card, /Forgot password\?/);
  });

  it("sets persistence before signing in, never after", () => {
    // Anchored on the exported function rather than on `const onSubmit`, which
    // no longer exists anywhere: `indexOf` would return -1 and `slice(-1)` would
    // measure one character across all three assertions below.
    const stripped = code(submitSource);
    const start = stripped.indexOf("export async function submitLogin");
    assert.notEqual(start, -1, "the submit path is gone — this check measures nothing");
    const submit = stripped.slice(start);
    const persistIndex = submit.indexOf("setAuthPersistence");
    const signInIndex = submit.indexOf("signInWithPassword");
    assert.ok(
      persistIndex > 0 && persistIndex < signInIndex,
      "a session minted before the store is chosen lands in the wrong one",
    );
  });
});
