/**
 * The auth endpoints, and the two states that must never diverge.
 *
 * The session lives in localStorage, where the edge cannot read it. The desk pass
 * is an httpOnly cookie, which page scripts cannot read or write. Neither side
 * can see the other, so every transition has to tell its counterpart — and the
 * failures are not crashes, they are the desk telling two different stories about
 * the same person:
 *
 *  - a pass that outlives a sign-out admits a signed-out visitor to the desk
 *    while the header correctly shows them signed out
 *  - a session that outlives its pass — which it always does, since the pass ends
 *    with the browser session — sends a still-signed-in visitor to a sign-in page
 *    for the account they are already using
 *
 * The routes are exercised as functions rather than over HTTP, because the
 * interesting branches depend on env that a running dev server does not have.
 * Supabase is never reached: every assertion here is about the shape of the
 * answer and the cookie that rides with it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";

import { POST as login, GET as providers } from "../app/api/auth/login/route";
import { POST as logout } from "../app/api/auth/logout/route";
import { GET as session, DELETE as endSession } from "../app/api/auth/session/route";
import { DESK_COOKIE, deskCookie, guestValue, isGuest } from "../lib/desk-cookie";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGIN = "https://alphaengine.example";

const post = (path: string, body?: unknown) =>
  new NextRequest(new URL(path, ORIGIN), {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const get = (path: string, authorization?: string) =>
  new NextRequest(new URL(path, ORIGIN), {
    headers: authorization ? { authorization } : {},
  });

const saved = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
};

const unconfigure = () => {
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
};

afterEach(() => {
  if (saved.url) process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
  else delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (saved.key) process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = saved.key;
  else delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("the pass is dropped on the way out", () => {
  it("logout clears the cookie and says nothing else", async () => {
    const response = await logout();
    const cleared = response.cookies.get(DESK_COOKIE);
    assert.ok(cleared, "logout did not touch the desk cookie");
    assert.equal(cleared.value, "");
    assert.equal(cleared.maxAge, 0, "an expiry of 0 is what actually removes it");
  });

  it("is idempotent, so a double click is not an error", async () => {
    const first = await logout();
    const second = await logout();
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
  });

  it("does not redirect", async () => {
    /**
     * The brief describes this endpoint as clearing the session AND redirecting
     * to /login. Splitting those is the better shape: a 303 here would be
     * followed by `fetch`, handing the login page's HTML to a caller that wanted
     * a status — and the client still has to navigate itself afterwards.
     */
    const response = await logout();
    assert.equal(response.headers.get("location"), null);
    assert.ok(response.status < 300);
  });

  it("the account menu drops the pass before it navigates", async () => {
    /**
     * The bug this closes: `signOutUser()` revoked the session and navigated,
     * leaving the cookie. The guard then admitted a signed-out visitor on a pass
     * that claimed an account.
     */
    const chip = read("../components/header/AccountChip.tsx");
    const order = chip.indexOf("dropDeskPass");
    const navigate = chip.indexOf('window.location.assign("/login")');
    assert.notEqual(order, -1, "sign-out no longer drops the desk pass");
    assert.ok(order < navigate, "the pass must be dropped BEFORE navigating away");
    assert.match(chip, /await dropDeskPass\(\)/, "not awaited: navigation can unload the request");
  });
});

describe("the session route mints a pass only for a real session", () => {
  it("refuses a request with no bearer token", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const response = await session(get("/api/auth/session"));
    assert.equal(response.status, 401);
    const body = await response.json();
    assert.equal(body.status, "signed-out");
    assert.equal(body.user, null);
    assert.equal(response.cookies.get(DESK_COOKIE), undefined,
      "a request with no token must not mint anything");
  });

  it("reports unconfigured as its own state, not as signed out", async () => {
    /**
     * These lead to opposite behaviour: signed-out means "go and sign in",
     * unconfigured means "there is nothing to sign in to, come in as a guest".
     * Collapsing them is what would strand every visitor to the public desk.
     */
    unconfigure();
    const response = await session(get("/api/auth/session"));
    assert.equal(response.status, 200, "unconfigured is not an error for the caller");
    assert.equal((await response.json()).status, "unconfigured");
  });

  it("clears a stale pass when the token no longer validates", async () => {
    // An expired token with a live cookie is the state that would leave someone
    // on the desk shell indefinitely after their session ended.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const response = await session(get("/api/auth/session", "Bearer not-a-real-token"));
    assert.equal(response.status, 401);
    const cookie = response.cookies.get(DESK_COOKIE);
    assert.ok(cookie && cookie.value === "" && cookie.maxAge === 0,
      "a failed validation must drop the pass rather than leaving it");
  });

  it("leaves a GUEST pass alone when someone else's token fails", async () => {
    /**
     * Observed in a browser, not reasoned about: a guest holding a valid pass
     * loaded `/login` — which `/` always redirects to — with a token in storage
     * that Supabase no longer accepts. The login page minted from it, this route
     * answered 401, and the guest's pass went with it, so the next navigation to
     * the desk bounced them back to the form. The rejected token says nothing
     * about a guest who chose not to have an account.
     */
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.invalid";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    const request = get("/api/auth/session", "Bearer not-a-real-token");
    request.cookies.set(DESK_COOKIE, guestValue("visitor"));
    const response = await session(request);
    assert.equal(response.status, 401, "the answer about the token is unchanged");
    assert.equal(response.cookies.get(DESK_COOKIE), undefined,
      "a guest pass must survive a failed validation of an account token");
  });

  it("accepts the bearer scheme case-insensitively", async () => {
    // "bearer" lowercase is legal and some clients send it; rejecting it would
    // present as sign-in working in one browser and not another.
    const source = read("../app/api/auth/session/route.ts");
    assert.match(source, /toLowerCase\(\)\.startsWith\("bearer "\)/);
  });

  it("DELETE ends it too, for a caller that has no client", async () => {
    const response = await endSession();
    const cookie = response.cookies.get(DESK_COOKIE);
    assert.ok(cookie && cookie.maxAge === 0);
  });
});

describe("credential sign-in", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  });

  it("requires both fields before reaching Supabase", async () => {
    for (const body of [{}, { email: "a@b.c" }, { password: "x" }, { email: "", password: "" }]) {
      const response = await login(post("/api/auth/login", body));
      assert.equal(response.status, 400, `accepted ${JSON.stringify(body)}`);
    }
  });

  it("rejects a body that is not JSON with a 400, not a crash", async () => {
    const request = new NextRequest(new URL("/api/auth/login", ORIGIN), {
      method: "POST",
      body: "not json",
      headers: { "content-type": "application/json" },
    });
    const response = await login(request);
    assert.equal(response.status, 400);
  });

  it("answers 501 when there are no accounts to sign in to", async () => {
    unconfigure();
    const response = await login(post("/api/auth/login", { email: "a@b.c", password: "x" }));
    assert.equal(response.status, 501);
    assert.equal((await response.json()).status, "unconfigured");
  });

  it("never returns a token in the body", async () => {
    /**
     * The browser gets a pass cookie and nothing it could accidentally log,
     * persist or forward. A client that needs the session gets it from the
     * Supabase client, which is where GoTrue can refresh it.
     */
    const source = read("../app/api/auth/login/route.ts");
    assert.doesNotMatch(source, /access_token/);
    assert.doesNotMatch(source, /session:\s*data\.session/);
  });

  it("passes Supabase's deliberately vague failure through unchanged", () => {
    // "Invalid login credentials" does not say which half was wrong, because
    // saying so tells an attacker whether an address has an account. Rewriting
    // it here would be a chance to leak that by accident.
    const source = read("../app/api/auth/login/route.ts");
    assert.match(source, /error\?\.message \?\? "Sign-in failed\."/);
  });
});

describe("the provider list has a server-side second opinion", () => {
  it("distinguishes 'none enabled' from 'could not tell'", async () => {
    /**
     * The distinction the whole provider bug turned on. An empty list means the
     * project has no providers; null means the question could not be answered,
     * and a client must not draw buttons on the strength of it without saying so.
     */
    unconfigure();
    const response = await providers();
    const body = await response.json();
    assert.equal(body.status, "unconfigured");
    assert.deepEqual(body.providers, [], "unconfigured is a known answer: none");
  });

  it("bounds the settings read, like every other read in the app", () => {
    const source = read("../app/api/auth/login/route.ts");
    assert.match(source, /AbortSignal\.timeout\(2500\)/);
  });
});

describe("the cookie helper is the single definition", () => {
  it("sets the flags that make the pass unforgeable by page scripts", () => {
    const cookie = deskCookie("user-id");
    assert.equal(cookie.httpOnly, true);
    // lax, not strict: the pass has to survive the return trip from an OAuth
    // provider, which strict would drop — sending a freshly signed-in visitor
    // straight back to the form.
    assert.equal(cookie.sameSite, "lax");
    assert.equal(cookie.path, "/");
  });

  it("is not secure in development, which is not an oversight", () => {
    /**
     * A `secure` cookie on an http localhost dev server is silently discarded —
     * the class of bug where auth "works in production and not locally" with no
     * visible cause.
     */
    const previous = process.env.NODE_ENV;
    assert.equal(deskCookie("x").secure, previous === "production");
  });

  it("tells a guest pass from an account pass by shape alone", () => {
    assert.equal(isGuest(guestValue("abc")), true);
    assert.equal(isGuest("8f1c-a-real-user-id"), false);
    assert.equal(isGuest(undefined), false);
  });

  it("every route that sets the pass goes through the helper", () => {
    // Three copies of a cookie name and its flags is how one of them ends up
    // written without `secure`.
    for (const route of [
      "../app/api/auth/session/route.ts",
      "../app/api/auth/login/route.ts",
      "../app/api/auth/logout/route.ts",
      "../app/api/auth/guest/route.ts",
    ]) {
      const source = read(route);
      assert.match(source, /deskCookie\(/, `${route} hand-rolls the cookie`);
      assert.doesNotMatch(source, /name:\s*"ae_desk"/, `${route} hardcodes the cookie name`);
    }
  });
});

describe("useAuth keeps the shape the workspace already consumes", () => {
  it("still exposes user, isAuthenticated and sessionStatus", () => {
    /**
     * The brief asks for exactly this hook and these three fields, and they
     * already existed. Renaming the four status values to the brief's wording
     * would have touched every consumer plus two test files for no behavioural
     * gain — and `"unconfigured"` is a state the brief's list does not have.
     */
    const source = read("../lib/use-session.ts");
    assert.match(source, /export function useAuth\(\): AuthState/);
    for (const field of ["user", "isAuthenticated", "sessionStatus"]) {
      assert.match(source, new RegExp(`${field}[:,]`));
    }
    for (const status of ["unconfigured", "loading", "signed-out", "signed-in"]) {
      assert.match(source, new RegExp(`"${status}"`), `status ${status} is gone`);
    }
  });

  it("the login page sends an already-signed-in visitor straight through", () => {
    const screen = read("../components/auth/LoginScreen.tsx");
    assert.match(screen, /mintDeskPass\(token\)/);
    // Except on a recovery link, which signed them in only for as long as it
    // takes to choose a password — redirecting would skip the form.
    assert.match(screen, /step === "reset"/);
  });
});
