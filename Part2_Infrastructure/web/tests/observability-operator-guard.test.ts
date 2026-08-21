/**
 * The operator write path is closed by default and refuses what it cannot parse.
 *
 * Everything behind this guard mutates a running instance: it resets breakers,
 * purges caches, and takes providers out of rotation. So the default in
 * production with no token configured is `locked` — a refusal, not an open
 * door — while a non-production build stays open so the console is usable
 * locally. A configured token is compared whole, and the length check has to
 * come first: `timingSafeEqual` throws on unequal lengths, which would turn a
 * wrong-length guess into a 500 and hand back a length oracle.
 *
 * Parsing is the second half of the same guard, and its rule is that an action
 * is rejected, never coerced. Every coercion here has a blast radius: a
 * mistyped provider silently resetting a *different* provider's breaker, an
 * outage applied to `all` at once, a purge scope that reaches the quota ledger,
 * or `Number("abc")` becoming NaN and surviving `Math.min`/`Math.max` to mean
 * "10 seconds". The one thing that is not a rejection is an absent scope, which
 * means the documented default.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authorise,
  guardMode,
  parseAction,
} from "../lib/operator";

// --------------------------------------------------------------------------
// Operator guard
// --------------------------------------------------------------------------

describe("mutating actions are closed by default where it matters", () => {
  it("production with no token refuses outright", () => {
    const env = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "locked");
    const rejection = authorise(null, env)!;
    assert.equal(rejection.status, 503);
    assert.equal(rejection.code, "operator_actions_disabled");
    assert.match(rejection.hint!, /ALPHAENGINE_OPERATOR_TOKEN/);
  });

  it("a non-production build is open, so the console is usable locally", () => {
    const env = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "open-dev");
    assert.equal(authorise(null, env), null);
  });

  it("a configured token is required and compared whole", () => {
    const env = {
      NODE_ENV: "production",
      ALPHAENGINE_OPERATOR_TOKEN: "correct-horse-battery-staple",
    } as NodeJS.ProcessEnv;
    assert.equal(guardMode(env), "token");
    assert.equal(authorise("Bearer correct-horse-battery-staple", env), null);
    // A prefix must not pass — timingSafeEqual throws on unequal lengths, so the
    // length check has to come first or this is a 500 and a length oracle.
    assert.equal(authorise("Bearer correct-horse", env)!.status, 401);
    assert.equal(authorise(null, env)!.status, 401);
  });

  it("never echoes the presented credential", () => {
    const env = { NODE_ENV: "production", ALPHAENGINE_OPERATOR_TOKEN: "realtoken123" } as NodeJS.ProcessEnv;
    const rejection = authorise("Bearer guessed-token-value", env)!;
    assert.ok(!JSON.stringify(rejection).includes("guessed-token-value"));
  });
});

// --------------------------------------------------------------------------
// Operator action parsing
// --------------------------------------------------------------------------

describe("an operator action is rejected, never coerced", () => {
  it("an unknown action is refused rather than defaulted", () => {
    const parsed = parseAction({ action: "delete_everything" });
    assert.equal(parsed.ok, false);
    assert.match((parsed as { error: string }).error, /unknown action/);
  });

  it("an unknown provider is refused — a typo must not reset a different one", () => {
    const parsed = parseAction({ action: "reset_breaker", provider: "fpm" });
    assert.equal(parsed.ok, false);
    assert.match((parsed as { error: string }).error, /unknown provider/);
  });

  it("\"all\" is accepted only where it is meaningful", () => {
    assert.equal(parseAction({ action: "reset_breaker", provider: "all" }).ok, true);
    const parsed = parseAction({ action: "simulate_outage", provider: "all" });
    assert.equal(parsed.ok, false, "an outage on every provider at once was permitted");
  });

  it("an action that requires a provider does not silently apply to none", () => {
    assert.equal(parseAction({ action: "probe_provider" }).ok, false);
  });

  it("a purge scope must name something the purge can reach", () => {
    assert.equal(parseAction({ action: "purge_cache", scope: "quota" }).ok, false);
    assert.equal(parseAction({ action: "purge_cache", scope: "symbol:BTC USDT" }).ok, false);
    const ok = parseAction({ action: "purge_cache", scope: "symbol:btcusdt" });
    assert.equal(ok.ok, true);
    assert.equal((ok as { action: { scope?: string } }).action.scope, "symbol:BTCUSDT");
  });

  it("an absent scope means the documented default, not a rejection", () => {
    const parsed = parseAction({ action: "purge_cache" });
    assert.equal(parsed.ok, true);
    assert.equal((parsed as { action: { scope?: string } }).action.scope, "all");
  });

  it("a non-numeric ttl is refused rather than clamped to the floor", () => {
    // Number("abc") is NaN and NaN survives Math.min/Math.max — the same trap
    // lib/params documents, and here it would silently mean "10 seconds".
    assert.equal(parseAction({ action: "simulate_outage", provider: "fmp", ttlMs: "abc" }).ok, false);
    const parsed = parseAction({ action: "simulate_outage", provider: "fmp", ttlMs: 99_999_999 });
    assert.equal(parsed.ok, true);
    assert.ok((parsed as { action: { ttlMs?: number } }).action.ttlMs! <= 15 * 60_000, "ttl was not clamped");
  });

  it("a body that is not an object is refused", () => {
    assert.equal(parseAction(null).ok, false);
    assert.equal(parseAction([{ action: "purge_cache" }]).ok, false);
    assert.equal(parseAction("purge_cache").ok, false);
  });
});
