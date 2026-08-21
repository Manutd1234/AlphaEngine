/**
 * The SSRF guard — the scrape capability takes a URL from the caller.
 *
 * Nothing here touches the network, which is the whole point: this is the check
 * that runs before anything would. A fetch capability that accepts an arbitrary
 * URL is a request-forgery primitive unless something refuses loopback, the
 * RFC-1918 ranges, the link-local cloud metadata endpoint and every scheme that
 * is not http(s) — a server-side fetch of 169.254.169.254 hands the caller
 * whatever credentials the instance carries.
 *
 * The 172.32 case guards the other direction. The private block is 172.16/12,
 * so a broad "starts with 172." refuses real public hosts; a guard that
 * over-refuses gets loosened by the next person in a hurry rather than fixed,
 * and it is the loosening, not the original rule, that lets the metadata
 * endpoint back in.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { assertPublicUrl } from "../lib/providers/firecrawl";
import { ProviderError } from "../lib/providers/types";

test("assertPublicUrl refuses internal targets and odd schemes", () => {
  for (const bad of [
    "file:///etc/passwd",
    "ftp://example.com/x",
    "http://localhost:8000/admin",
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.9.9/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://gateway.internal/health",
    "not a url",
  ]) {
    assert.throws(() => assertPublicUrl(bad), ProviderError, bad);
  }
  // 172.32.x is OUTSIDE the RFC-1918 172.16/12 block and must be allowed —
  // an over-broad /^172\./ would block real public hosts.
  assert.ok(assertPublicUrl("http://172.32.1.1/"));
  assert.ok(assertPublicUrl("https://www.sec.gov/cgi-bin/browse-edgar"));
});
