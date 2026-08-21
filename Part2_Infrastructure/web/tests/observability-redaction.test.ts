/**
 * No credential reaches a screen, in a URL or in a body.
 *
 * The console renders the request it made and the payload it got back, which
 * means every vendor's idea of where a key belongs becomes a leak path: a query
 * parameter this codebase knows the name of, a parameter it does not, and the
 * userinfo component of an authority. So redaction works from two directions —
 * a list of parameter names, and the registered secret values themselves,
 * blanked wherever they appear.
 *
 * Both directions have a way of going wrong that is worse than the leak. Too
 * eager and the useful half of the URL is destroyed, or a three-character
 * secret blanks unrelated prose, or `OPENBB_API_URL` — a base URL, not a
 * credential — is scrubbed out of every line that names the service.
 *
 * Payload capture is the same guard one layer in. A body is bounded so a
 * 50,000-row aggregates response cannot be held in the ring, but a truncated
 * body must still be valid JSON and must still have a readable *shape*: the
 * array is sampled and the drop declared, rather than the string cut in half
 * mid-object where the viewer would fail to parse it.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  captureBody,
  clearSecrets,
  redact,
  redactUrl,
  registerSecret,
} from "../lib/observability";

// --------------------------------------------------------------------------
// Redaction
// --------------------------------------------------------------------------

describe("no credential reaches a screen", () => {
  it("blanks a key carried in the query string", () => {
    clearSecrets();
    const url = redactUrl("https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=sk-live-abcdef123456");
    assert.ok(!url.includes("sk-live-abcdef123456"), `key survived redaction: ${url}`);
    assert.match(url, /symbol=AAPL/, "the useful part of the URL was destroyed too");
  });

  it("blanks a registered secret wherever it appears, even under an unexpected parameter name", () => {
    clearSecrets();
    registerSecret("supersecretvalue123");
    const url = redactUrl("https://vendor.example/v1/quote?token_v2=supersecretvalue123&sym=X");
    assert.ok(!url.includes("supersecretvalue123"), `unnamed-parameter key survived: ${url}`);
    clearSecrets();
  });

  it("ignores short values, which would otherwise blank unrelated text", () => {
    clearSecrets();
    registerSecret("abc");
    assert.equal(redact("abc appears inside abcdef"), "abc appears inside abcdef");
    clearSecrets();
  });

  it("scrubs credentials from the authority component", () => {
    clearSecrets();
    const url = redactUrl("https://user:hunter2pass@openbb.internal/api/research/openbb/quote?symbol=AAPL");
    assert.ok(!url.includes("hunter2pass"), `userinfo password survived: ${url}`);
  });

  it("redacts a string that is not a URL rather than returning it untouched", () => {
    clearSecrets();
    registerSecret("leakedkey12345");
    assert.ok(!redactUrl("not a url leakedkey12345").includes("leakedkey12345"));
    clearSecrets();
  });

  it("leaves a service URL intact — OPENBB_API_URL is a base URL, not a secret", () => {
    clearSecrets();
    const url = redactUrl("https://openbb.example.app/api/research/openbb/quote?symbol=AAPL&asset=equity");
    assert.equal(url, "https://openbb.example.app/api/research/openbb/quote?symbol=AAPL&asset=equity");
  });
});

// --------------------------------------------------------------------------
// Payload capture
// --------------------------------------------------------------------------

describe("captured bodies stay bounded and stay parseable", () => {
  it("keeps a small body verbatim", () => {
    clearSecrets();
    const body = captureBody({ price: 1, symbol: "AAPL" });
    assert.equal(body.truncated, false);
    assert.deepEqual(body.value, { price: 1, symbol: "AAPL" });
  });

  it("samples a huge array instead of truncating it, so the shape survives", () => {
    clearSecrets();
    // Massive's aggregates endpoint can return 50,000 of these.
    const rows = Array.from({ length: 5_000 }, (_, i) => ({ t: i, o: 1, h: 2, l: 0, c: 1, v: 10 }));
    const body = captureBody(rows, 2_000);
    assert.equal(body.truncated, true);
    assert.ok(body.bytes > 2_000, "original size was not reported");
    assert.ok(Array.isArray(body.value), "the array shape was lost");
    const sample = body.value as unknown[];
    assert.deepEqual(sample[0], { t: 0, o: 1, h: 2, l: 0, c: 1, v: 10 }, "the first row is unreadable");
    assert.match(String(sample[sample.length - 1]), /more elements/, "the drop was not declared");
  });

  it("the result is always valid JSON — a half-closed object would break the viewer", () => {
    clearSecrets();
    const body = captureBody({ blob: "x".repeat(50_000) }, 500);
    assert.doesNotThrow(() => JSON.parse(JSON.stringify(body.value)));
  });

  it("redacts inside a captured body, not only in the URL", () => {
    clearSecrets();
    registerSecret("insidebodysecret1");
    const body = captureBody({ echo: "your key insidebodysecret1 was rejected" });
    assert.ok(!JSON.stringify(body.value).includes("insidebodysecret1"), "a body leaked a credential");
    clearSecrets();
  });
});
