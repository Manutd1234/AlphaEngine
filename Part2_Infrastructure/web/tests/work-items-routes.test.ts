/**
 * The work-queue proxies and the hook that owns persistence.
 *
 * Source-level pins, in the house style: the write routes are operator-gated
 * like every other write; the PATCH route passes the gateway's 409 through
 * with the current row rather than folding it into a generic failure; and the
 * hook treats conflict, unreachable and unauthorised as three different
 * outcomes, none of them silent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const list = read("app/api/gateway/data/work-items/route.ts");
const patch = read("app/api/gateway/data/work-items/[id]/route.ts");
const hook = read("lib/use-data-work-queue.ts");
const lib = read("lib/data-work-queue.ts");
const board = read("components/data/DataWorkBoard.tsx");
const page = read("app/dashboard/page.tsx");

describe("the work-queue proxies", () => {
  it("reads are open, writes are operator-gated", () => {
    assert.match(list, /export async function GET\(\)/);
    assert.match(list, /export async function POST\(request: NextRequest\)/);
    assert.match(list, /const rejection = authorise\(request\.headers\.get\("authorization"\)\);/);
    assert.match(patch, /const rejection = authorise\(request\.headers\.get\("authorization"\)\);/);
    assert.doesNotMatch(list, /authorise\(\)[\s\S]*export async function GET/, "GET must not be gated");
  });

  it("the PATCH route passes a 409 through with the current row", () => {
    assert.match(patch, /response\.status === 409/);
    assert.match(patch, /code: "version_conflict"/);
    assert.match(patch, /current: \(body as \{ current\?: unknown \}\)\?\.current \?\? null/);
    assert.match(patch, /status: 409/);
  });

  it("every gateway hop carries a deadline", () => {
    assert.match(patch, /setTimeout\(\(\) => controller\.abort\(\), TIMEOUT_MS\)/);
    assert.match(lib, /const DATA_WORK_TIMEOUT_MS = 6_000;/);
    assert.match(lib, /signal: controller\.signal/);
  });

  it("validates the create body before it reaches the gateway", () => {
    assert.match(list, /const KINDS = new Set\(\["request", "ticket", "bug"\]\);/);
    assert.match(list, /const PRIORITIES = new Set\(\["P0", "P1", "P2", "P3"\]\);/);
    assert.match(list, /a title of up to 120 characters are required/);
  });
});

describe("the hook owns persistence and names each outcome", () => {
  it("conflict, unreachable and unauthorised are handled apart", () => {
    assert.match(hook, /result\.code === "conflict"/);
    assert.match(hook, /result\.code === "unreachable"/);
    assert.match(hook, /was changed elsewhere; showing the current version/);
    assert.match(hook, /held locally until the gateway answers/);
    assert.match(hook, /was not saved: \$\{result\.error\}/);
  });

  it("held writes are replayed after the next successful load, creates re-posted and moves re-patched against the fresh version", () => {
    assert.match(hook, /const replayHeld = useCallback/);
    assert.match(hook, /const merged = await replayHeld\(result\.items\);/);
    assert.match(hook, /patchDataWorkItem\(m\.item\.id, current\.version, \{ status: m\.status \}, token\)/);
  });

  it("the board is fed by the hook and never fetches itself", () => {
    assert.match(page, /const dataWork = useDataWorkQueue\(\{ token: systems\.token \|\| null, active: view === "data" \}\);/);
    assert.match(page, /onWorkMutation=\{dataWork\.mutate\}/);
    assert.doesNotMatch(board, /fetch\(/, "the board renders and reports; the workspace persists");
  });

  it("the board reports the source and marks the seeded rows", () => {
    assert.match(board, /Persisted on the gateway, \$\{source\.count\}/);
    assert.match(board, /item\.createdBy === "seed" && <small className="muted"> ‹sample›<\/small>/);
    assert.match(board, /disabled=\{readOnly\}/);
  });
});
