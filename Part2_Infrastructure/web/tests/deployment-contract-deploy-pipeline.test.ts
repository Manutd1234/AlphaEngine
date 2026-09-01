/**
 * The container deploy pipeline's non-obvious corrections.
 *
 * Every assertion in this file is a scar. The deploy workflow swaps a running
 * container on a VM, and each of the defects pinned here shipped, reported
 * SUCCESS, and was found afterwards — which is the property that makes them
 * worth a test rather than a review comment. A deploy that fails loudly costs
 * nothing; these are the ways it can fail silently:
 *
 *  - The audit volume left behind on the swap. DuckDB degrades to an unwritable
 *    SQLite fallback rather than crashing, so discarding every recorded
 *    decision looks exactly like a successful deploy — and mounting the
 *    unprefixed volume name orphans the history rather than deleting it, which
 *    is indistinguishable from a clean install.
 *  - The env file truncated instead of merged. CI knows only the variables that
 *    exist as repository secrets; the VM was running 17 and CI had one. A
 *    rewrite drops the bot token, the Supabase mirror and the RAG flag, and the
 *    container still comes back healthy and still passes the reachability
 *    probe. It happened, and the next deploy read the 0-byte file as valid
 *    prior state.
 *  - A quoted program spanning lines. The script reaches the VM with CRLF
 *    endings; bash tolerates a trailing carriage return and awk does not. The
 *    bug existed only in transit and could not be reproduced on the VM.
 *  - `put()` without an unconditional `return 0`. An absent optional secret
 *    made a shell group exit 1, and the deploy died there with no stderr.
 *  - The merged env file `cat`-ed to the build log, where it is a live
 *    service-role key retrievable by anyone with read access to the repository.
 *
 * The upload drop-list is in `deployment-contract-upload-scope.test.ts`; the
 * Oracle, Supabase and CI configuration surfaces in
 * `deployment-contract-config-surfaces.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/deployment-files";

const deployWorkflow = readRepoFile(".github/workflows/deploy.yml");

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
    const compose = readRepoFile("docker-compose.yml");
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
    const dockerfile = readRepoFile("Part2_Infrastructure/docker/gateway.Dockerfile");
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
    const start = deployWorkflow.search(/^\s{10}script: \|$/m);
    const script = deployWorkflow.slice(start, deployWorkflow.indexOf("\n        env:", start));
    /**
     * The slice is anchored before it is scanned. `indexOf` returns -1 for a
     * renamed step, `slice(-1, …)` yields an empty string, and a
     * `doesNotMatch` over nothing is green for ever — the exact shape this
     * whole file exists to keep out of the deploy path.
     */
    assert.ok(start > 0 && script.includes("start_container"), "the remote script block was not found");
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
    assert.match(deployWorkflow, /s\[\$1\]=1/, "the env-file merge is gone — a deploy would truncate VM-only configuration");
    assert.match(deployWorkflow, /!\(\$1 in s\)/);
    assert.match(deployWorkflow, /LEGACY_ENV=/, "the first deploy no longer seeds from the hand-managed .env");

    // The overlay must be built into its own file, never straight over the
    // destination — `> "$ENV_FILE"` before the merge would destroy the very
    // thing being preserved.
    assert.match(deployWorkflow, /printf '%s=%s\\n' "\$1" "\$2" >> "\$OVERLAY"/);

    /**
     * `put` must swallow the absent case itself.
     *
     * The first version of this wrote the overlay as a `{ … } > "$OVERLAY"`
     * group whose last statement was `[ -n "${VAR:-}" ] && echo …`. When that
     * variable was absent the group's exit status was 1, and the deploy died
     * there — silently, with no stderr, immediately after the preceding echo.
     * It behaved correctly in bash on the same VM when run directly, so the
     * status only mattered through the SSH action's own execution path. The
     * shape is the bug, not the shell: an unconditional `return 0` means a
     * variable nobody configured can never end a deploy.
     */
    assert.match(deployWorkflow, /put\(\)\s*\{[\s\S]*?return 0[\s\S]*?\}/,
      "put() no longer force-returns 0 — an absent optional secret can abort the deploy again");
    const overlayWrites = deployWorkflow.match(/^\s*\[ -n "\$\{[A-Z_]+:-\}" \]\s+&&\s+echo/gm) ?? [];
    assert.deepEqual(overlayWrites, [],
      "a bare `[ -n … ] && echo` is back in the remote script; use put() so the exit status cannot end the deploy");

    // Reporting the result must stay names-only. `cat`-ing the merged file to
    // stdout would put a bot token and a service-role key into a build log
    // that anyone with read access to the repository can retrieve. Reading it
    // into another file is fine and is how the merge carries values forward —
    // so this looks for a `cat` with no redirect, not for `cat` at all.
    const body = deployWorkflow.slice(deployWorkflow.indexOf("script: |"));
    assert.doesNotMatch(
      body,
      /cat "\$(ENV_FILE|LEGACY_ENV)"(?!\s*>)/,
      "the env file is being printed to the build log — it holds live credentials",
    );
    assert.match(body, /cut -d= -f1 "\$MERGED"/, "the summary should print variable names only");

    /**
     * The merge must land atomically.
     *
     * `awk … > "$ENV_FILE"` truncates the destination before awk runs, so a
     * failing merge leaves a 0-byte file that the *next* deploy reads as valid
     * prior state. That is not hypothetical: it happened, and the following
     * deploy started the gateway with 5 variables instead of 18 — no bot, no
     * Supabase mirror, no RAG indexer — while every check reported success.
     * Writing to a scratch path and moving it into place means a failed merge
     * leaves the previous configuration untouched.
     */
    // Comment-stripped: the prose above this block quotes the very command it
    // forbids (`awk … > "$ENV_FILE"`) to explain why, and matching against the
    // explanation instead of the code is a way to fail on documentation.
    const code = body.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    assert.match(code, /> "\$MERGED"/, "the merge writes straight onto the live env file again");
    assert.match(code, /mv "\$MERGED" "\$ENV_FILE"/);
    assert.doesNotMatch(code, /awk[^\n]*> "\$ENV_FILE"/, "awk redirects onto the live env file");
    assert.match(
      body,
      /grep -q '\^WEB_API_TOKEN=' "\$MERGED"/,
      "nothing checks the merged file still has WEB_API_TOKEN before installing it",
    );
  });

  it("forwards the scoped Supabase and Neo4j read-model configuration deterministically", () => {
    const remoteEnvs = /^\s*envs: ([^\n]+)$/m.exec(deployWorkflow)?.[1] ?? "";
    const forwarded = [
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_DESK_ID",
      "SUPABASE_MIRROR_ENABLED",
      "RESEARCH_RAG_ENABLED",
      "RESEARCH_SCOPE_TO_DESK",
      "NEO4J_URI",
      "NEO4J_USERNAME",
      "NEO4J_PASSWORD",
      "NEO4J_DATABASE",
    ];
    for (const name of forwarded) {
      assert.ok(
        remoteEnvs.split(",").includes(name),
        `${name} is not forwarded through the SSH action`,
      );
      assert.match(
        deployWorkflow,
        new RegExp(`put ${name}\\b`),
        `${name} is forwarded to the VM but never written into the container env`,
      );
    }

    assert.match(deployWorkflow, /SUPABASE_MIRROR_ENABLED: \$\{\{ vars\.SUPABASE_MIRROR_ENABLED \|\| '1' \}\}/);
    assert.match(deployWorkflow, /RESEARCH_RAG_ENABLED: \$\{\{ vars\.RESEARCH_RAG_ENABLED \|\| '1' \}\}/);
    assert.match(deployWorkflow, /RESEARCH_SCOPE_TO_DESK: \$\{\{ vars\.RESEARCH_SCOPE_TO_DESK \|\| '1' \}\}/);
    assert.doesNotMatch(
      deployWorkflow,
      /put DATA_OPS_BACKEND/,
      "Supabase is a mirror and research authority here; OCI's production ledger must not be silently replaced",
    );
  });

  it("supports independent demo or production signing and intentional revocation", () => {
    const start = deployWorkflow.indexOf("- name: Required secrets are present");
    const end = deployWorkflow.indexOf("- name: Pull, swap, verify, roll back on failure", start);
    assert.ok(start > 0 && end > start, "the required-secret preflight step was not found");
    const preflight = deployWorkflow.slice(start, end);

    const halfPair = preflight.indexOf("must be configured together");
    const invalidRevoke = preflight.indexOf("KALSHI_DEMO_REVOKE must be 0 or 1");
    const revokeConflict = preflight.indexOf("conflicts with a configured demo credential");
    const genericMissing = preflight.indexOf("Missing repository secrets");
    assert.ok(
      halfPair > 0
        && invalidRevoke > halfPair
        && revokeConflict > invalidRevoke
        && genericMissing > revokeConflict,
      "the generic missing-secret exit hides the actionable Kalshi pair/revoke diagnostic",
    );
    assert.doesNotMatch(
      preflight,
      /missing\+=\("KALSHI_DEMO_(?:KEY_ID|PRIVATE_KEY_PEM_B64)"\)/,
      "a production-only deployment must not be forced to retain demo credentials",
    );
    const canary = deployWorkflow.slice(
      deployWorkflow.indexOf("Confirming the authenticated private maker channel state"),
      deployWorkflow.indexOf("unset RFQ_JSON"),
    );
    assert.match(canary, /environment=tunables\.preferred_rfq_signing_environment\(\)/);
    assert.match(canary, /status\(environment\)\["available"\]/);
    assert.match(canary, /f"\{environment\}_unavailable"/,
      "present but invalid production material must not silently select demo");
    assert.match(canary, /"signing_environment" in payload or fail/);
    assert.match(canary, /state in \{"empty", "requests_only", "available"\} and reported == expectation/,
      "the canary must prove both a signed read and its selected environment");
    assert.match(canary, /expectation != "none" or \(state == "signing_unavailable" and reported is None\)/,
      "explicitly removing every credential must still prove the typed no-signing state");
    assert.match(canary, /configured \{expected_environment\} signing is unusable/,
      "an invalid configured pair must fail deployment after proving there was no demo fallback");
  });

  it("rebuilds the scoped research read model before the replacement scheduler starts", () => {
    const bootstrap = deployWorkflow.indexOf("python tools/reconcile_research_once.py");
    const cutover = deployWorkflow.indexOf('echo "==> Stopping the current container"', bootstrap);
    const stop = deployWorkflow.indexOf('docker stop --time 20 "$CONTAINER"', cutover);
    const remove = deployWorkflow.indexOf('remove_container_checked "$CONTAINER"', stop);
    const replacement = deployWorkflow.indexOf('start_container "$IMAGE"', remove);
    assert.ok(bootstrap > 0 && cutover > bootstrap && stop > cutover && remove > stop && replacement > remove,
      "the bounded one-shot must finish while the old gateway serves, immediately before replacement cutover");

    const preflight = deployWorkflow.slice(
      deployWorkflow.lastIndexOf("RESEARCH_BOOTSTRAP_CONTAINER=", bootstrap),
      cutover,
    );
    assert.match(preflight, /timeout --signal=TERM --kill-after=10s 180s/);
    assert.match(preflight, /docker run --rm[\s\S]*--env-file "\$ENV_FILE"/);
    assert.match(preflight, /--limit 200/);
    assert.match(preflight, /--sweep "deploy-\$\{KALSHI_KEY_SLOT\}"/);
    assert.match(
      preflight,
      /scoped Supabase-to-Neo4j rebuild[\s\S]*unwind_unstarted_replacement/,
      "a failed or timed-out rebuild must unwind the candidate transaction while the old gateway stays live",
    );
    assert.doesNotMatch(preflight, /docker stop[^\n]*"\$CONTAINER"|remove_container_checked "\$CONTAINER"/,
      "the old gateway must remain present throughout the bounded research preflight");
    assert.doesNotMatch(preflight, /curl[^\n]*research/,
      "the bootstrap must stay an in-container one-shot, not expose or call a write route");

    const unwind = deployWorkflow.slice(
      deployWorkflow.indexOf("unwind_unstarted_replacement() {"),
      deployWorkflow.indexOf('REPLACEMENT_GATEWAY="$IMAGE"'),
    );
    const runningState = unwind.indexOf("{{.State.Running}}");
    const stoppedBranch = unwind.indexOf('[ "$prior_running" != "true" ]', runningState);
    const restart = unwind.indexOf('docker start "$CONTAINER"', stoppedBranch);
    assert.ok(runningState > 0 && stoppedBranch > runningState && restart > stoppedBranch,
      "preflight unwind must leave an already-running prior gateway untouched");

    const cutoverBlock = deployWorkflow.slice(cutover, replacement);
    assert.doesNotMatch(cutoverBlock, /reconcile_research_once|timeout --signal/,
      "no bounded preflight may widen the old-gateway-to-replacement outage window");
    assert.match(cutoverBlock, /docker stop --time 20[\s\S]*remove_container_checked "\$CONTAINER"/);
  });

  it("embeds no multi-line quoted program in the remote script", () => {
    /**
     * The script reaches the VM through the SSH action with CRLF endings.
     * bash tolerates a trailing carriage return; an interpreter reading a
     * quoted program does not, and the merge awk failed in CI with
     * `awk: line 2: syntax error at or near ?` — `?` being how awk prints a
     * CR. It ran perfectly when the same file was placed on the same VM with
     * LF endings, so the bug existed only in transit and could not be
     * reproduced by testing there.
     *
     * Counting quote parity per line catches any future `awk '…`, `sed '…` or
     * `python -c '…` that spans lines, which is the whole class.
     */
    const starts = [...deployWorkflow.matchAll(/^\s{10}script: \|$/gm)].map((match) => match.index ?? -1);
    assert.equal(starts.length, 2, "both SSH script blocks must be inspected");
    const scripts = starts.map((start) => {
      const end = deployWorkflow.indexOf("\n        env:", start);
      assert.ok(end > start, "an SSH script no longer ends at its env block");
      return deployWorkflow.slice(start, end);
    });
    assert.ok(scripts[0].includes("start_container") && scripts[1].includes("start_caddy"));
    // Comment lines are dropped first. The shell never interprets them, but
    // they are full of English apostrophes ("the container's own health check")
    // and counting those would flag the prose that explains the very hazard
    // this checks for.
    const unbalanced = scripts.flatMap((script, scriptIndex) => script
      .split("\n")
      .map((line, index) => ({ line, index, scriptIndex }))
      .filter(({ line }) => !line.trim().startsWith("#"))
      .filter(({ line }) => (line.split("'").length - 1) % 2 === 1));

    assert.deepEqual(
      unbalanced.map(({ scriptIndex, index, line }) => `script ${scriptIndex + 1}, line ${index}: ${line.trim().slice(0, 60)}`),
      [],
      "a single-quoted program spans lines in the remote script — put it on one line, "
        + "or CRLF in transit will corrupt it",
    );
  });

  it("allows the gateway its shutdown window", () => {
    // main.py writes a final gateway_stop risk event and closes the audit log
    // on SIGTERM; the 10s default risks SIGKILL mid-write and a stranded WAL.
    assert.match(deployWorkflow, /docker stop --time 20/);
    const compose = readRepoFile("docker-compose.yml");
    assert.match(compose, /stop_grace_period: 20s/, "compose and deploy disagree on the window");
  });

  it("runs the suite before it ships anything", () => {
    const verify = deployWorkflow.slice(
      deployWorkflow.indexOf("\n  verify:"),
      deployWorkflow.indexOf("\n  build:"),
    );
    assert.match(verify, /node --import tsx --test tests\/deployment-contract-\*\.test\.ts/);
    assert.match(verify, /for target in 1 2; do[\s\S]*bash -n/);
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
