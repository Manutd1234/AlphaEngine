/**
 * The migrations that ship with the login — the hazard that is not in the web
 * app at all.
 *
 * This is the second structural hazard of the login, and the more expensive
 * one: a migration that publishes a signed-in trader's own rows to the shared
 * demo tape, or leaves a SECURITY DEFINER writer reachable by anyone who can
 * sign up. Neither fails loudly. Both are visible in the SQL, which is why they
 * are asserted here rather than hoped for in review.
 *
 * Every clause below is load-bearing, so each is pinned individually — a
 * predicate that quietly loses `user_id is null` still applies, still returns
 * rows, and returns the wrong ones.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { migrations } from "./helpers/auth-sources";

/** Comments stripped, the SQL way. These migrations spend more lines explaining
 *  which grants they are closing than issuing statements, so a raw scan for
 *  "grant … to anon" finds the rationale and reports it as the grant. */
const sqlCode = (source: string) => source.replace(/--[^\n]*/g, "");

describe("the migrations that ship with the login", () => {
  const demo = migrations.find((file) => file.name === "20260812090000_authenticated_demo_realtime.sql");
  const hardening = migrations.find((file) => file.name === "20260812091000_close_authenticated_writes.sql");

  it("both exist", () => {
    assert.ok(demo, "the authenticated demo-tape policy is missing");
    assert.ok(hardening, "the authenticated write-closure migration is missing");
  });

  it("mirrors the anon demo predicate exactly, and no wider", () => {
    assert.match(demo!.sql, /to authenticated/);
    assert.match(demo!.sql, /00000000-0000-0000-0000-000000000001/);
    // Each clause is load-bearing: dropping user_id is null would publish
    // every signed-in trader's own rows to the shared tape.
    assert.match(demo!.sql, /user_id is null/);
    assert.match(demo!.sql, /decided_by = 'gateway'/);
    assert.match(demo!.sql, /for select/);
    assert.doesNotMatch(demo!.sql, /for (insert|update|delete|all)/);
  });

  it("revokes the SECURITY DEFINER writer from authenticated", () => {
    // 20260808120300 revoked it from public and anon and concluded nothing else
    // carried it. Supabase's bootstrap grants it to authenticated by name, and
    // a revoke from PUBLIC does not touch a named-role grant.
    assert.match(
      hardening!.sql,
      /revoke execute on function public\.record_alphaengine_decision\(jsonb\) from authenticated/,
    );
  });

  it("stops a browser claiming the gateway decided its rows", () => {
    assert.match(hardening!.sql, /decided_by = 'supabase_rpc'/);
  });

  it("never grants anything to anon", () => {
    for (const file of [demo!, hardening!]) {
      assert.doesNotMatch(sqlCode(file.sql), /grant[\s\S]{0,80}to anon/i, `${file.name} widens anon`);
    }
  });

  it("every migration name is applied-once shaped", () => {
    // Matches the gateway suite's rule, asserted here too so a web-side commit
    // cannot land a file the Python tests will reject later.
    for (const file of migrations) {
      assert.match(file.name, /^\d{14}_[a-z0-9_]+\.sql$/, `${file.name} is misnamed`);
    }
  });

  it("carries no key-shaped literals", () => {
    for (const file of migrations) {
      assert.doesNotMatch(file.sql, /sb_secret_|sb_publishable_|eyJ[A-Za-z0-9_-]{10}/, file.name);
    }
  });
});
