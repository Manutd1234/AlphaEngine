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
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { callGateway, GATEWAY_TOKEN_ENV, GATEWAY_URL_ENV, TRANSPORT_HINTS, transportCause } from "../lib/gateway";

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
  // `e2e_smoke.py` kept the registry, the rendering and the exit code; the check
  // bodies became the `tools/e2e_checks/` package. The registry assertion below
  // still reads the script, because the registry really did stay there. The
  // check body is read from the WHOLE package rather than from `web.py` by name:
  // pinned to one module, a body that later moves to a sibling takes its
  // assertion with it and the test passes having scanned a file that no longer
  // contains its subject. Pinned to the package, a symbol may move within it
  // freely and the property still fails loudly if it genuinely goes away.
  const smoke = readFileSync(
    fileURLToPath(new URL("../../tools/e2e_smoke.py", import.meta.url)),
    "utf8",
  );
  const checksDir = fileURLToPath(new URL("../../tools/e2e_checks/", import.meta.url));
  const checkFiles = readdirSync(checksDir).filter((name) => name.endsWith(".py"));
  const checks = checkFiles
    .map((name) => readFileSync(join(checksDir, name), "utf8"))
    .join("\n");

  it("reads a package that actually holds the checks", () => {
    // A glob matching nothing does not fail — it passes having read an empty
    // string, which is how four assertions in this repository spent a day
    // matching against "". Guard the corpus before trusting anything below it.
    assert.ok(checkFiles.length > 1, `tools/e2e_checks/ holds ${checkFiles.length} modules`);
    assert.ok(checks.length > 0, "tools/e2e_checks/ concatenated to an empty string");
  });

  it("asks the deployment to reach the gateway, not just the gateway to answer", () => {
    // Every other gateway check runs from wherever the script executes and
    // proves only that *that* caller can reach it. This one traverses the hop
    // the workspace depends on.
    assert.match(checks, /def check_vercel_to_gateway\(\)/);
    assert.match(checks, /\{VERCEL\}\/api\/gateway\/portfolio/);
  });

  it("is registered, or it is decoration", () => {
    assert.match(smoke, /\("web", check_vercel_to_gateway\)/);
  });

  it("skips a deployment with no gateway rather than failing a fork", () => {
    assert.match(checks, /gateway_not_configured/);
    assert.match(checks, /"vercel → gateway", SKIP/);
  });

  it("reports the boundary's own hint rather than restating the status", () => {
    // Which is what makes this and the hints above one change: the probe is
    // only as useful as the sentence it can quote.
    assert.match(checks, /body\.get\("hint"\)/);
    assert.match(checks, /fix=hint or \(/);
  });
});

/**
 * In-flight GET collapsing.
 *
 * Two route handlers wanting the same payload in the same moment made two
 * upstream round trips. These pin the three properties that make collapsing
 * them safe rather than merely faster.
 */
describe("concurrent GETs for one path make one upstream call", () => {
  it("collapses simultaneous GETs and gives each caller its own object", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      seen.push(String(url));
      await new Promise((r) => setTimeout(r, 15));
      return new Response(JSON.stringify({ equity: 1, nested: { held: 2 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    try {
      const [a, b, c] = await Promise.all([
        callGateway<{ nested: { held: number } }>("/state"),
        callGateway<{ nested: { held: number } }>("/state"),
        callGateway<{ nested: { held: number } }>("/state"),
      ]);
      assert.equal(seen.length, 1, "three callers, one upstream request");
      assert.ok(a.ok && b.ok && c.ok);
      if (a.ok && b.ok) {
        assert.notEqual(a.data, b.data, "each caller gets its own object");
        assert.notEqual(a.data.nested, b.data.nested, "the clone is deep");
        assert.deepEqual(a.data, b.data, "…holding equal values");
      }
    } finally {
      globalThis.fetch = original;
    }
  });

  it("never collapses a POST — two orders are two intentions", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      seen.push(String(url));
      await new Promise((r) => setTimeout(r, 10));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    try {
      await Promise.all([
        callGateway("/orders", { method: "POST", body: { id: 1 } }),
        callGateway("/orders", { method: "POST", body: { id: 2 } }),
      ]);
      assert.equal(seen.length, 2, "collapsing these would drop an order");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("does not hand a joiner a budget that is already spent", async () => {
    // THE DEFECT THIS IS FOR, and it is why a reader saw the wrong number.
    // `/api/coherence/combos` is budgeted 25s on the route and 9s in the
    // browser. A first poll that hangs is aborted browser-side at 9s; the
    // SECOND poll, twenty seconds later, joins the first request's still-open
    // promise and receives its 504 body a few seconds in — comfortably inside
    // its own 9s. So "The risk gateway did not answer within 25000ms" was
    // rendered by a request that had waited five, describing a request the
    // reader had already given up on. The failure on screen was 20-25 seconds
    // stale and attributed to the wrong poll.
    //
    // Collapsing identical GETs is right and stays. What may not happen is a
    // late caller INHERITING the elapsed time: if the shared call has less left
    // than a floor, it is about to fail anyway, and the joiner asks its own
    // question rather than being told the answer to an older one.
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      seen.push(String(url));
      await new Promise((r) => setTimeout(r, 700));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    try {
      const first = callGateway("/slow", { timeoutMs: 5_000 });
      await new Promise((r) => setTimeout(r, 250));
      // Its own budget is smaller than what the shared call has already spent,
      // so joining would hand it a promise that cannot answer inside it.
      const late = callGateway("/slow", { timeoutMs: 200 });
      await Promise.all([first, late]);
      assert.equal(seen.length, 2,
        "a caller whose budget was already spent was joined to a call it cannot wait for");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("still collapses a joiner that can afford to wait", async () => {
    // The other half, and the half that must not regress: three panes opening a
    // tab share one universe read, and that is the whole point of the map.
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      seen.push(String(url));
      await new Promise((r) => setTimeout(r, 400));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    try {
      const first = callGateway("/shared", { timeoutMs: 25_000 });
      await new Promise((r) => setTimeout(r, 20));
      const second = callGateway("/shared", { timeoutMs: 25_000 });
      await Promise.all([first, second]);
      assert.equal(seen.length, 1, "identical GETs stopped collapsing, so the venue is asked twice");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("releases the path once the request settles", async () => {
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: URL | RequestInfo) => {
      seen.push(String(url));
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    process.env.ALPHAENGINE_GATEWAY_URL = "https://gateway.example";
    try {
      await callGateway("/state");
      await callGateway("/state");
      assert.equal(seen.length, 2, "a later GET is a new question, not a cached answer");
    } finally {
      globalThis.fetch = original;
    }
  });
});
