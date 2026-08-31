import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");

test("the local browser audit origin is explicitly allowed by Next dev", () => {
  assert.match(nextConfig, /allowedDevOrigins:\s*\[[^\]]*"127\.0\.0\.1"[^\]]*\]/);
});
