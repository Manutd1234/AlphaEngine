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
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = new URL("../../../", import.meta.url);
const rootPath = fileURLToPath(root);
const vercelignore = readFileSync(fileURLToPath(new URL(".vercelignore", root)), "utf8");
const compose = readFileSync(fileURLToPath(new URL("docker-compose.yml", root)), "utf8");

describe("vercel upload scope excludes the non-web deployment trees", () => {
  // Root-anchored (`/oracle`, not `oracle`) is the point of this list, not
  // incidental — see the collision test below for why.
  for (const entry of ["Part2_Infrastructure/docker", "/docker-compose.yml", "/supabase"]) {
    it(`drops ${entry}`, () => {
      assert.ok(
        vercelignore.split("\n").some((line) => line.trim() === entry),
        `${entry} missing from the root .vercelignore drop-list`,
      );
    });
  }
});

describe("no .vercelignore pattern can ever drop a path the web project needs", () => {
  /**
   * This is the test the actual incident needed and nothing before it caught.
   * `oracle` (no leading slash) was gitignore-legal, present, and reviewed —
   * it just matches at ANY depth, so it silently deleted `web/lib/oracle/`
   * and `web/app/api/oracle/` from every Vercel build alongside the intended
   * top-level `oracle/` SQL directory. A literal-string test on the drop-list
   * (above) cannot catch this, because the dangerous line reads exactly like
   * a correct one; it has to actually be evaluated as gitignore syntax
   * against the real tree, which is what this does.
   *
   * `git check-ignore` only ever consults a real `.gitignore` in a real
   * working tree — there is no way to hand it an arbitrary file and ask "does
   * this match that". So the check runs the pattern set in a throwaway repo,
   * against every path this project actually ships.
   */
  it("every tracked path under Part2_Infrastructure/web/ survives the drop-list", () => {
    const tracked = execFileSync("git", ["ls-files", "Part2_Infrastructure/web"], {
      cwd: rootPath,
      encoding: "utf8",
    }).trim().split("\n").filter(Boolean);
    assert.ok(tracked.length > 100, "git ls-files returned suspiciously few web paths — is this running from the repo?");

    const scratch = mkdtempSync(path.join(tmpdir(), "vercelignore-collision-"));
    try {
      execFileSync("git", ["init", "-q", scratch]);
      writeFileSync(path.join(scratch, ".gitignore"), vercelignore);
      for (const rel of tracked) {
        const full = path.join(scratch, rel);
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, "");
      }

      // Exit 1 with empty stdout means nothing matched — the passing case.
      // Exit 0 means at least one path was dropped; its name is on stdout.
      let matched = "";
      try {
        matched = execFileSync("git", ["check-ignore", "--stdin"], {
          cwd: scratch,
          input: tracked.join("\n"),
          encoding: "utf8",
        });
      } catch (error) {
        const failure = error as { status?: number; stdout?: string };
        if (failure.status !== 1) {
          matched = failure.stdout ?? "";
          if (!matched) throw error;
        }
      }

      const dropped = matched.split("\n").map((line) => line.trim()).filter(Boolean);
      assert.deepEqual(
        dropped,
        [],
        `.vercelignore silently drops path(s) the web project ships: ${dropped.join(", ")} — `
          + "add a leading `/` to whichever pattern matched, so it only fires at the repo root",
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
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

// ---------------------------------------------------------------------------
// The deploy pipeline's non-obvious corrections
// ---------------------------------------------------------------------------

const deployWorkflow = readFileSync(
  fileURLToPath(new URL(".github/workflows/deploy.yml", root)), "utf8");

describe("continuous deployment keeps the desk alive across a swap", () => {
  it("lowercases the image path", () => {
    /**
     * `github.repository` is `Manutd1234/Developer_Analyst_Infra` — capitals in
     * both halves. An OCI image reference may not contain them, and GHCR
     * rejects the push with "invalid reference format", which reads like a
     * syntax error in the workflow rather than a naming rule.
     */
    assert.match(
      deployWorkflow,
      /tr '\[:upper:\]' '\[:lower:\]'/,
      "the image path is no longer lowercased — the push to GHCR will fail",
    );
    assert.doesNotMatch(
      deployWorkflow,
      /images:\s*\$\{\{\s*env\.REGISTRY\s*\}\}\/\$\{\{\s*github\.repository\s*\}\}/,
      "github.repository is being used as an image path verbatim",
    );
  });

  it("carries the audit volume across the container swap", () => {
    /**
     * The DuckDB decision log lives on a named volume. A deploy without `-v`
     * gives the new container an empty /app/data — and DuckDB degrades to an
     * unwritable SQLite fallback rather than crashing, so discarding every
     * recorded decision looks exactly like a successful deploy.
     */
    assert.match(deployWorkflow, /-v "\$\{VOLUME\}:\/app\/data"/);
    assert.match(deployWorkflow, /docker volume create "\$VOLUME"/);
    /**
     * The name must carry compose's project prefix. docker-compose.yml declares
     * `name: alphaengine` and a volume `alphaengine_audit`, so what exists on
     * the host is `alphaengine_alphaengine_audit`. Deploying against the
     * unprefixed name mounts a different, empty volume — the history is
     * orphaned rather than deleted, and the desk returns with a blank audit
     * trail indistinguishable from a clean install.
     */
    const compose = readFileSync(fileURLToPath(new URL("docker-compose.yml", root)), "utf8");
    const project = /^name:\s*(\S+)/m.exec(compose)?.[1];
    const declared = /^volumes:\s*\n\s{2}(\w+):/m.exec(compose)?.[1];
    assert.ok(project && declared, "compose no longer declares a project name and a volume");
    assert.match(
      deployWorkflow,
      new RegExp(`VOLUME: ${project}_${declared}\\b`),
      `the deploy must mount ${project}_${declared} — the name compose actually creates`,
    );
    // `docker rm` must never take the volume with it.
    assert.doesNotMatch(deployWorkflow, /docker rm\s+(-v|--volumes)/);
  });

  it("publishes the port the container actually listens on", () => {
    const dockerfile = readFileSync(
      fileURLToPath(new URL("Part2_Infrastructure/docker/gateway.Dockerfile", root)), "utf8");
    const exposed = /EXPOSE (\d+)/.exec(dockerfile)?.[1];
    assert.equal(exposed, "8000", "the Dockerfile's EXPOSE moved");
    assert.match(deployWorkflow, /PORT: "8000"/);
    assert.match(deployWorkflow, /-p "\$\{PORT\}:8000"/);
  });

  it("gives the deploy job permission to pull what the build job pushed", () => {
    // Job permissions do not inherit. Without this the GITHUB_TOKEN sent to the
    // VM cannot read the package it just published.
    const deployJob = deployWorkflow.slice(deployWorkflow.indexOf("\n  deploy:"));
    assert.match(deployJob.slice(0, deployJob.indexOf("steps:")), /packages: read/);
  });

  it("does not interpolate secrets into the remote command line", () => {
    // Interpolated secrets are substituted into the command the VM runs, where
    // they sit in its process list and shell history. `envs:` avoids that.
    // The remote script body only. The step's own `env:` block that follows it
    // is where `${{ secrets.* }}` legitimately belongs — that is the mechanism
    // being asserted, not a violation of it.
    const start = deployWorkflow.indexOf("script: |");
    const script = deployWorkflow.slice(start, deployWorkflow.indexOf("\n        env:", start));
    assert.doesNotMatch(
      script,
      /\$\{\{\s*secrets\./,
      "a secret is being interpolated into the SSH script — pass it through `envs:` instead",
    );
    assert.match(deployWorkflow, /envs: IMAGE,REGISTRY/);
  });

  it("merges the runtime environment instead of overwriting it", () => {
    /**
     * The env file is the container's whole configuration, but CI only knows
     * the part of it that exists as a repository secret. When this was written
     * the VM was running 17 variables and CI had a secret for exactly one, so
     * a truncating rewrite would have dropped the Telegram bot token, the
     * Supabase mirror credentials and RESEARCH_RAG_ENABLED — and the container
     * would still have come back healthy, passed its health check and passed
     * the external reachability probe. A deploy that silently disables three
     * subsystems and reports success is the failure this guards.
     *
     * The awk merge is asserted directly: CI's values are written first so
     * they win, and any key the overlay did not set is carried over.
     */
    assert.match(deployWorkflow, /seen\[\$1\]=1/, "the env-file merge is gone — a deploy would truncate VM-only configuration");
    assert.match(deployWorkflow, /!\(\$1 in seen\)/);
    assert.match(deployWorkflow, /LEGACY_ENV=/, "the first deploy no longer seeds from the hand-managed .env");

    // The overlay must be built into its own file, never straight over the
    // destination — `> "$ENV_FILE"` before the merge would destroy the very
    // thing being preserved.
    assert.match(deployWorkflow, /\}\s*>\s*"\$OVERLAY"/);

    // Reporting the result must stay names-only. `cat`-ing the merged file
    // would put a bot token and a service-role key into a build log that
    // anyone with read access to the repository can retrieve.
    const script = deployWorkflow.slice(deployWorkflow.indexOf("script: |"));
    assert.doesNotMatch(
      script,
      /cat "\$ENV_FILE"/,
      "the merged env file is being printed to the build log — it holds live credentials",
    );
    assert.match(script, /cut -d= -f1 "\$ENV_FILE"/, "the summary should print variable names only");
  });

  it("verifies the deploy and can undo it", () => {
    // A deploy that cannot be verified reports success over a dead desk.
    assert.match(deployWorkflow, /State\.Health\.Status/);
    assert.match(deployWorkflow, /Rolling back/);
    assert.match(deployWorkflow, /start_container "\$PREVIOUS"/);
  });

  it("allows the gateway its shutdown window", () => {
    // main.py writes a final gateway_stop risk event and closes the audit log
    // on SIGTERM; the 10s default risks SIGKILL mid-write and a stranded WAL.
    assert.match(deployWorkflow, /docker stop --time 20/);
    const compose = readFileSync(fileURLToPath(new URL("docker-compose.yml", root)), "utf8");
    assert.match(compose, /stop_grace_period: 20s/, "compose and deploy disagree on the window");
  });

  it("runs the suite before it ships anything", () => {
    const build = deployWorkflow.slice(deployWorkflow.indexOf("\n  build:"));
    assert.match(build.slice(0, build.indexOf("steps:")), /needs: verify/);
  });

  it("proves reachability from outside the VM", () => {
    // Healthy on 127.0.0.1 says nothing about whether Vercel can reach it,
    // which is the only thing that makes the web UI render live data.
    assert.match(deployWorkflow, /reachable:/);
    assert.match(deployWorkflow, /security list/i);
  });
});
