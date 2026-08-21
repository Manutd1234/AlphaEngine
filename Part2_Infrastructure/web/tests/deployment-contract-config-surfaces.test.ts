/**
 * The Oracle and Supabase configuration surfaces: what a deployment may be
 * given, what a published credential is allowed to reach, and what CI is
 * allowed to touch.
 *
 * Three surfaces that only agree with each other by assertion:
 *
 *  - `.env.example` is the only place a deployer looks to find out what a
 *    deployment can be configured with. A variable read at runtime and absent
 *    from that file is a feature nobody can turn on. The same file must not
 *    name the service-role key, which belongs to the gateway's `.env` alone.
 *
 *  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships to every browser, so the anon RLS
 *    policy IS the security boundary. The suite inverts an earlier assertion
 *    here, and the inversion is the point — the question is no longer "is the
 *    key absent" but "is it useless for anything but the demo tape". Each
 *    clause below is what keeps that true, and losing any one widens a public
 *    credential.
 *
 *  - CI stays network-free on its default jobs. A red build must mean the code
 *    broke, never that an idle Always Free database had auto-stopped.
 *
 * The upload drop-list is in `deployment-contract-upload-scope.test.ts`; the
 * container deploy pipeline in `deployment-contract-deploy-pipeline.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile, readWebFile } from "./helpers/deployment-files";

const envExample = readWebFile(".env.example");
const ci = readRepoFile(".github/workflows/ci.yml");

describe("every runtime variable is documented where someone will find it", () => {
  for (const name of ["ORACLE_CONN_STRING", "ORACLE_PASSWORD", "ORACLE_USER"]) {
    it(`${name} appears in .env.example`, () => {
      assert.match(
        envExample,
        new RegExp(`^${name}=`, "m"),
        `${name} is read at runtime but undocumented — the file is the only place a deployer `
          + "looks to find out what a deployment can be given",
      );
    });
  }

  it("no Oracle variable is read at build time", () => {
    // A build-time read turns a missing credential into a failed deployment
    // rather than a feature that reads "unavailable". Next inlines anything in
    // `env:`, so that block is where this would go wrong.
    const nextConfig = readWebFile("next.config.mjs");
    const envBlock = nextConfig.slice(nextConfig.indexOf("env: {"), nextConfig.indexOf("},", nextConfig.indexOf("env: {")));
    // Anchored before it is scanned: a renamed block gives `indexOf` -1, the
    // slice comes back empty, and `doesNotMatch` over nothing passes for ever.
    assert.ok(nextConfig.includes("env: {") && envBlock.length > 0, "next.config.mjs declares no env block to scan");
    assert.doesNotMatch(envBlock, /ORACLE_/);
  });

  it("oracledb stays out of the bundle", () => {
    const nextConfig = readWebFile("next.config.mjs");
    assert.match(nextConfig, /serverExternalPackages:\s*\["oracledb"\]/);
  });
});

describe("the published Supabase key is scoped by policy, not by hope", () => {
  const rlsBase = readRepoFile("supabase/migrations/20260808120200_rls_policies.sql");
  const anonPolicy = readRepoFile("supabase/migrations/20260808120700_anon_demo_realtime.sql");

  /**
   * This inverts an earlier assertion, and the inversion is the point.
   *
   * The base RLS migration shipped with zero `anon` policies precisely so that
   * publishing `NEXT_PUBLIC_SUPABASE_*` would have to be a deliberate act. It
   * now is one: the decision tape needs a browser subscription, and
   * `postgres_changes` only delivers rows the subscribing role could SELECT.
   *
   * So the test is no longer "is the key absent" — it is "is the key useless
   * for anything but the demo tape". Every clause below is what keeps that
   * true, and losing any one of them widens a public credential.
   */
  it("anon may read only the public demo desk", () => {
    assert.match(anonPolicy, /to anon/);
    assert.match(anonPolicy, /desk_id = '00000000-0000-0000-0000-000000000001'::uuid/);
  });

  it("anon may not read rows an authenticated trader owns", () => {
    // Gateway-mirrored rows are unowned. A login story later writes rows WITH a
    // user_id, and this clause is what stops shipping it retroactively
    // publishing them.
    assert.match(anonPolicy, /user_id is null/);
  });

  it("anon may not read the sandbox as if it were the desk", () => {
    assert.match(anonPolicy, /decided_by = 'gateway'/);
  });

  it("anon gets SELECT and nothing else", () => {
    assert.match(anonPolicy, /grant select on public\.order_blotter to anon/i);
    for (const verb of ["insert", "update", "delete"]) {
      assert.doesNotMatch(
        anonPolicy.replace(/--[^\n]*/g, ""),
        new RegExp(`grant[^;]*${verb}[^;]*to anon`, "i"),
        `anon was granted ${verb} on a public origin`,
      );
    }
  });

  it("risk limits stay closed", () => {
    // Publishing where the gates sit tells anyone how to size an order that
    // passes them. The base REVOKE must survive.
    assert.match(rlsBase, /revoke all on public\.desk_risk_limits from anon/);
    assert.doesNotMatch(
      anonPolicy.replace(/--[^\n]*/g, ""),
      /on public\.desk_risk_limits for select\s+to anon/,
    );
  });

  it("the service-role key is never named in the web project's example", () => {
    // It belongs to the gateway's .env only. This one has not changed.
    assert.doesNotMatch(envExample, /SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("only the two public variables are documented", () => {
    const published = [...envExample.matchAll(/^(NEXT_PUBLIC_SUPABASE_\w+)=/gm)].map((m) => m[1]);
    assert.deepEqual(published.sort(), ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_URL"]);
  });
});

describe("CI keeps its network-free guarantee", () => {
  it("the live probe is manual-only", () => {
    const job = ci.slice(ci.indexOf("live-smoke:"), ci.indexOf("repo-audit:"));
    assert.match(
      job,
      /if:\s*github\.event_name == 'workflow_dispatch'/,
      "the live smoke job would run on push or PR — a red build must mean the code broke, "
        + "never that an idle Always Free database had auto-stopped",
    );
  });

  it("the three default jobs contact nothing", () => {
    const defaults = ci.slice(0, ci.indexOf("live-smoke:"));
    for (const secret of ["ORACLE_CONN_STRING", "SUPABASE_URL", "ORACLE_PASSWORD"]) {
      assert.ok(!defaults.includes(secret), `${secret} reached a job that runs on every push`);
    }
  });
});
