/**
 * Why a gateway call failed, not just that it did.
 *
 * This exists because of a real outage that took several round trips to
 * diagnose. The gateway was healthy and answering on both its plaintext and
 * TLS ports; `/health` was green from a laptop, from a GitHub runner and from
 * the deploy workflow's own reachability probe. Every gateway-backed panel in
 * the workspace nonetheless showed a degraded card, because the serverless
 * function could not verify the gateway's pinned certificate — and the boundary
 * reported that with the same sentence it uses for a refused connection.
 *
 * One string, two utterly different fixes: trust a certificate, or start a
 * process. The code Node already had in hand distinguishes them for free.
 *
 * The rule these assertions protect: a transport failure must carry its cause,
 * and must never carry a host or a credential — this boundary's whole purpose
 * is keeping those server-side.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GATEWAY_TOKEN_ENV, GATEWAY_URL_ENV, TRANSPORT_HINTS, transportCause } from "../lib/gateway";

const source = readFileSync(fileURLToPath(new URL("../lib/gateway.ts", import.meta.url)), "utf8");
const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

describe("the reason a connection failed survives the throw", () => {
  it("reads the nested cause fetch actually throws", () => {
    // `fetch` throws a flat "TypeError: fetch failed" and hides the answer one
    // level down. Reading only `error.message` discards the diagnosis.
    const thrown = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("unable to verify"), { code: "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" }),
    });
    assert.equal(transportCause(thrown), "UNABLE_TO_GET_ISSUER_CERT_LOCALLY");
  });

  it("reads a code carried directly, which older shapes use", () => {
    assert.equal(transportCause(Object.assign(new Error("refused"), { code: "ECONNREFUSED" })), "ECONNREFUSED");
  });

  it("returns null rather than inventing one", () => {
    assert.equal(transportCause(new Error("something")), null);
    assert.equal(transportCause(null), null);
    assert.equal(transportCause(undefined), null);
    assert.equal(transportCause({ cause: {} }), null);
    // A non-string code is not a code.
    assert.equal(transportCause({ code: 42 }), null);
  });
});

describe("the failure names its cause and stays quiet about everything else", () => {
  it("puts the code in the message so an unmapped one is still searchable", () => {
    assert.match(code, /unreachable \(\$\{transport\}\)/);
  });

  it("attaches the hint only when there is one", () => {
    assert.match(code, /hint: transport \? TRANSPORT_HINTS\[transport\] : undefined/);
  });

  it("keeps the timeout a separate answer, not a hinted unreachable", () => {
    // A gateway that answered slowly is a different fact from one that never
    // accepted the connection, and 504 vs 503 is the honest split.
    assert.match(code, /code: "gateway_timeout"/);
    assert.match(code, /status: 504/);
  });

  it("never leaks the address or the credential into a hint", () => {
    for (const [name, hint] of Object.entries(TRANSPORT_HINTS)) {
      // The env var *names* are fine and are the actionable part; their values
      // are what must never appear. An IP or a bearer token here would cross
      // the exact boundary this module exists to hold.
      assert.doesNotMatch(hint, /\d{1,3}(\.\d{1,3}){3}/, `${name} embeds an address`);
      assert.doesNotMatch(hint, /Bearer|eyJ[A-Za-z0-9_-]/, `${name} embeds a credential`);
      // A bare scheme is fine and sometimes necessary — "https:// against the
      // plaintext port" is the fix itself. What must never appear is a scheme
      // followed by an actual host, which is the value this module hides.
      assert.doesNotMatch(hint, /:\/\/[\w.-]+/, `${name} embeds a host`);
    }
  });
});

describe("the hints say what to do", () => {
  it("covers the certificate failures the TLS flip can produce", () => {
    for (const expected of [
      "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
      "SELF_SIGNED_CERT_IN_CHAIN",
      "DEPTH_ZERO_SELF_SIGNED_CERT",
      "CERT_HAS_EXPIRED",
      "ERR_TLS_CERT_ALTNAME_INVALID",
      "EPROTO",
      // Measured, not assumed. Pointing https:// at the gateway's plaintext
      // port reports ERR_SSL_WRONG_VERSION_NUMBER, not EPROTO — so mapping
      // only the latter left the likeliest mirror-image mistake unhinted.
      "ERR_SSL_WRONG_VERSION_NUMBER",
    ]) {
      assert.ok(TRANSPORT_HINTS[expected], `no hint for ${expected}`);
    }
  });

  it("tells the wrong-protocol case which way round to fix it", () => {
    const hint = TRANSPORT_HINTS.ERR_SSL_WRONG_VERSION_NUMBER;
    assert.match(hint, /https:\/\//);
    assert.match(hint, /http:\/\//);
    assert.match(hint, new RegExp(GATEWAY_URL_ENV));
  });

  it("covers the ordinary network failures too, so TLS is not the only story", () => {
    for (const expected of ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ECONNRESET"]) {
      assert.ok(TRANSPORT_HINTS[expected], `no hint for ${expected}`);
    }
  });

  it("points the untrusted-root case at the fix that actually works", () => {
    // This is the one that cost the round trips. It must name both the
    // variable that fixes it and the file that variable points at.
    const hint = TRANSPORT_HINTS.UNABLE_TO_GET_ISSUER_CERT_LOCALLY;
    assert.match(hint, /NODE_EXTRA_CA_CERTS/);
    assert.match(hint, /certs\/gateway-ca\.pem/);
    assert.match(hint, new RegExp(GATEWAY_URL_ENV));
  });

  it("distinguishes a refused port from an untrusted certificate", () => {
    // The whole point: these two must not read alike.
    assert.notEqual(
      TRANSPORT_HINTS.ECONNREFUSED,
      TRANSPORT_HINTS.UNABLE_TO_GET_ISSUER_CERT_LOCALLY,
    );
    assert.doesNotMatch(TRANSPORT_HINTS.ECONNREFUSED, /certificate/i);
    assert.match(TRANSPORT_HINTS.UNABLE_TO_GET_ISSUER_CERT_LOCALLY, /certificate/i);
  });

  it("names only codes Node can actually emit", () => {
    for (const name of Object.keys(TRANSPORT_HINTS)) {
      assert.match(name, /^[A-Z][A-Z0-9_]+$/, `${name} is not a transport code shape`);
    }
  });

  it("does not mention the token variable, which is a different failure", () => {
    // A rejected credential is gateway_auth_failed and has its own hint. A
    // transport hint pointing at the token would send someone to the wrong
    // dashboard entirely.
    for (const hint of Object.values(TRANSPORT_HINTS)) {
      assert.doesNotMatch(hint, new RegExp(GATEWAY_TOKEN_ENV));
    }
  });
});

describe("the deployment probes the hop it actually depends on", () => {
  const smoke = readFileSync(
    fileURLToPath(new URL("../../tools/e2e_smoke.py", import.meta.url)),
    "utf8",
  );

  it("asks the deployment to reach the gateway, not just the gateway to answer", () => {
    // Every other gateway check runs from wherever the script executes and
    // proves only that *that* caller can reach it. This one traverses the hop
    // the workspace depends on.
    assert.match(smoke, /def check_vercel_to_gateway\(\)/);
    assert.match(smoke, /\{VERCEL\}\/api\/gateway\/portfolio/);
  });

  it("is registered, or it is decoration", () => {
    assert.match(smoke, /\("web", check_vercel_to_gateway\)/);
  });

  it("skips a deployment with no gateway rather than failing a fork", () => {
    assert.match(smoke, /gateway_not_configured/);
    assert.match(smoke, /"vercel → gateway", SKIP/);
  });

  it("reports the boundary's own hint rather than restating the status", () => {
    // Which is what makes this and the hints above one change: the probe is
    // only as useful as the sentence it can quote.
    assert.match(smoke, /body\.get\("hint"\)/);
    assert.match(smoke, /fix=hint or \(/);
  });
});
