/**
 * What a thrown error costs the vendor's record.
 *
 * Nothing here touches the network. Failures arrive as exceptions, and they are
 * emphatically not the same event. A 404 means the vendor answered honestly and
 * has nothing: a round trip that succeeded, so it fails over, counts as a
 * healthy latency sample, and must never touch the breaker. A 401/402/403 means
 * the key is not licensed for that capability: remember it, skip the provider
 * without calling it next time, and do not slander it as unreliable. A 429 is
 * the quota talking. Only a 5xx or a timeout is an outage.
 *
 * Collapse those four into one "it failed" and two things go wrong at once: the
 * breaker opens on providers that are working perfectly, and the latency ledger
 * reports an error rate for vendors that never erred. The reliability surface
 * then describes a desk that does not exist, which is worse than no surface —
 * an operator acts on it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { latencyStats } from "../lib/observability";
import {
  MemoryStore,
  breakerOpen,
  breakerSnapshot,
  clearLicence,
  dispatch,
  licenceBlock,
} from "../lib/providers/runtime";
import { kindFromStatus, ProviderError } from "../lib/providers/types";
import { QUOTE, fake, failing, throwing, uid } from "./helpers/provider-doubles";

test("kindFromStatus: the four kinds by status", () => {
  assert.equal(kindFromStatus(401), "unlicensed");
  assert.equal(kindFromStatus(402), "unlicensed");
  assert.equal(kindFromStatus(403), "unlicensed");
  assert.equal(kindFromStatus(400), "no_data");
  assert.equal(kindFromStatus(404), "no_data");
  assert.equal(kindFromStatus(422), "no_data");
  assert.equal(kindFromStatus(424), "no_data");
  assert.equal(kindFromStatus(429), "quota");
  assert.equal(kindFromStatus(500), "failed");
  assert.equal(kindFromStatus(503), "failed");
  assert.equal(kindFromStatus(408), "failed");
  assert.equal(kindFromStatus(null), "failed");
  assert.equal(new ProviderError("x", "m", 404).kind, "no_data");
  assert.equal(new ProviderError("x", "m", 424, false, "failed").kind, "failed", "an explicit kind wins");
});

test("dispatch: a 404 is no_data — fails over, counts as a healthy sample, never the breaker", async () => {
  const s = new MemoryStore();
  const id = uid("nodata");
  const primary = throwing(id, 404, "no profile for TEST");
  const backup = fake(uid("backup"), () => ({ ...QUOTE, price: 7 }));
  const r = await dispatch(
    [primary.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv },
  );
  assert.equal(r.data.price, 7);
  assert.deepEqual(r.attempts.map((a) => [a.provider, a.reason]), [[id, "no_data"]]);
  assert.match(r.attempts[0].detail ?? "", /no profile/);
  // The vendor answered its question. That is a round trip that succeeded,
  // and it never touches the breaker.
  assert.equal(breakerSnapshot(id, s).failures, 0);
  const stats = latencyStats(id);
  assert.equal(stats.n, 1);
  assert.equal(stats.errorRate, 0);
});

test("dispatch: a 403 is unlicensed — no breaker count, no latency sample, remembered", async () => {
  const s = new MemoryStore();
  const id = uid("unlic");
  const primary = throwing(id, 403, "You do not have permission to access the News API");
  const backup = fake(uid("backup"), () => QUOTE);
  const r = await dispatch(
    [primary.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv },
  );
  assert.deepEqual(r.attempts.map((a) => [a.provider, a.reason]), [[id, "unlicensed"]]);
  assert.equal(breakerSnapshot(id, s).failures, 0);
  assert.equal(latencyStats(id).n, 0, "a refusal is neither a success nor an outage sample");
  const block = licenceBlock(id, "quote", s);
  assert.ok(block, "the refusal is remembered per provider and capability");
  assert.equal(block.status, 403);
});

test("dispatch: a remembered licence refusal is skipped without a call, per capability", async () => {
  const s = new MemoryStore();
  const id = uid("tiingo");
  const primary = throwing(id, 403);
  const backup = fake(uid("backup"), () => QUOTE);
  const pool = [primary.adapter, backup.adapter];
  const run = (capability: "quote" | "bars") => dispatch(
    pool,
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability, cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv },
  );
  await run("quote");
  assert.equal(primary.calls(), 1);
  const second = await run("quote");
  assert.equal(primary.calls(), 1, "the second dispatch did not contact the unlicensed provider");
  assert.equal(second.attempts[0].reason, "unlicensed");
  assert.match(second.attempts[0].detail ?? "", /re-probes in \d+ h \(this instance\)/);
  // Scoped to the capability: bars on the same provider is still attempted.
  await run("bars");
  assert.equal(primary.calls(), 2, "a licence block on quote must not block bars");
  // The operator's "Close circuit" forgets it.
  assert.equal(clearLicence(id, s), 2);
  await run("quote");
  assert.equal(primary.calls(), 3);
});

test("dispatch: a 429 is rate_limited — no breaker, no sample", async () => {
  const s = new MemoryStore();
  const id = uid("busy");
  const primary = throwing(id, 429, "Thank you for using Alpha Vantage");
  const backup = fake(uid("backup"), () => QUOTE);
  const r = await dispatch(
    [primary.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv },
  );
  assert.deepEqual(r.attempts.map((a) => a.reason), ["rate_limited"]);
  assert.equal(breakerSnapshot(id, s).failures, 0);
  assert.equal(latencyStats(id).n, 0);
});

test("dispatch: three 404s do not open the breaker; three 500s still do", async () => {
  const s = new MemoryStore();
  const nodata = throwing(uid("nd"), 404);
  const dead = failing(uid("dead"));
  for (let i = 0; i < 3; i += 1) {
    await dispatch([nodata.adapter], (a, ctx) => a.quote!("T", "equity", ctx),
      { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv }).catch(() => undefined);
    await dispatch([dead.adapter], (a, ctx) => a.quote!("T", "equity", ctx),
      { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv }).catch(() => undefined);
  }
  assert.equal(breakerOpen(nodata.adapter.meta.id, s), false, "honest no-data answers opened a breaker");
  assert.equal(breakerOpen(dead.adapter.meta.id, s), true, "three real failures must still open it");
});

test("dispatch: when every reached provider had no data the terminal error is 404, otherwise 503", async () => {
  const s = new MemoryStore();
  await assert.rejects(
    dispatch([throwing(uid("a"), 404).adapter, throwing(uid("b"), 404).adapter],
      (a, ctx) => a.quote!("T", "equity", ctx),
      { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv }),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.status, 404);
      assert.match(err.message, /no provider has quote data for this request/);
      return true;
    },
  );
  await assert.rejects(
    dispatch([throwing(uid("a"), 404).adapter, failing(uid("b")).adapter],
      (a, ctx) => a.quote!("T", "equity", ctx),
      { capability: "quote", cacheKey: uid("k"), store: s, env: {} as NodeJS.ProcessEnv }),
    (err: unknown) => {
      assert.ok(err instanceof ProviderError);
      assert.equal(err.status, 503, "a real failure in the list keeps the retryable status");
      return true;
    },
  );
});
