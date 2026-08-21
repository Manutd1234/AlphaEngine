/**
 * Signing out — leaving, in the right order, and staying gone.
 *
 * Sign-out is the one auth action whose failures all look like success. The
 * chip flips to "Sign in" and the page stays where it was; the token is revoked
 * but the debounced preference write never lands; the departing account's
 * in-flight preference pull returns after the UI says you are signed out and
 * applies their theme, their detail level and their last-open tab to whoever is
 * sitting there now.
 *
 * So the ordering is the assertion, not the outcome. Flush the pending write,
 * then await the sign-out, then navigate — each step before the one that would
 * make it impossible. And every pull is stamped with the session generation it
 * started in, so an answer that outlived its session is dropped rather than
 * applied.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { code } from "./helpers/auth-sources";
import { readSource } from "./helpers/source-files";

describe("signing out actually leaves, and in the right order", () => {
  const chip = readSource("components/header/AccountChip.tsx");

  it("navigates to the login page", () => {
    // The reported bug: the chip flipped to "Sign in" and the browser stayed on
    // whichever tab you were reading. On a dense dashboard that signal is far
    // too quiet to notice, and it reads as sign-out having failed.
    assert.match(code(chip), /window\.location\.assign\("\/login"\)/);
  });

  it("awaits the sign-out before navigating", () => {
    // The assertion that matters. GoTrue removes the stored session only after
    // its server round-trip, so `void signOutUser(); location.assign(...)`
    // can unload the document mid-flight and leave the token in storage — the
    // browser comes back signed in, having just been told otherwise.
    const handler = code(chip).slice(code(chip).indexOf("setSigningOut(true)"));
    const awaited = handler.indexOf("await signOutUser()");
    const navigate = handler.indexOf('window.location.assign("/login")');
    assert.ok(awaited > 0, "sign-out must be awaited, not fired and forgotten");
    assert.ok(navigate > awaited, "the navigation must follow the awaited sign-out");
    assert.doesNotMatch(handler, /void signOutUser\(\)/);
  });

  it("flushes the pending preference write first", () => {
    // Preference pushes are debounced, and sign-out drops the timer. Changing
    // the theme and signing out within that window would keep the change
    // locally and never send it — sync that looks like it worked.
    const handler = code(chip).slice(code(chip).indexOf("setSigningOut(true)"));
    const flush = handler.indexOf("await flushPendingPrefs()");
    const signOut = handler.indexOf("await signOutUser()");
    assert.ok(flush > 0, "the pending write must be flushed");
    assert.ok(flush < signOut, "flush before the token is revoked, not after");
  });

  it("cannot be fired twice", () => {
    assert.match(code(chip), /disabled=\{signingOut\}/);
    assert.match(code(chip), /if \(signingOut\) return;/);
  });

  it("does not navigate from the session module", () => {
    // use-session is imported by the headless preference engine, which must
    // never be able to redirect anyone.
    const session = readSource("lib/use-session.ts");
    assert.doesNotMatch(code(session), /location\.(assign|replace|href)/);
  });
});

describe("an abandoned account cannot keep writing", () => {
  const prefs = readSource("lib/user-prefs.ts");

  it("stamps each pull with the session generation", () => {
    assert.match(code(prefs), /let generation = 0;/);
    assert.match(code(prefs), /const startedAt = generation;/);
  });

  it("drops a pull that outlived its session", () => {
    // Without this the in-flight round-trip still applies the departed
    // account's theme, detail level and last-open tab, and stamps their id as
    // the last user — all after the UI says you are signed out.
    assert.match(code(prefs), /if \(startedAt !== generation\) return;/);
    const guard = code(prefs).indexOf("startedAt !== generation");
    const apply = code(prefs).indexOf("applyRemoteValue(key, value)");
    const stamp = code(prefs).indexOf("setItem(PREF_LAST_USER_KEY");
    assert.ok(guard < apply, "the guard must precede applying remote values");
    assert.ok(guard < stamp, "the guard must precede stamping the last user");
  });

  it("bumps the generation on every session change", () => {
    const onSession = code(prefs).slice(code(prefs).indexOf("function onSession"));
    assert.match(onSession.slice(0, 400), /generation \+= 1;/);
  });

  it("clears the dirty flag on sign-out", () => {
    // A stale flag would make the next sign-in believe it had a failed write
    // to retry, for an account that is no longer here.
    const signedOut = code(prefs).slice(code(prefs).indexOf("if (!next) {"));
    assert.match(signedOut.slice(0, 400), /dirty = false;/);
  });

  it("still keeps local values and the last-user marker", () => {
    // Signing out is leaving an account, not asking the browser to forget the
    // theme; and the marker is what lets the NEXT account's remote win.
    const signedOut = code(prefs).slice(code(prefs).indexOf("if (!next) {"));
    assert.doesNotMatch(signedOut.slice(0, 400), /removeItem|clear\(\)/);
  });
});
