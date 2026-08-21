/**
 * Failover order, the cache and the pin — the dispatch loop itself.
 *
 * Nothing here touches the network, and most of what is asserted is that a
 * provider was NOT called. `dispatch` walks the candidate chain in rank order,
 * so the interesting cases are the ones it steps over: a provider whose
 * allowance is spent, a provider whose circuit is open, a provider excluded
 * because the caller pinned another, and a second request served from cache
 * rather than spending quota twice for the same answer.
 *
 * The failure mode is not a crash — the answer still arrives, from a different
 * vendor than the reader believes. So every skip carries its reason and the
 * ledger's arithmetic, the provenance names who actually answered, and when
 * nobody can serve, the terminal error carries the whole attempt list instead
 * of only the last thing that went wrong.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { MemoryStore, dispatch, quotaState, spendQuota } from "../lib/providers/runtime";
import { ProviderError } from "../lib/providers/types";
import { QUOTE, fake, failing } from "./helpers/provider-doubles";

test("dispatch: fails over in order and records why the primary was skipped", async () => {
  const s = new MemoryStore();
  const primary = failing("primary");
  const backup = fake("backup", () => ({ ...QUOTE, price: 200 }));

  const r = await dispatch(
    [primary.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: "t1", store: s, env: {} as NodeJS.ProcessEnv },
  );

  assert.equal(r.data.price, 200);
  assert.equal(r.provenance.provider, "backup");
  // The failover is visible: the primary's failure is in the attempts list.
  assert.deepEqual(r.attempts.map((a) => [a.provider, a.reason]), [["primary", "failed"]]);
});

test("dispatch: second call is served from cache without spending quota", async () => {
  const s = new MemoryStore();
  const p = fake("only", () => QUOTE);

  await dispatch([p.adapter], (a, ctx) => a.quote!("TEST", "equity", ctx), {
    capability: "quote", cacheKey: "t2", store: s, env: {} as NodeJS.ProcessEnv,
  });
  const second = await dispatch([p.adapter], (a, ctx) => a.quote!("TEST", "equity", ctx), {
    capability: "quote", cacheKey: "t2", store: s, env: {} as NodeJS.ProcessEnv,
  });

  assert.equal(p.calls(), 1);
  assert.equal(second.provenance.cached, true);
  assert.equal(quotaState(p.adapter, s)!.used, 1); // one spend, not two
});

test("dispatch: an exhausted provider is skipped with the ledger's arithmetic attached", async () => {
  const s = new MemoryStore();
  const tiny = fake("tiny", () => QUOTE, { calls: 1, window: "day", reserve: 0 });
  const backup = fake("backup2", () => QUOTE);
  spendQuota(tiny.adapter, s); // burn the whole allowance

  const r = await dispatch(
    [tiny.adapter, backup.adapter],
    (a, ctx) => a.quote!("TEST", "equity", ctx),
    { capability: "quote", cacheKey: "t3", store: s, env: {} as NodeJS.ProcessEnv },
  );

  assert.equal(r.provenance.provider, "backup2");
  const skip = r.attempts.find((a) => a.provider === "tiny")!;
  assert.equal(skip.reason, "quota_exhausted");
  assert.match(skip.detail!, /1\/1 used this day/);
  assert.equal(tiny.calls(), 0); // never actually called
});

test("dispatch: after the breaker opens the provider is not even attempted", async () => {
  const s = new MemoryStore();
  const bad = failing("bad");
  const good = fake("good", () => QUOTE);

  // Three dispatches with distinct cache keys → three failures → breaker opens.
  for (let i = 0; i < 3; i++) {
    await dispatch([bad.adapter, good.adapter], (a, ctx) => a.quote!("T", "equity", ctx), {
      capability: "quote", cacheKey: `warm${i}`, store: s, env: {} as NodeJS.ProcessEnv,
    });
  }
  assert.equal(bad.calls(), 3);

  const r = await dispatch([bad.adapter, good.adapter], (a, ctx) => a.quote!("T", "equity", ctx), {
    capability: "quote", cacheKey: "after", store: s, env: {} as NodeJS.ProcessEnv,
  });
  assert.equal(bad.calls(), 3); // skipped, not re-timed-out
  assert.equal(r.attempts[0].reason, "circuit_open");
});

test("dispatch: when nobody can serve, the error carries the whole attempt list", async () => {
  const s = new MemoryStore();
  const a = failing("a1");
  const b = failing("b1");
  await assert.rejects(
    dispatch([a.adapter, b.adapter], (x, ctx) => x.quote!("T", "equity", ctx), {
      capability: "quote", cacheKey: "t4", store: s, env: {} as NodeJS.ProcessEnv,
    }),
    (err: ProviderError & { attempts: { provider: string }[] }) => {
      assert.equal(err.attempts.length, 2);
      return true;
    },
  );
});

test("dispatch: pin restricts the pool to one provider", async () => {
  const s = new MemoryStore();
  const first = fake("first", () => ({ ...QUOTE, price: 1 }));
  const second = fake("second", () => ({ ...QUOTE, price: 2 }));

  const r = await dispatch(
    [first.adapter, second.adapter],
    (a, ctx) => a.quote!("T", "equity", ctx),
    { capability: "quote", cacheKey: "t5", pin: "second", store: s, env: {} as NodeJS.ProcessEnv },
  );
  assert.equal(r.data.price, 2);
  assert.equal(first.calls(), 0);
});
