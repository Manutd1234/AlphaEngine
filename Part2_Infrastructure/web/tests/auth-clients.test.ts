/**
 * Two Supabase clients, and the store each of them writes to.
 *
 * This is the first of the hazards that made the login worth guarding
 * structurally: a second session-carrying client written into the tape client
 * would flip the browser's Postgres role from `anon` to `authenticated`, the
 * demo tape's `to anon` policy would stop applying, and the tape would go empty
 * while still reporting itself live. Nothing throws. Nothing turns red. The
 * panel simply has no rows in it.
 *
 * So the count of clients is asserted, not assumed, and each client's options
 * are pinned to the role it is meant to hold. The remember-me suite below is
 * the same argument one level down: which *store* a session lands in is a
 * choice about storage, never an excuse for a third client.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_AUTH_PERSISTENCE, isAuthPersistence } from "../lib/auth-storage";

import { authClientSource, card, code, screen, session, storage, submitSource, tapeClient } from "./helpers/auth-sources";

describe("the tape client never learns to hold a session", () => {
  it("stays anonymous, so the demo tape keeps its policy", () => {
    // The demo tape reads through a `to anon` policy. A session on THIS client
    // would switch the role to `authenticated`, that policy would stop
    // applying, and the tape would go empty while still reporting "live".
    assert.match(tapeClient, /persistSession:\s*false/);
    assert.match(tapeClient, /autoRefreshToken:\s*false/);
    assert.doesNotMatch(code(tapeClient), /flowType|storageKey|signIn/);
  });

  it("the auth client is the only one that persists, under its own key", () => {
    assert.match(authClientSource, /persistSession:\s*true/);
    assert.match(authClientSource, /autoRefreshToken:\s*true/);
    assert.match(authClientSource, /flowType:\s*"pkce"/);
    // Two GoTrueClients on one origin collide over a shared storage slot. They
    // do not here, and the explicit key is what guarantees it.
    assert.match(authClientSource, /storageKey:\s*AUTH_STORAGE_KEY/);
  });

  it("exactly two clients exist in the web app", () => {
    const files = [tapeClient, authClientSource, screen, card, submitSource, session, storage];
    const constructions = files.reduce(
      (total, source) => total + (code(source).match(/createClient\(/g)?.length ?? 0),
      0,
    );
    assert.equal(constructions, 2, "a third Supabase client would fight over auth storage");
  });

  it("reads the public variables statically", () => {
    // Next substitutes `process.env.NEXT_PUBLIC_*` textually at build time, so
    // a computed lookup is undefined in the browser bundle.
    assert.match(code(authClientSource), /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(code(authClientSource), /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.doesNotMatch(code(authClientSource), /process\.env\[/);
  });

  it("never names the service-role key", () => {
    assert.doesNotMatch(code(authClientSource + screen + card + submitSource + session + storage), /SERVICE_ROLE/);
  });
});

describe("remember me chooses a store, not a second client", () => {
  it("defaults to surviving the tab", () => {
    assert.equal(DEFAULT_AUTH_PERSISTENCE, "local");
    assert.ok(isAuthPersistence("session"));
    assert.ok(!isAuthPersistence("forever"));
  });

  it("routes reads and writes through whichever store is marked", () => {
    assert.match(code(storage), /sessionStorage/);
    assert.match(code(storage), /localStorage/);
    // The marker itself is a preference about sessions, so it outlives them.
    assert.match(code(storage), /localStorage\.getItem\(AUTH_PERSIST_KEY\)/);
  });

  it("clears both stores on removal", () => {
    // The marker can change between sign-in and sign-out. A token left in the
    // store we stopped reading is a session nobody can see or end.
    const removeBlock = code(storage).slice(code(storage).indexOf("removeItem(key: string)"));
    assert.match(removeBlock, /localStorage\.removeItem/);
    assert.match(removeBlock, /sessionStorage\.removeItem/);
  });

  it("guards every access twice", () => {
    assert.match(storage, /typeof window === "undefined"/);
    assert.match(storage, /catch/);
  });
});
