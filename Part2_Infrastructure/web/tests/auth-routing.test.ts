/**
 * Sign-in first, and the four ways that could go wrong quietly.
 *
 *  1. **The desk served ungated.** If the guard stops matching `/dashboard`, the
 *     workspace is handed to anyone and nothing errors — the regression is
 *     invisible except by asking.
 *  2. **Everyone locked out.** A deployment with no Supabase credentials can
 *     never mint a session, so a naive `no cookie -> /login` guard sends every
 *     visitor to a form that cannot help. Green build, dead product.
 *  3. **The callback moved to the server.** A route handler receiving `?code=…`
 *     cannot complete a PKCE exchange, because the verifier is in browser
 *     storage. It would still work for `token_hash` links, so it fails for
 *     exactly the links OAuth and the default magic-link template produce.
 *  4. **An open redirector.** `?next=` is attacker-controlled, and a link that
 *     genuinely signs someone in before forwarding them elsewhere is an
 *     unusually effective phish.
 *
 * The guard is driven directly rather than over HTTP, because the interesting
 * case — auth configured AND no cookie — cannot be produced against a dev server
 * that has no Supabase credentials.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";

import proxy, { config } from "../proxy";
import { DESK_COOKIE, isGuest } from "../lib/desk-cookie";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ORIGIN = "https://alphaengine.example";

const request = (path: string, cookie?: string) => {
  const req = new NextRequest(new URL(path, ORIGIN));
  if (cookie) req.cookies.set(DESK_COOKIE, cookie);
  return req;
};

/** The env the guard reads to decide whether auth exists at all. */
const configureAuth = (on: boolean) => {
  if (on) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
};

describe("the desk is behind the guard", () => {
  beforeEach(() => configureAuth(true));

  it("sends a visitor with no pass to sign in", () => {
    const response = proxy(request("/dashboard"));
    assert.equal(response.status, 307);
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.pathname, "/login");
  });

  it("guards every dashboard sub-path and the profile", () => {
    for (const path of ["/dashboard", "/dashboard/anything", "/profile", "/profile/security"]) {
      const response = proxy(request(path));
      assert.equal(
        new URL(response.headers.get("location") ?? `${ORIGIN}/`).pathname,
        "/login",
        `${path} was not guarded`,
      );
    }
  });

  it("lets a visitor with a pass straight through", () => {
    const response = proxy(request("/dashboard", "8f1c-user-id"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  });

  it("remembers where they were going, fragment included", () => {
    /**
     * A fragment does NOT survive a trip to an OAuth provider — the browser drops
     * it at the first hop — so a deep link like /dashboard#research/codex has to
     * be carried as data and reapplied by the callback.
     */
    const response = proxy(request("/dashboard#research/codex"));
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("next"), "/dashboard#research/codex");
  });

  it("does not add a next param for the plain dashboard", () => {
    // Noise in the URL bar for no gain: the callback's default is /dashboard.
    const response = proxy(request("/dashboard"));
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("next"), null);
  });
});

describe("the root always shows sign-in", () => {
  it("sends everyone to /login, pass or no pass", () => {
    /**
     * This used to forward a visitor holding a pass to /dashboard, and that is
     * the behaviour being deliberately removed. The pass has no expiry, so it
     * survives until the browser is fully closed — and "continue where you left
     * off" keeps session cookies across restarts — so the shared link landed on
     * the desk indefinitely after a single guest entry. Whether the entry point
     * showed a sign-in page depended on the reader's browser state rather than on
     * anything this app decides, which is the opposite of a deterministic landing.
     */
    configureAuth(true);
    for (const cookie of [undefined, "8f1c-user-id", "guest:abc"]) {
      const response = proxy(request("/", cookie));
      assert.equal(
        new URL(response.headers.get("location")!).pathname,
        "/login",
        `root with cookie=${cookie ?? "none"} did not land on sign-in`,
      );
    }
  });

  it("does not bounce a deep link that already has a pass", () => {
    // The other half of the rule. Bouncing /dashboard would break every link the
    // desk shares of itself and leave nowhere for "Continue as guest" to land.
    const response = proxy(request("/dashboard#research/codex", "user-id"));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
  });

  it("carries the query string across the hop", () => {
    configureAuth(true);
    const response = proxy(request("/?step=verify", "user-id"));
    const location = new URL(response.headers.get("location")!);
    assert.equal(location.searchParams.get("step"), "verify");
  });
});

describe("a deployment with no auth is not locked out", () => {
  beforeEach(() => configureAuth(false));

  it("grants a guest pass instead of bouncing to a form that cannot help", () => {
    /**
     * The failure this exists to prevent: the public workspace has no Supabase
     * credentials, so no session can ever exist there. A guard that redirected
     * anyway would put every visitor in front of a sign-in page with no way
     * through — and it would pass every test that only checked "no cookie
     * redirects".
     */
    const response = proxy(request("/dashboard"));
    assert.equal(response.status, 200, "an unconfigured deployment must not redirect");
    const set = response.cookies.get(DESK_COOKIE);
    assert.ok(set, "no guest pass was minted");
    assert.ok(isGuest(set.value), `pass is not a guest pass: ${set.value}`);
    assert.equal(set.httpOnly, true, "a page script must not be able to forge a pass");
    assert.equal(set.sameSite, "lax", "strict would drop the pass on the OAuth return hop");
  });

  it("still sends the root somewhere sensible", () => {
    // No cookie yet on the very first request, so this lands on /login — which
    // then explains that auth is unconfigured and offers the guest button.
    const response = proxy(request("/"));
    assert.equal(new URL(response.headers.get("location")!).pathname, "/login");
  });
});

describe("the guard runs where it must and nowhere it must not", () => {
  it("never matches the sign-in page, the callback, or any API route", () => {
    /**
     * A catch-all matcher with exclusions is the usual shape and the usual bug:
     * sweeping up /login redirects it to itself, and sweeping up /auth/callback
     * means the page that establishes the session never runs.
     */
    const patterns = config.matcher;
    for (const forbidden of ["/login", "/auth/callback", "/api/auth/session", "/_next/static/x.js"]) {
      for (const pattern of patterns) {
        const literal = pattern.replace("/:path*", "");
        assert.notEqual(literal, forbidden, `${forbidden} is matched by ${pattern}`);
        assert.ok(
          !(pattern.endsWith("/:path*") && forbidden.startsWith(`${literal}/`)),
          `${forbidden} falls under ${pattern}`,
        );
      }
    }
  });

  it("covers the root and both guarded trees", () => {
    for (const required of ["/", "/dashboard", "/dashboard/:path*", "/profile", "/profile/:path*"]) {
      assert.ok(config.matcher.includes(required), `matcher is missing ${required}`);
    }
  });
});

describe("the callback stays a client page", () => {
  it("is a page, not a route handler", () => {
    // A route.ts here would break every ?code= link and pass every type check.
    let handlerExists = true;
    try {
      readFileSync(fileURLToPath(new URL("../app/auth/callback/route.ts", import.meta.url)));
    } catch {
      handlerExists = false;
    }
    assert.equal(handlerExists, false, "a route handler cannot complete a PKCE exchange");
    assert.match(read("../app/auth/callback/page.tsx"), /export default function/);
  });

  it("runs in the browser, where the PKCE verifier is", () => {
    assert.match(read("../components/auth/AuthCallback.tsx"), /^"use client";/);
  });

  it("waits for the desk pass before leaving", () => {
    /**
     * Fire-and-forget here is a race that resolves as "bounced back to /login"
     * often enough to look like the link failing at random.
     */
    const source = read("../components/auth/AuthCallback.tsx");
    assert.match(source, /await fetch\("\/api\/auth\/session"/);
  });

  it("refuses an off-site next param", () => {
    const source = read("../components/auth/AuthCallback.tsx");
    // Both forms: an absolute URL and the protocol-relative one people forget.
    assert.match(source, /startsWith\("\/"\)/);
    assert.match(source, /startsWith\("\/\/"\)/);
  });
});

describe("nothing lands on the old desk route any more", () => {
  it("no auth surface redirects to /", () => {
    for (const file of [
      "../components/auth/LoginScreen.tsx",
      // The card and the submit path the screen was split into: an
      // `assign("/")` reintroduced in either is the same bug in the same flow.
      "../components/auth/LoginCard.tsx",
      "../lib/auth-submit.ts",
      "../components/auth/AuthCallback.tsx",
      "../components/profile/ProfileScreen.tsx",
    ]) {
      const source = read(file).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      assert.doesNotMatch(source, /assign\("\/"\)|replace\("\/"\)|href="\/"/,
        `${file} still points at the ungated root`);
    }
  });

  it("emailed session links come back through the callback", () => {
    const source = read("../components/auth/LoginScreen.tsx");
    assert.match(source, /origin\}\/auth\/callback/);
  });

  it("but recovery and confirmation links stay on the login form", () => {
    /**
     * A recovery link must land on a form that asks for a new password, and a
     * confirmation is an acknowledgement rather than a sign-in — routing either
     * through the callback would report "this link did not complete" for a link
     * that worked.
     */
    // Both live in `lib/auth-submit.ts` now — the reset link is emailed by the
    // "forgot" branch and the confirmation link by "signup", and both branches
    // left the screen component when the submit logic did.
    const source = read("../lib/auth-submit.ts");
    assert.match(source, /\$\{loginUrl\}\?step=reset/);
    assert.match(source, /\$\{loginUrl\}\?step=confirmed/);
  });
});

describe("the guest lane is a real way in", () => {
  it("mints the pass with a POST, not a link", () => {
    /**
     * A GET would be followed by every link prefetcher and crawler that touched
     * the sign-in page, so rendering the form would hand out guest passes.
     */
    const route = read("../app/api/auth/guest/route.ts");
    assert.match(route, /export async function POST/);
    assert.doesNotMatch(route, /export async function GET/);
    const screen = read("../components/auth/LoginScreen.tsx");
    /**
     * The method, not the shape of the options object. This pinned the whole
     * literal until the call gained a deadline, at which point it failed for a
     * reason that had nothing to do with the rule it exists to hold — which is
     * "POST, not a link". `deadlines.test.ts` owns the deadline itself.
     */
    assert.match(screen, /fetch\("\/api\/auth\/guest", \{\s*method: "POST"/);
  });

  it("seeds the sandbox from the id the cookie carries", () => {
    // Minting a second id here would give the guest a desk that disagrees with
    // their own cookie — two fictions for one visitor.
    assert.match(read("../components/auth/LoginScreen.tsx"), /alphaengine-desk-guest/);
    assert.match(read("../app/api/auth/guest/route.ts"), /id,/);
  });
});

describe("the sign-in page says what it is", () => {
  it("carries the brand lockup, shared with the header", () => {
    const screen = read("../components/auth/LoginScreen.tsx");
    assert.match(screen, /<BrandLockup/);
    // One component, two mounts: the old inline markup must be gone from the
    // header rather than copied.
    const header = read("../components/WorkspaceHeader.tsx");
    assert.match(header, /<BrandLockup/);
    assert.doesNotMatch(header, /brand-mark__alpha/);
  });

  it("no longer claims the desk is open to everyone", () => {
    /**
     * It was, and the sentence was true until this pass. Leaving it would be the
     * stale-assertion defect this repo keeps rediscovering — copy that describes
     * behaviour the code no longer has.
     */
    const screen = read("../components/auth/LoginScreen.tsx");
    assert.doesNotMatch(screen, /desk itself is open to everyone/);
    assert.doesNotMatch(screen, /workspace is fully browsable\s*\n?\s*without an account/);
  });
});

describe("a provider is only offered when it can complete", () => {
  it("offers nothing while the probe is still out", () => {
    /**
     * The fail-open this replaces sent people to a Supabase URL showing
     * "Unsupported provider: provider is not enabled". Because signInWithOAuth is
     * a full-page redirect, no in-page handler can rescue that — the only fix is
     * not to draw the button until the answer is known.
     */
    const screen = read("../components/auth/LoginScreen.tsx");
    assert.match(screen, /probePending/);
    assert.match(screen, /probeFailed \? PROVIDERS : \[\]/);
    // The old shape, which treated "still asking" and "asked and failed" alike.
    assert.doesNotMatch(screen, /enabledProviders\s*\n?\s*\? PROVIDERS\.filter[\s\S]{0,60}: PROVIDERS;/);
  });
});
