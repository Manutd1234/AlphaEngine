import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readRepoFile } from "./helpers/deployment-files";

const deployWorkflow = readRepoFile(".github/workflows/deploy.yml");

describe("continuous deployment restores the Diffusion evidence ledger", () => {
  it("does not let an optional research read model block the core gateway", () => {
    const start = deployWorkflow.indexOf("- name: Required secrets are present");
    const end = deployWorkflow.indexOf("- name: Pull, swap, verify, roll back on failure", start);
    assert.ok(start > 0 && end > start, "the required-secret preflight step was not found");
    const required = deployWorkflow.slice(start, end);
    assert.doesNotMatch(
      required,
      /missing\+=\("(?:SUPABASE_|NEO4J_)/,
      "an optional Supabase/Neo4j read model is blocking the gateway image swap again",
    );

    assert.match(
      deployWorkflow,
      /Supabase URL is configured for public probes; no rotation pair was supplied/,
      "the shared public probe URL must not create an amber deployment annotation",
    );
    assert.match(deployWorkflow, /::warning::A Supabase service-role key without its URL was ignored/);
    assert.doesNotMatch(deployWorkflow, /::warning::A partial Supabase repository pair/);
    assert.match(deployWorkflow, /A partial Neo4j repository group was ignored/);
    assert.match(
      deployWorkflow,
      /python -c 'from config import settings as s; raise SystemExit\(0 if s\.research_rag_enabled[\s\S]*?else 1\)'/,
      "the deploy no longer distinguishes a configured research projection from an optional absent one",
    );
    assert.match(
      deployWorkflow,
      /Supabase-to-Neo4j reconciliation is not configured; continuing with the core gateway/,
    );
  });

  it("proves Diffusion history is populated before accepting a healthy replacement", () => {
    const healthy = deployWorkflow.indexOf('echo "==> Healthy. Confirming the port answers"');
    const diffusion = deployWorkflow.indexOf("python -m tools.check_diffusion_ready", healthy);
    const rfq = deployWorkflow.indexOf("Confirming the authenticated private maker channel state", diffusion);
    assert.ok(
      healthy > 0 && diffusion > healthy && rfq > diffusion,
      "the populated-history canary must run after health and before the remaining promotion canaries",
    );

    const block = deployWorkflow.slice(
      deployWorkflow.lastIndexOf('echo "==> Confirming the restored Diffusion history', diffusion),
      rfq,
    );
    assert.match(block, /docker exec "\$CONTAINER" python -m tools\.check_diffusion_ready/);
    assert.match(
      block,
      /rollback_gateway/,
      "an empty but healthy replacement must roll back instead of promoting blank diagrams",
    );
  });

  it("mirrors the verified Diffusion study ledger to Supabase before cutover", () => {
    const restore = deployWorkflow.indexOf("python -m tools.restore_diffusion_supabase_once");
    const cutover = deployWorkflow.indexOf('echo "==> Stopping the current container"', restore);
    assert.ok(restore > 0 && cutover > restore,
      "the Supabase Diffusion restore must finish while the prior gateway is still serving");
    const block = deployWorkflow.slice(
      deployWorkflow.lastIndexOf("DIFFUSION_SUPABASE_CONTAINER=", restore),
      cutover,
    );
    assert.match(block, /timeout --signal=TERM --kill-after=10s 120s/);
    assert.match(block, /--env-file "\$ENV_FILE"/);
    assert.match(block, /tenant-scoped Supabase Diffusion restore[\s\S]*unwind_unstarted_replacement/,
      "an incomplete Supabase copy must fail before replacement cutover");
  });
});
