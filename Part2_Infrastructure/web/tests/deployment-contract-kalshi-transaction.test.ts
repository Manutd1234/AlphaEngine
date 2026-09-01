/**
 * Crash-safe gateway, TLS and Kalshi credential rotation contracts.
 *
 * These checks live apart from the older deployment scars because ordering is
 * the contract here: a run-scoped key may be retired only after the process,
 * persistent env and TLS sidecar have reached one verified transaction state.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/deployment-files";

const workflow = readRepoFile(".github/workflows/deploy.yml");
const rfqRoute = readRepoFile("Part2_Infrastructure/web/app/api/gateway/coherence/rfq/route.ts");

describe("gateway and Kalshi rotation are one guarded transaction", () => {
  it("routes Makers through the server while the Kalshi credential stays on the gateway", () => {
    assert.doesNotMatch(
      workflow,
      /script_stop:/,
      "appleboy/ssh-action no longer accepts script_stop; each remote script owns set -euo pipefail",
    );
    assert.match(rfqRoute, /callGateway\("\/api\/coherence\/rfq"/);
    assert.match(rfqRoute, /runtime = "nodejs"/);
    assert.match(rfqRoute, /"Cache-Control": "no-store"/);
    assert.doesNotMatch(rfqRoute, /KALSHI_DEMO_|NEXT_PUBLIC_/);

    assert.match(workflow, /KALSHI_DEMO_KEY_ID: \$\{\{ secrets\.KALSHI_DEMO_KEY_ID \}\}/);
    assert.match(
      workflow,
      /KALSHI_DEMO_PRIVATE_KEY_PEM_B64: \$\{\{ secrets\.KALSHI_DEMO_PRIVATE_KEY_PEM_B64 \}\}/,
    );
    assert.match(workflow, /KALSHI_PRODUCTION_KEY_ID: \$\{\{ secrets\.KALSHI_PRODUCTION_KEY_ID \}\}/);
    assert.match(
      workflow,
      /KALSHI_PRODUCTION_PRIVATE_KEY_PEM_B64: \$\{\{ secrets\.KALSHI_PRODUCTION_PRIVATE_KEY_PEM_B64 \}\}/,
    );
    assert.match(workflow, /put KALSHI_DEMO_PRIVATE_KEY_PATH "\$KALSHI_KEY_PATH"/);
    assert.match(
      workflow,
      /put KALSHI_PRODUCTION_PRIVATE_KEY_PATH "\$KALSHI_PRODUCTION_KEY_PATH"/,
    );
    assert.doesNotMatch(
      workflow,
      /put KALSHI_(?:DEMO|PRODUCTION)_PRIVATE_KEY_PEM_B64/,
      "private-key bytes must never enter the container environment",
    );
  });

  it("requires the demo pair and rejects a half-configured optional production reference pair", () => {
    const start = workflow.indexOf("- name: Required secrets are present");
    const end = workflow.indexOf("- name: Pull, swap, verify, roll back on failure", start);
    assert.ok(start > 0 && end > start, "the deploy credential gate was not found");
    const gate = workflow.slice(start, end);
    const revokeConflict = gate.indexOf("KALSHI_DEMO_REVOKE=1 conflicts");
    const normalStart = gate.indexOf('if [ "$KALSHI_DEMO_REVOKE" = "0" ]');
    const genericMissing = gate.indexOf("Missing repository secrets", normalStart);
    assert.ok(revokeConflict > 0 && normalStart > revokeConflict && genericMissing > normalStart);

    const normalMode = gate.slice(normalStart, genericMissing);
    assert.match(normalMode, /\[ -n "\$KALSHI_DEMO_KEY_ID" \] \|\| missing\+=\("KALSHI_DEMO_KEY_ID"\)/);
    assert.match(normalMode, /\[ -n "\$KALSHI_DEMO_PRIVATE_KEY_PEM_B64" \] \|\| missing\+=\("KALSHI_DEMO_PRIVATE_KEY_PEM_B64"\)/);
    assert.doesNotMatch(
      gate.slice(0, normalStart),
      /missing\+=\("KALSHI_DEMO_(?:KEY_ID|PRIVATE_KEY_PEM_B64)"\)/,
      "revoke=1 with both credentials absent must reach the remote tombstone transaction",
    );
    assert.match(
      gate,
      /\[ -n "\$KALSHI_PRODUCTION_KEY_ID" \] && \[ -z "\$KALSHI_PRODUCTION_PRIVATE_KEY_PEM_B64" \]/,
    );
    assert.match(
      gate,
      /\[ -z "\$KALSHI_PRODUCTION_KEY_ID" \] && \[ -n "\$KALSHI_PRODUCTION_PRIVATE_KEY_PEM_B64" \]/,
    );
    assert.doesNotMatch(
      gate,
      /missing\+=\("KALSHI_PRODUCTION_(?:KEY_ID|PRIVATE_KEY_PEM_B64)"\)/,
      "both production secrets absent is allowed and preserves the deployed production pair",
    );
    assert.match(gate, /KALSHI_PRODUCTION_REVOKE must be 0 or 1/);
    assert.match(gate, /KALSHI_PRODUCTION_REVOKE=1 conflicts with a configured production credential/);
    const productionTombstone = workflow.indexOf("WITHOUT_KALSHI_PRODUCTION=");
    const productionRevoke = workflow.lastIndexOf(
      'if [ "$KALSHI_PRODUCTION_REVOKE" = "1" ]; then',
      productionTombstone,
    );
    assert.ok(productionTombstone > 0 && productionRevoke > 0);
    assert.doesNotMatch(
      workflow.slice(productionRevoke, productionTombstone),
      /KALSHI_PRODUCTION_KEY_ID:-/,
      "ordinary secret absence must not enter the production tombstone transaction",
    );
    assert.doesNotMatch(
      workflow,
      /if \[ -z "\$\{KALSHI_PRODUCTION_KEY_ID:-\}" \]; then/,
      "an unrelated deploy with no rotation secrets must preserve the active production pair",
    );
    assert.match(workflow, /sed -E '\/\^KALSHI_PRODUCTION_\(KEY_ID\|PRIVATE_KEY_PATH\)=\/d'/);
    assert.match(
      workflow,
      /printf 'KALSHI_PRODUCTION_KEY_ID=\\nKALSHI_PRODUCTION_PRIVATE_KEY_PATH=\\n' >> "\$PRESERVED"/,
      "explicit revocation must tombstone an old host-side production credential",
    );
  });

  it("accepts normal signing or explicit revocation only after a token-authenticated Makers proof", () => {
    const health = workflow.indexOf('if ! HEALTH_JSON=$(curl -fsS "http://127.0.0.1:${PORT}/health")');
    const makers = workflow.indexOf('echo "==> Confirming the authenticated private maker channel state"');
    const deployed = workflow.indexOf('echo "==> Deployed', makers);
    assert.ok(health > 0 && makers > health && deployed > makers);
    const canary = workflow.slice(makers, deployed);
    assert.match(canary, /X-AlphaEngine-Token: \$\{WEB_API_TOKEN\}/);
    assert.match(canary, /\/api\/coherence\/rfq/);
    assert.match(canary, /if \[ "\$KALSHI_DEMO_REVOKE" = "1" \]; then/);
    assert.match(canary, /"signing_unavailable"[\s\S]*KALSHI_DEMO_KEY_ID/);
    assert.match(canary, /Private Makers credential revocation verified/);
    assert.match(canary, /"\(empty\|available\)"/);
    assert.match(canary, /rollback_gateway/);
    assert.match(canary, /refusing signing_unavailable, refused, and transport-degraded states/);
    assert.match(workflow, /KALSHI_PRODUCTION_REVOKE: \$\{\{ vars\.KALSHI_PRODUCTION_REVOKE \|\| '0' \}\}/);
    assert.match(
      workflow,
      /if \[ "\$KALSHI_PRODUCTION_REVOKE" = "1" \]; then[\s\S]*status\("production"\)[\s\S]*key_id_missing[\s\S]*Production reference credential revocation verified/,
    );
  });

  it("distinguishes a verified absent prior gateway from an inspect failure", () => {
    const start = workflow.indexOf('echo "==> Recording the running image');
    const end = workflow.indexOf('echo "==> Pulling ${IMAGE}"', start);
    const capture = workflow.slice(start, end);
    assert.match(capture, /docker container ls -a --format '\{\{\.Names\}\}'/);
    assert.match(capture, /grep -Fxq "\$CONTAINER" <<< "\$existing_containers"/);
    assert.match(capture, /docker inspect --format '\{\{\.Image\}\}' "\$CONTAINER"/);
    assert.doesNotMatch(capture, /docker inspect[^\n]*\|\| true/);
  });

  it("restores a prior gateway before committing its env and retiring the candidate key", () => {
    assert.match(workflow, /State\.Health\.Status/);
    assert.match(workflow, /ENV_BACKUP="\$\{ENV_FILE\}\.rollback"/);
    const start = workflow.indexOf("rollback_gateway() {");
    const end = workflow.indexOf("unwind_unstarted_replacement() {", start);
    const rollback = workflow.slice(start, end);
    const prepared = rollback.indexOf('cp "$ENV_BACKUP" "$ENV_RESTORE"');
    const removed = rollback.indexOf('remove_container_checked "$CONTAINER"');
    const restored = rollback.indexOf('start_container "$PREVIOUS" "$ENV_RESTORE"');
    const healthy = rollback.indexOf("if wait_for_gateway", restored);
    const envCommitted = rollback.indexOf('mv "$ENV_RESTORE" "$ENV_FILE"', healthy);
    const keyRetired = rollback.indexOf("if ! remove_candidate_key", envCommitted);
    const markerCleared = rollback.indexOf('rm -f "$CUTOVER_PENDING"', keyRetired);
    assert.ok(
      prepared > 0 && removed > prepared && restored > removed && healthy > restored
        && envCommitted > healthy && keyRetired > envCommitted && markerCleared > keyRetired,
      "rollback order must be prepare → remove → restore → health → env → key → marker",
    );
    assert.match(workflow, /docker container ls -a --format '\{\{\.Names\}\}'/);
    assert.match(workflow, /grep -Fxq "\$target_container" <<< "\$present_containers"/);
    assert.match(workflow, /fall_forward_gateway[\s\S]*start_container "\$REPLACEMENT_GATEWAY" "\$ENV_FILE"/);
    assert.doesNotMatch(rollback, /docker rm -f "\$CONTAINER"[^\n]*\|\| true/);
    assert.doesNotMatch(workflow, /rollback_(gateway|caddy) \|\| true/);
  });

  it("unwinds a removal failure before any replacement process has started", () => {
    const start = workflow.indexOf('echo "==> Stopping the current container"');
    const end = workflow.indexOf('echo "==> Starting ${IMAGE}"', start);
    const swap = workflow.slice(start, end);
    assert.match(
      swap,
      /if ! remove_container_checked "\$CONTAINER"; then[\s\S]*if ! unwind_unstarted_replacement; then/,
    );
    const unwindStart = workflow.indexOf("unwind_unstarted_replacement() {");
    const unwindEnd = workflow.indexOf('REPLACEMENT_GATEWAY="$IMAGE"', unwindStart);
    const unwind = workflow.slice(unwindStart, unwindEnd);
    const envRestored = unwind.indexOf('mv "$ENV_RESTORE" "$ENV_FILE"');
    const serviceRestored = unwind.indexOf('docker start "$CONTAINER"', envRestored);
    const keyRetired = unwind.indexOf("remove_candidate_key", serviceRestored);
    const markerCleared = unwind.indexOf('rm -f "$CUTOVER_PENDING"', keyRetired);
    assert.ok(envRestored > 0 && serviceRestored > envRestored
      && keyRetired > serviceRestored && markerCleared > keyRetired);
  });

  it("uses a run marker to detect interruption across gateway and TLS cutover", () => {
    const markerInstall = workflow.indexOf('mv "$CUTOVER_PENDING_NEXT" "$CUTOVER_PENDING"');
    const keyStaging = workflow.indexOf("==> Staging and verifying the Kalshi demo private key");
    const productionKeyStaging = workflow.indexOf(
      "==> Staging and verifying the Kalshi production reference private key",
    );
    const envInstall = workflow.indexOf('mv "$MERGED" "$ENV_FILE"', markerInstall);
    assert.ok(
      markerInstall > 0
        && keyStaging > markerInstall
        && productionKeyStaging > keyStaging
        && envInstall > productionKeyStaging,
      "marker must precede both key staging operations and the live env commit",
    );
    assert.match(
      workflow,
      /if \[ -e "\$HOME\/\.alphaengine\.env\.restore" \] \|\| \[ -e "\$HOME\/\.alphaengine\.cutover-pending" \]; then/,
      "a later deploy must refuse unresolved rollback or cutover state",
    );
    const failedInstall = workflow.slice(
      workflow.indexOf('if ! mv "$MERGED" "$ENV_FILE"; then'),
      workflow.indexOf("start_container() {"),
    );
    assert.match(failedInstall, /pending marker and candidate were preserved/);
    assert.doesNotMatch(failedInstall, /remove_candidate_key/);

    const cleanupStart = workflow.indexOf("clear_pending_after_candidate_cleanup() {");
    const cleanupEnd = workflow.indexOf("# Rollback is a code", cleanupStart);
    const cleanup = workflow.slice(cleanupStart, cleanupEnd);
    const keyRemoved = cleanup.indexOf("remove_candidate_key");
    const markerCleared = cleanup.indexOf('rm -f "$CUTOVER_PENDING"', keyRemoved);
    assert.ok(
      keyRemoved > 0 && markerCleared > keyRemoved,
      "failed staging must confirm candidate cleanup before clearing its marker",
    );
    assert.match(cleanup, /Candidate-key cleanup was not confirmed;[\s\S]*marker was retained/);

    const stagingStart = workflow.indexOf("if ! printf '%s' \"$KALSHI_DEMO_PRIVATE_KEY_PEM_B64\"");
    const canaryComment = workflow.indexOf("# This authenticated, read-only balance request", stagingStart);
    const stagingFailure = workflow.slice(stagingStart, canaryComment);
    assert.match(stagingFailure, /KALSHI_KEY_INSTALLED=1[\s\S]*clear_pending_after_candidate_cleanup/);

    const canaryStart = workflow.indexOf("if ! docker run --rm", canaryComment);
    const envInstallStart = workflow.indexOf('if ! mv "$MERGED" "$ENV_FILE"; then', canaryStart);
    const canaryFailure = workflow.slice(canaryStart, envInstallStart);
    assert.match(canaryFailure, /KalshiClient[\s\S]*clear_pending_after_candidate_cleanup/);
  });

  it("preserves the replacement-image fallback when immutable inspection fails", () => {
    const fallback = workflow.indexOf('REPLACEMENT_GATEWAY="$IMAGE"');
    const inspect = workflow.indexOf('if ! inspected_replacement_gateway="$(docker inspect', fallback);
    const commit = workflow.indexOf('REPLACEMENT_GATEWAY="$inspected_replacement_gateway"', inspect);
    assert.ok(fallback > 0 && inspect > fallback && commit > inspect);
    const failureBranch = workflow.slice(inspect, commit);
    assert.doesNotMatch(failureBranch, /REPLACEMENT_GATEWAY="\$\(docker inspect/);
    assert.match(failureBranch, /if ! inspected_replacement_gateway=/);
  });

  it("proves, rotates and revokes the demo credential without mutable PEM swaps", () => {
    assert.match(workflow, /KALSHI_KEY_SLOT: \$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/);
    assert.match(workflow, /kalshi-demo-private-key-\$\{KALSHI_KEY_SLOT\}\.pem/);
    assert.match(workflow, /KALSHI_DEMO_PRIVATE_KEY_PATH="\$KALSHI_KEY_PATH"/);
    assert.match(workflow, /-c 'set -eu; umask 077; incoming=/);
    assert.match(
      workflow,
      /KalshiClient\(base_url=tunables\.DEMO_BASE_URL, signed=True\)\.get\("\/portfolio\/balance"\)/,
      "the key ID and private key must complete an authenticated demo read",
    );
    assert.match(workflow, /KALSHI_DEMO_REVOKE=1 conflicts with a configured demo credential/);
    assert.match(workflow, /sed -E '\/\^KALSHI_DEMO_\(KEY_ID\|PRIVATE_KEY_PATH\)=\/d'/);
    assert.match(
      workflow,
      /printf 'KALSHI_DEMO_KEY_ID=\\nKALSHI_DEMO_PRIVATE_KEY_PATH=\\n' >> "\$PRESERVED"/,
      "revocation must tombstone both first-wins env entries",
    );
    assert.match(workflow, /find \/run\/secrets[^\n]*! -name "\$ACTIVE_KALSHI_KEY_NAME" -delete/);
    assert.match(workflow, /Inactive or revoked Kalshi demo key files remain in the private volume\."\s+exit 1/);
    assert.ok(
      workflow.indexOf("==> Staging and verifying the Kalshi demo private key")
        > workflow.indexOf("merged env is missing WEB_API_TOKEN"),
      "a candidate must not exist while its replacement env is still being built",
    );
    assert.doesNotMatch(
      workflow,
      /kalshi-demo-private-key\.pem\.rollback|kalshi-demo-private-key\.pem\.pending/,
      "immutable run-scoped PEMs must never be swapped in place",
    );
    assert.match(workflow, /KALSHI_PRODUCTION_KEY_VOLUME: alphaengine_kalshi_production_key/);
    assert.match(workflow, /kalshi-production-private-key-\$\{KALSHI_KEY_SLOT\}\.pem/);
    assert.match(
      workflow,
      /KALSHI_PRODUCTION_PRIVATE_KEY_PATH="\$KALSHI_PRODUCTION_KEY_PATH"/,
    );
    assert.match(workflow, /-v "\$\{KALSHI_PRODUCTION_KEY_VOLUME\}:\/run\/reference-secrets:ro"/);
    assert.match(
      workflow,
      /KalshiClient\(base_url=tunables\.PUBLIC_BASE_URL, signing_environment="production"\)\.account_limits\(\)/,
      "the production key ID and PEM must complete an authenticated production read before cutover",
    );
    assert.doesNotMatch(
      workflow,
      /kalshi-production-private-key\.pem\.rollback|kalshi-production-private-key\.pem\.pending/,
      "the production PEM must also rotate as an immutable run-scoped file",
    );
  });

  it("rolls TLS back through a verified config path and can fall forward", () => {
    const start = workflow.indexOf("TLS sidecar — Caddy");
    const tls = workflow.slice(start, workflow.indexOf("\n  reachable:", start));
    assert.ok(start > 0 && tls.includes("Caddyfile"), "the TLS sidecar step was not found");
    assert.match(tls, /pending_cutover_slot[\s\S]*different deployment run/);
    assert.match(tls, /REPLACEMENT_CADDY="\$\(docker image inspect --format '\{\{\.Id\}\}' caddy:2-alpine\)"/);
    assert.match(tls, /start_caddy\(\)[\s\S]*-v "\$2:\/etc\/caddy\/Caddyfile:ro"/);

    const rollbackStart = tls.indexOf("rollback_caddy() {");
    const rollbackEnd = tls.indexOf("write_caddyfile() {", rollbackStart);
    const rollback = tls.slice(rollbackStart, rollbackEnd);
    const prepared = rollback.indexOf('cp "$CADDY_BACKUP" "$CADDY_RESTORE"');
    const removed = rollback.indexOf("remove_container_checked alphaengine_caddy", prepared);
    const restored = rollback.indexOf('start_caddy "$PREVIOUS_CADDY" "$CADDY_RESTORE"');
    const healthy = rollback.indexOf("wait_for_tls", restored);
    const committed = rollback.indexOf('mv "$CADDY_COMMIT" "$CADDYFILE"', healthy);
    assert.ok(prepared > 0 && removed > prepared && restored > removed
      && healthy > restored && committed > healthy,
    "Caddy rollback must prepare → remove → restore → health → commit");
    assert.match(rollback, /fall_forward_caddy/);
    assert.match(tls, /fall_forward_caddy[\s\S]*start_caddy "\$REPLACEMENT_CADDY" "\$replacement_config"/);
    const cutover = tls.slice(
      tls.indexOf('echo "==> Starting Caddy"'),
      tls.indexOf('if ! start_caddy "$REPLACEMENT_CADDY"', tls.indexOf('echo "==> Starting Caddy"')),
    );
    assert.match(cutover, /if ! remove_container_checked alphaengine_caddy; then[\s\S]*if restore_unstarted_caddy; then/);
  });

  it("applies the same health-before-env-before-key order in TLS gateway rollback", () => {
    const start = workflow.indexOf("TLS sidecar — Caddy");
    const tls = workflow.slice(start, workflow.indexOf("\n  reachable:", start));
    const rollbackStart = tls.indexOf("rollback_gateway() {");
    const rollbackEnd = tls.indexOf("clear_cutover_after_rollback() {", rollbackStart);
    const rollback = tls.slice(rollbackStart, rollbackEnd);
    const prepared = rollback.indexOf('cp "$ENV_BACKUP" "$ENV_RESTORE"');
    const removed = rollback.indexOf('remove_container_checked "$CONTAINER"', prepared);
    const restored = rollback.indexOf('start_gateway "$PREVIOUS_GATEWAY" "$ENV_RESTORE"', removed);
    const healthy = rollback.indexOf("if wait_for_gateway", restored);
    const envCommitted = rollback.indexOf('mv "$ENV_RESTORE" "$ENV_FILE"', healthy);
    const keyRetired = rollback.indexOf("remove_candidate_key", envCommitted);
    assert.ok(prepared > 0 && removed > prepared && restored > removed
      && healthy > restored && envCommitted > healthy && keyRetired > envCommitted);
    assert.match(rollback, /fall_forward_gateway/);
    assert.match(tls, /KALSHI_PRODUCTION_KEY_VOLUME/);
    assert.match(tls, /-v "\$\{KALSHI_PRODUCTION_KEY_VOLUME\}:\/run\/reference-secrets:ro"/);
  });

  it("clears the cross-service marker only after complete rollback or key pruning", () => {
    const start = workflow.indexOf("TLS sidecar — Caddy");
    const tls = workflow.slice(start, workflow.indexOf("\n  reachable:", start));
    assert.match(
      tls,
      /if \[ "\$gateway_rollback_ok" != "1" \] \|\| \[ "\$caddy_rollback_ok" != "1" \]; then\s+return 1/,
    );
    assert.match(tls, /clear_cutover_after_rollback "\$GATEWAY_ROLLBACK_OK" "\$CADDY_ROLLBACK_OK"/);
    const prune = tls.lastIndexOf('find /run/secrets -maxdepth 1');
    const productionPrune = tls.lastIndexOf('find /run/reference-secrets -maxdepth 1');
    const finalMarkerClear = tls.lastIndexOf('rm -f "$CUTOVER_PENDING"');
    assert.ok(prune > 0 && productionPrune > prune && finalMarkerClear > productionPrune,
      "normal commit must prune inactive demo and production keys before clearing the run marker");
    assert.match(tls, /ACTIVE_KALSHI_PRODUCTION_KEY_PATH=.*KALSHI_PRODUCTION_PRIVATE_KEY_PATH/);
    assert.match(
      tls,
      /kalshi-production-private-key\*" ! -name "\$ACTIVE_KALSHI_PRODUCTION_KEY_NAME" -delete/,
      "pruning must preserve the production key named by the committed environment",
    );
    const imagePrune = tls.lastIndexOf('docker image prune -f');
    assert.ok(imagePrune > finalMarkerClear,
      "rollback images must remain until gateway, key and TLS commit is irreversible");
  });
});
