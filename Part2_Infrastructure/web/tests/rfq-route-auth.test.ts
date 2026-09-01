/**
 * The private RFQ proxy has two credentials and must not confuse them.
 *
 * The gateway token authorizes this deployment to call the risk gateway. It
 * does not authorize an arbitrary browser to spend a signed Kalshi read or see
 * the account-private answer. These tests pin the missing boundary: Supabase
 * proves the browser account before the first gateway fetch is dispatched.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GET } from "../app/api/gateway/coherence/rfq/route";
import { rfqAuthorizationHeaders, shouldDiscardRfqSnapshot } from "../lib/coherence/rfq-auth";
import { RFQ_DESK_ID } from "../lib/rfq-server-auth";

const WEB_ORIGIN = "https://alphaengine.example";
const SUPABASE_ORIGIN = "https://project.supabase.co";
const GATEWAY_ORIGIN = "http://gateway.example";
const ACCOUNT_ID = "1e81b521-6d29-4bf6-bc81-54cc74df0f2f";

const PANEL = {
  state: "available",
  detail: "One account-visible request.",
  signing_environment: "production",
  open_requests: 1,
  dispersions: [{ market_ticker: "KXTEST", makers: 2, spread: "0.03", thin: false }],
};

const saved = {
  fetch: globalThis.fetch,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  gatewayUrl: process.env.ALPHAENGINE_GATEWAY_URL,
  recoveryUrl: process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL,
  gatewayToken: process.env.ALPHAENGINE_GATEWAY_TOKEN,
  vercel: process.env.VERCEL,
};

function restore(name: keyof NodeJS.ProcessEnv, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function request(authorization?: string, cookie?: string): Request {
  return new Request(`${WEB_ORIGIN}/api/gateway/coherence/rfq`, {
    headers: {
      ...(authorization ? { authorization } : {}),
      ...(cookie ? { cookie } : {}),
    },
  });
}

function urlOf(input: RequestInfo | URL): URL {
  if (input instanceof Request) return new URL(input.url);
  return new URL(String(input));
}

function userPayload() {
  const now = "2026-09-01T00:00:00.000Z";
  return {
    id: ACCOUNT_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "reader@example.com",
    email_confirmed_at: now,
    phone: "",
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

interface FetchProbe {
  authCalls: number;
  authAuthorization: string | null;
  membershipCalls: number;
  membershipAuthorization: string | null;
  membershipUrl: string | null;
  gatewayCalls: number;
  gatewayUserAuthorization: string | null;
  gatewayAuthorization: string | null;
  gatewayCookie: string | null;
}

type MembershipAnswer = "active" | "absent" | "error";

function installFetchProbe(validToken: boolean, membership: MembershipAnswer = "active"): FetchProbe {
  const probe: FetchProbe = {
    authCalls: 0,
    authAuthorization: null,
    membershipCalls: 0,
    membershipAuthorization: null,
    membershipUrl: null,
    gatewayCalls: 0,
    gatewayUserAuthorization: null,
    gatewayAuthorization: null,
    gatewayCookie: null,
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = urlOf(input);
    if (url.origin === SUPABASE_ORIGIN && url.pathname === "/auth/v1/user") {
      probe.authCalls += 1;
      probe.authAuthorization = new Headers(init?.headers).get("authorization");
      return validToken
        ? Response.json(userPayload())
        : Response.json({ code: "bad_jwt", msg: "invalid JWT" }, { status: 401 });
    }
    if (url.origin === SUPABASE_ORIGIN && url.pathname === "/rest/v1/desk_risk_limits") {
      probe.membershipCalls += 1;
      probe.membershipAuthorization = new Headers(init?.headers).get("authorization");
      probe.membershipUrl = url.href;
      if (membership === "error") {
        return Response.json({
          code: "42P01",
          details: null,
          hint: null,
          message: "relation does not exist",
        }, { status: 500 });
      }
      return Response.json(membership === "active" ? [{ desk_id: RFQ_DESK_ID }] : []);
    }
    if (url.origin === GATEWAY_ORIGIN && url.pathname === "/api/coherence/rfq") {
      probe.gatewayCalls += 1;
      const headers = new Headers(init?.headers);
      probe.gatewayAuthorization = headers.get("X-AlphaEngine-Token");
      probe.gatewayUserAuthorization = headers.get("authorization");
      probe.gatewayCookie = headers.get("cookie");
      return Response.json(PANEL);
    }
    throw new Error(`unexpected fetch ${url.href}`);
  }) as typeof globalThis.fetch;
  return probe;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_ORIGIN;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.ALPHAENGINE_GATEWAY_URL = GATEWAY_ORIGIN;
  process.env.ALPHAENGINE_GATEWAY_TOKEN = "gateway-token";
  delete process.env.ALPHAENGINE_GATEWAY_PUBLIC_URL;
  delete process.env.VERCEL;
});

afterEach(() => {
  globalThis.fetch = saved.fetch;
  restore("NEXT_PUBLIC_SUPABASE_URL", saved.supabaseUrl);
  restore("NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.supabaseKey);
  restore("ALPHAENGINE_GATEWAY_URL", saved.gatewayUrl);
  restore("ALPHAENGINE_GATEWAY_PUBLIC_URL", saved.recoveryUrl);
  restore("ALPHAENGINE_GATEWAY_TOKEN", saved.gatewayToken);
  restore("VERCEL", saved.vercel);
});

describe("the RFQ proxy authenticates before spending a gateway read", () => {
  it("refuses a missing bearer without contacting Supabase or the gateway", async () => {
    const probe = installFetchProbe(true);
    const response = await GET(request());
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("vary"), "Authorization");
    assert.equal(body.code, "rfq_auth_required");
    assert.equal(probe.authCalls, 0, "a request with no token has nothing for Supabase to verify");
    assert.equal(probe.membershipCalls, 0);
    assert.equal(probe.gatewayCalls, 0, "an unauthenticated caller spent a signed RFQ read");
  });

  it("does not treat a guest desk cookie as account authorization", async () => {
    const probe = installFetchProbe(true);
    const response = await GET(request(undefined, "ae_desk=guest:dbf77d3c-f76f-4af4-8759-f92c2acfb7a8"));

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "rfq_auth_required");
    assert.equal(probe.authCalls, 0);
    assert.equal(probe.membershipCalls, 0);
    assert.equal(probe.gatewayCalls, 0, "a guest pass reached the account-private gateway read");
  });

  it("rejects an invalid bearer after Supabase, before the gateway", async () => {
    const probe = installFetchProbe(false);
    const response = await GET(request("Bearer expired-token"));
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "rfq_auth_invalid");
    assert.equal(body.dispersions, undefined, "a refusal included private venue rows");
    assert.equal(probe.authCalls, 1, "the token was not checked with Supabase");
    assert.equal(probe.membershipCalls, 0, "an invalid identity reached the desk membership table");
    assert.equal(probe.gatewayCalls, 0, "an invalid session still spent a signed RFQ read");
  });

  it("fails closed when account verification is not configured", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const probe = installFetchProbe(true);
    const response = await GET(request("Bearer any-token"));

    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "rfq_auth_not_configured");
    assert.equal(probe.authCalls, 0);
    assert.equal(probe.membershipCalls, 0);
    assert.equal(probe.gatewayCalls, 0, "an auth-unconfigured deployment called the private gateway route");
  });

  it("returns 403 to an authenticated non-member without contacting the gateway", async () => {
    const probe = installFetchProbe(true, "absent");
    const response = await GET(request("Bearer valid-nonmember-token"));
    const body = await response.json();

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("www-authenticate"), null,
      "a valid identity with insufficient authority was mislabeled as signed out");
    assert.equal(body.code, "rfq_auth_membership_required");
    assert.equal(body.dispersions, undefined);
    assert.equal(probe.authCalls, 1);
    assert.equal(probe.membershipCalls, 1);
    assert.equal(probe.gatewayCalls, 0, "an authenticated stranger spent a private venue read");
  });

  it("fails closed when the authoritative membership lookup faults", async () => {
    const probe = installFetchProbe(true, "error");
    const response = await GET(request("Bearer valid-member-token"));

    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "rfq_auth_membership_unavailable");
    assert.equal(probe.authCalls, 1);
    assert.equal(probe.membershipCalls, 1);
    assert.equal(probe.gatewayCalls, 0, "an unreadable membership roster was treated as permission");
  });

  it("forwards the private panel only after Supabase verifies an active desk member", async () => {
    const probe = installFetchProbe(true, "active");
    const response = await GET(request(
      "bEaReR valid-token",
      "ae_desk=guest:dbf77d3c-f76f-4af4-8759-f92c2acfb7a8",
    ));
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, PANEL);
    assert.equal(probe.authCalls, 1);
    assert.equal(probe.authAuthorization, "Bearer valid-token");
    assert.equal(probe.membershipCalls, 1);
    assert.equal(probe.membershipAuthorization, "Bearer valid-token",
      "the membership query did not run under the verified user's RLS identity");
    const membershipUrl = new URL(probe.membershipUrl!);
    assert.equal(membershipUrl.searchParams.get("desk_id"), `eq.${RFQ_DESK_ID}`);
    assert.equal(membershipUrl.searchParams.get("user_id"), `eq.${ACCOUNT_ID}`);
    assert.equal(membershipUrl.searchParams.get("is_active"), "eq.true");
    assert.equal(membershipUrl.searchParams.get("limit"), "1");
    assert.equal(probe.gatewayCalls, 1);
    assert.equal(probe.gatewayAuthorization, "gateway-token");
    assert.equal(probe.gatewayUserAuthorization, null,
      "the browser's Supabase token crossed from the verifier into the gateway request");
    assert.equal(probe.gatewayCookie, null,
      "the browser's guest or desk session cookie crossed into the gateway request");
  });
});

describe("the browser sends account proof only to the RFQ proxy", () => {
  it("revokes a cached private snapshot only for this route's auth failures", () => {
    assert.equal(shouldDiscardRfqSnapshot("/api/gateway/coherence/rfq", "rfq_auth_invalid"), true);
    assert.equal(shouldDiscardRfqSnapshot("/api/gateway/coherence/rfq", "gateway_unreachable"), false);
    assert.equal(shouldDiscardRfqSnapshot("/api/gateway/coherence/books", "rfq_auth_invalid"), false);
  });

  it("adds the current Supabase bearer to the exact same-origin route", async () => {
    const headers = await rfqAuthorizationHeaders(
      "/api/gateway/coherence/rfq",
      async () => " access-token ",
    );
    assert.deepEqual(headers, { Authorization: "Bearer access-token" });
  });

  it("does not read or disclose the session for another URL", async () => {
    let reads = 0;
    const readSession = async () => {
      reads += 1;
      return "access-token";
    };
    for (const url of [
      "/api/gateway/coherence/books",
      "https://attacker.example/api/gateway/coherence/rfq",
      "/api/gateway/coherence/rfq?redirect=https://attacker.example",
    ]) {
      assert.deepEqual(await rfqAuthorizationHeaders(url, readSession), {});
    }
    assert.equal(reads, 0, "a non-RFQ URL was allowed to inspect the account session");
  });

  it("fails closed when the browser has no usable session", async () => {
    assert.deepEqual(await rfqAuthorizationHeaders(
      "/api/gateway/coherence/rfq",
      async () => null,
    ), {});
    assert.deepEqual(await rfqAuthorizationHeaders(
      "/api/gateway/coherence/rfq",
      async () => { throw new Error("storage unavailable"); },
    ), {});
  });

  it("the shared coherence reader merges the focused header into fetch", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../lib/coherence/use-coherence.ts", import.meta.url)),
      "utf8",
    );
    assert.match(source, /await rfqAuthorizationHeaders\(url\)/);
    assert.ok(
      source.indexOf("await rfqAuthorizationHeaders(url)") < source.indexOf("timer = setTimeout"),
      "the RFQ session lookup consumed the browser-to-gateway deadline headroom",
    );
    assert.match(source, /headers: \{ \[COHERENCE_REQUEST_ID_HEADER\]: requestId, \.\.\.authorization \}/);
  });
});
