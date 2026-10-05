import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { embedResearchQuery } from "../lib/research-embedding-server";

const env: NodeJS.ProcessEnv = { NODE_ENV: "test", NEXT_PUBLIC_SUPABASE_URL: "https://research.example.test", SUPABASE_SERVICE_ROLE_KEY: "test-only" };
const vector = Array.from({ length: 384 }, () => 0.05);

describe("server-side research embedding", () => {
  it("reaches the corpus model directly without a configured gateway", async () => {
    let calls = 0;
    const result = await embedResearchQuery("drawdown", env, async (url, init) => {
      calls++;
      assert.equal(String(url), "https://research.example.test/functions/v1/embed-research");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only");
      assert.deepEqual(JSON.parse(String(init?.body)), { texts: ["drawdown"] });
      assert.equal(init?.redirect, "error");
      return Response.json({ model: "gte-small", embeddings: [vector] });
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, { ok: true, vector });
  });
  it("rejects wrong models, dimensions, nonnumeric and zero vectors", async () => {
    for (const payload of [
      { model: "other", embeddings: [vector] },
      { model: "gte-small", embeddings: [vector.slice(1)] },
      { model: "gte-small", embeddings: [vector.map(() => "0.05")] },
      { model: "gte-small", embeddings: [vector.map(() => 0)] },
    ]) {
      const result = await embedResearchQuery("query", env, async () => Response.json(payload));
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.failure.code, "embedding_invalid_payload");
    }
  });
  it("does not expose upstream error bodies or transmit credentials over plaintext", async () => {
    const denied = await embedResearchQuery("query", env, async () => new Response("private upstream detail", { status: 401 }));
    assert.equal(denied.ok, false);
    assert.doesNotMatch(JSON.stringify(denied), /private upstream detail|test-only/);
    const insecure = await embedResearchQuery("query", { ...env, NEXT_PUBLIC_SUPABASE_URL: "http://research.example.test" }, async () => {
      assert.fail("must not send credentials");
    });
    assert.equal(insecure.ok, false);
  });
  it("classifies timeouts and malformed responses", async () => {
    const timed = await embedResearchQuery("query", env, async () => { throw new DOMException("timeout", "TimeoutError"); });
    assert.equal(timed.ok, false);
    if (!timed.ok) assert.equal(timed.failure.status, 504);
    const malformed = await embedResearchQuery("query", env, async () => new Response("<html>bad proxy</html>"));
    assert.equal(malformed.ok, false);
  });
});
