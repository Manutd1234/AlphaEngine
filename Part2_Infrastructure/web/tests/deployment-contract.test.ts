/**
 * The deployment surfaces agree with each other.
 *
 * The root .vercelignore is an upload drop-list shared by BOTH Vercel projects
 * (its own header documents the incident where excluding one project's files
 * starved the other's build). The container/compose/supabase trees are read by
 * neither project, so they must be listed — otherwise every CLI deploy uploads
 * a Docker context and a SQL migration history into two Next.js builds.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const vercelignore = readFileSync(fileURLToPath(new URL(".vercelignore", root)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("docker-compose.yml", root)), "utf8");

describe("vercel upload scope excludes the non-web deployment trees", () => {
  for (const entry of ["Part2_Infrastructure/docker", "docker-compose.yml", "supabase"]) {
    it(`drops ${entry}`, () => {
      assert.ok(
        vercelignore.split("\n").some((line) => line.trim() === entry),
        `${entry} missing from the root .vercelignore drop-list`,
      );
    });
  }
});

describe("the compose file and the web proxy agree on the gateway port", () => {
  it("compose publishes host port 8000, the dev fallback lib/gateway.ts uses", () => {
    assert.match(compose, /"8000:8000"/);
  });
});

// ---------------------------------------------------------------------------
// Oracle and Supabase configuration surfaces
// ---------------------------------------------------------------------------

const envExample = readFileSync(fileURLToPath(new URL("../.env.example", import.meta.url)), "utf8");
const ci = readFileSync(fileURLToPath(new URL(".github/workflows/ci.yml", root)), "utf8");

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
    const nextConfig = readFileSync(fileURLToPath(new URL("../next.config.mjs", import.meta.url)), "utf8");
    const envBlock = nextConfig.slice(nextConfig.indexOf("env: {"), nextConfig.indexOf("},", nextConfig.indexOf("env: {")));
    assert.doesNotMatch(envBlock, /ORACLE_/);
  });

  it("oracledb stays out of the bundle", () => {
    const nextConfig = readFileSync(fileURLToPath(new URL("../next.config.mjs", import.meta.url)), "utf8");
    assert.match(nextConfig, /serverExternalPackages:\s*\["oracledb"\]/);
  });
});

describe("the published Supabase key is scoped by policy, not by hope", () => {
  const rlsBase = readFileSync(
    fileURLToPath(new URL("supabase/migrations/20260808120200_rls_policies.sql", root)), "utf8");
  const anonPolicy = readFileSync(
    fileURLToPath(new URL("supabase/migrations/20260808120700_anon_demo_realtime.sql", root)), "utf8");

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
