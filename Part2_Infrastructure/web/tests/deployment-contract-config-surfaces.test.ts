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
const schema = readRepoFile(".github/workflows/schema.yml");
const keepalive = readRepoFile(".github/workflows/openbb-keepalive.yml");
const e2e = readRepoFile(".github/workflows/e2e.yml");
const vercel = readWebFile("vercel.json");

function workflowRunSources(workflow: string): string[] {
  const lines = workflow.split("\n");
  const sources: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index] ?? "");
    if (!match) continue;
    const indent = match[1]?.length ?? 0;
    const tail = match[2] ?? "";
    if (tail !== "|" && tail !== ">") {
      sources.push(tail);
      continue;
    }
    const block: string[] = [];
    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const leading = /^\s*/.exec(line)?.[0].length ?? 0;
      if (line.trim() && leading <= indent) {
        index -= 1;
        break;
      }
      block.push(line);
    }
    sources.push(block.join("\n"));
  }
  return sources;
}

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

  it("passes the complete Oracle connection, including its optional mTLS wallet", () => {
    const job = ci.slice(ci.indexOf("live-smoke:"), ci.indexOf("rerank-real:"));
    assert.match(job, /ORACLE_WALLET_PEM_B64:\s*\$\{\{ secrets\.ORACLE_WALLET_PEM_B64 \}\}/);
    assert.match(job, /ORACLE_WALLET_PASSWORD:\s*\$\{\{ secrets\.ORACLE_WALLET_PASSWORD \}\}/);
  });

  it("recognises pytest's current explicit skip report for the weight-free check", () => {
    const job = ci.slice(ci.indexOf("rerank-real:"), ci.indexOf("repo-audit:"));
    assert.match(job, /SKIPPED \\\[1\\\] tests\/test_research_rerank_real\\\.py:/);
    assert.doesNotMatch(job, /grep -q "1 skipped"/);
  });

  it("the three default jobs contact nothing", () => {
    const defaults = ci.slice(0, ci.indexOf("live-smoke:"));
    for (const secret of ["ORACLE_CONN_STRING", "SUPABASE_URL", "ORACLE_PASSWORD"]) {
      assert.ok(!defaults.includes(secret), `${secret} reached a job that runs on every push`);
    }
  });
});

describe("deployment automation fails honestly and remains reproducible", () => {
  it("installs the committed dependency graph on Vercel", () => {
    assert.match(vercel, /"installCommand":\s*"npm ci"/);
    assert.doesNotMatch(vercel, /"installCommand":\s*"npm install"/);
  });

  it("does not bake one gateway address into the schema workflow", () => {
    assert.match(schema, /ALPHAENGINE_GATEWAY_URL:\s*\$\{\{ vars\.ALPHAENGINE_GATEWAY_URL \}\}/);
    assert.doesNotMatch(schema, /ALPHAENGINE_GATEWAY_URL:\s*https?:\/\/\d+\.\d+\.\d+\.\d+/);
    assert.match(schema, /case "\$ALPHAENGINE_GATEWAY_URL" in[\s\S]*https:\/\/\*\)/);
    assert.match(schema, /refusing to send WEB_API_TOKEN over plaintext/);
    assert.match(
      schema,
      /SSL_CERT_FILE:\s*\$\{\{ github\.workspace \}\}\/Part2_Infrastructure\/web\/certs\/gateway-ca\.pem/,
      "the Oracle backfill must trust the repository-pinned gateway CA",
    );
  });

  it("accepts the full Supabase project-ref alphabet and refuses an empty parse", () => {
    assert.match(schema, /project_id = \"\[a-z0-9\]\+\"/);
    assert.match(schema, /if \[ -z "\$ref" \]/);
  });

  it("passes schema credentials through step environments, never shell interpolation", () => {
    const sources = workflowRunSources(schema);
    assert.ok(sources.length >= 10, "the schema run-source scanner stopped finding workflow steps");
    for (const source of sources) {
      assert.doesNotMatch(
        source,
        /\$\{\{\s*secrets\./,
        "a raw GitHub secret is interpolated into shell source; map it through the step env instead",
      );
    }
  });

  it("fails a manually selected database when its required connection pair is absent", () => {
    const credentialGate = schema.slice(
      schema.indexOf("\n  credential-gate:"),
      schema.indexOf("\n  oracle:"),
    );
    const oracle = schema.slice(schema.indexOf("\n  oracle:"), schema.indexOf("\n  supabase:"));
    const supabase = schema.slice(schema.indexOf("\n  supabase:"));
    assert.match(credentialGate, /both\|oracle[\s\S]*DB_CONNECTION_STRING[\s\S]*DB_PASSWORD/);
    assert.match(credentialGate, /both\|supabase[\s\S]*SUPABASE_ACCESS_TOKEN[\s\S]*SUPABASE_DB_PASSWORD/);
    assert.match(credentialGate, /missing required repository secrets[\s\S]*exit 1/);
    assert.match(oracle, /needs: credential-gate/);
    assert.match(supabase, /needs: credential-gate/);
    assert.match(oracle, /if: inputs\.target == 'both' \|\| inputs\.target == 'oracle'/);
    assert.match(supabase, /if: inputs\.target == 'both' \|\| inputs\.target == 'supabase'/);

    const oracleGate = oracle.slice(
      oracle.indexOf("- name: Secrets present?"),
      oracle.indexOf("- name: Apply"),
    );
    assert.match(oracleGate, /DB_CONNECTION_STRING:\s*\$\{\{ secrets\.DB_CONNECTION_STRING \}\}/);
    assert.match(oracleGate, /DB_PASSWORD:\s*\$\{\{ secrets\.DB_PASSWORD \}\}/);
    assert.match(oracleGate, /::error::Oracle was selected[\s\S]*exit 1/);
    assert.doesNotMatch(oracleGate, /nothing applied|exit 0/);

    const supabaseGate = supabase.slice(
      supabase.indexOf("- name: Secrets present?"),
      supabase.indexOf("- uses: supabase\/setup-cli@v3"),
    );
    assert.match(supabaseGate, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{ secrets\.SUPABASE_ACCESS_TOKEN \}\}/);
    assert.match(supabaseGate, /SUPABASE_DB_PASSWORD:\s*\$\{\{ secrets\.SUPABASE_DB_PASSWORD \}\}/);
    assert.match(supabaseGate, /::error::Supabase was selected[\s\S]*exit 1/);
    assert.doesNotMatch(supabaseGate, /nothing applied|exit 0/);
  });

  it("repairs only the legacy migrations verified live", () => {
    assert.match(schema, /repair_legacy_history:[\s\S]*default: false/);
    const repair = schema.slice(
      schema.indexOf("- name: Repair verified legacy migration history"),
      schema.indexOf("- name: Show what would change"),
    );
    assert.match(repair, /20260820090000/);
    assert.match(repair, /20260820100500/);
    assert.doesNotMatch(
      repair,
      /20260820100600|20260820100700/,
      "the security revokes are safe to replay and the live enum still lacks chart",
    );
    assert.match(repair, /inputs\.repair_legacy_history && !inputs\.dry_run/);
  });

  it("checks the warm OpenBB response, not only the cold response", () => {
    assert.match(keepalive, /warm_code=/);
    assert.match(keepalive, /\[ "\$warm_code" != "200" \]/);
  });

  it("runs the live smoke once and publishes that same report", () => {
    assert.equal((e2e.match(/python tools\/e2e_smoke\.py --full/g) ?? []).length, 1);
    assert.match(e2e, /tee \/tmp\/alphaengine-e2e-smoke\.log/);
    assert.match(e2e, /cat \/tmp\/alphaengine-e2e-smoke\.log/);
  });
});
