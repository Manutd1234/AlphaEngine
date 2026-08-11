/**
 * The typed gateway client, pinned to the committed contract.
 *
 * Three gates. (1) The generated bindings must be exactly what the committed
 * OpenAPI snapshot renders — regeneration is a deliberate, reviewed act, like
 * `tools/export_openapi.py --check` on the Python side. (2) Every literal
 * gateway path in first-party source must exist in the contract, so a typo'd
 * or removed route fails here instead of 404ing in production. (3) The
 * hand-written wire shapes the runtime validates against must remain
 * *narrowings* of the generated contract types — enforced at compile time in
 * this file, which is why it contains type-level assertions with no runtime
 * body.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  GATEWAY_CONTRACT_PATHS,
  type GatewayOperations,
  type WebStateSyncRequest,
  type WebStateView,
} from "../lib/gateway-contract.generated";
import type { SharedOpsSyncBody, SharedOpsViewWire } from "../lib/observability";
import {
  loadCommittedContract,
  renderGatewayContract,
} from "../scripts/generate-gateway-client";

// ---------------------------------------------------------------------------
// Compile-time leg: the runtime's wire shapes narrow the contract, never fork
// ---------------------------------------------------------------------------

type AssertExtends<Base, Narrow extends Base> = Narrow;

// What the sync pushes must be a valid contract request…
type _RequestSatisfiesContract = AssertExtends<WebStateSyncRequest, SharedOpsSyncBody>;
// …and what the validator accepts must be a valid contract response.
type _ValidatedViewSatisfiesContract = AssertExtends<WebStateView, SharedOpsViewWire>;
// The operations map is the source of both.
type _SyncBinding = AssertExtends<
  { request: WebStateSyncRequest; response: WebStateView },
  GatewayOperations["POST /api/ops/web-state/sync"]
>;

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  return readdirSync(join(WEB_ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path);
    return /\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("the generated client matches the committed contract", () => {
  it("regenerates to exactly the committed bytes", () => {
    const committed = readFileSync(join(WEB_ROOT, "lib/gateway-contract.generated.ts"), "utf8");
    assert.equal(
      renderGatewayContract(loadCommittedContract()),
      committed,
      "tools/openapi.json changed but the typed client was not regenerated — "
        + "run `node --import tsx scripts/generate-gateway-client.ts` and review the diff",
    );
  });

  it("publishes every route the web depends on", () => {
    const paths = new Set<string>(GATEWAY_CONTRACT_PATHS);
    for (const path of [
      "/api/ops/snapshot",
      "/api/ops/web-state/sync",
      "/api/portfolio",
      "/api/orders",
      "/api/audit/orders",
    ]) {
      assert.ok(paths.has(path), `${path} disappeared from the committed contract`);
    }
  });
});

describe("every literal gateway path in source exists in the contract", () => {
  // The OpenAPI document itself is served outside its own path table.
  const OFF_CONTRACT = new Set(["/openapi.json"]);

  it("finds no calls to routes the contract does not publish", () => {
    const known = new Set<string>([...GATEWAY_CONTRACT_PATHS, ...OFF_CONTRACT]);
    const offenders: string[] = [];
    let literalCalls = 0;
    for (const file of [...walk("lib"), ...walk("app"), ...walk("components")]) {
      const source = readFileSync(join(WEB_ROOT, file), "utf8");
      for (const match of source.matchAll(/callGateway(?:<[^>]*>)?\(\s*"([^"]+)"/g)) {
        literalCalls += 1;
        if (!known.has(match[1])) offenders.push(`${file}: ${match[1]}`);
      }
    }
    assert.ok(literalCalls >= 4, `expected to find literal gateway calls, found ${literalCalls}`);
    assert.deepEqual(offenders, [], "gateway calls to routes missing from the committed contract");
  });
});
