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
const del = read("lib/data-work-delete.ts");
const board = ["components/data/DataWorkBoard.tsx", "components/data/DataWorkCard.tsx", "components/data/WorkComposer.tsx", "components/data/work-board-model.ts"]
  .map((p) => { try { return read(p); } catch { return ""; } }).join("\n");
const page = read("app/dashboard/page.tsx");
const readme = read("README.md");
// The hook is called in the shell; the board that renders its items is mounted
// by `components/workspace/WorkspacePanels.tsx`, so the two halves of the
// wiring are asserted against the two files that hold them.
const panels = read("components/workspace/WorkspacePanels.tsx");

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

  it("the DELETE route is gated like the other writes, unversioned, and passes a 404 through", () => {
    assert.match(patch, /export async function DELETE\(request: NextRequest/);
    const deleteRoute = patch.slice(patch.indexOf("export async function DELETE"));
    assert.match(deleteRoute, /const rejection = authorise\(request\.headers\.get\("authorization"\)\);/);
    assert.match(deleteRoute, /method: "DELETE"/);
    assert.doesNotMatch(deleteRoute, /version/, "a delete quotes no version: there is nothing for it to be stale against");
    assert.match(deleteRoute, /response\.status === 404/);
    assert.match(deleteRoute, /code: "not_found"/);
  });

  it("every gateway hop carries a deadline", () => {
    assert.match(patch, /setTimeout\(\(\) => controller\.abort\(\), TIMEOUT_MS\)/);
    assert.match(del, /withDeadline\(`\/api\/gateway\/data\/work-items\/\$\{encodeURIComponent\(id\)\}`, \{\s*method: "DELETE"/);
    assert.match(lib, /const DATA_WORK_TIMEOUT_MS = 6_000;/);
    assert.match(lib, /signal: controller\.signal/);
  });

  it("uses and documents the Next proxy rather than the backend-only path", () => {
    assert.match(lib, /withDeadline\("\/api\/gateway\/data\/work-items"\)/);
    assert.match(readme, /GET`\/`POST \/api\/gateway\/data\/work-items/);
    assert.match(readme, /gateway itself owns `\/api\/data\/work-items`/);
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

  it("a delete is optimistic on the board, rolled back with its reason, held when unreachable, and settled by a 404", () => {
    assert.match(board, /onItemsChange\(removeDataWorkItem\(items, item\.id\)\);/);
    assert.match(board, /onMutation\?\.\(\{ type: "delete", item \}\);/);
    // Two presses on the card, never one: the first turns the control into the question.
    assert.match(board, /setConfirmingDelete\(true\)/);
    assert.match(board, /onClick=\{\(\) => \{ setConfirmingDelete\(false\); onDelete\(\); \}\}/);
    assert.match(hook, /if \(mutation\.type === "delete"\)/);
    assert.match(hook, /result\.ok \|\| result\.code === "not_found"/, "already gone is the outcome that was asked for");
    assert.match(hook, /delete is held locally until the gateway answers/);
    assert.match(hook, /was not deleted: \$\{result\.error\}/);
    assert.match(hook, /setItems\(\(current\) => upsertDataWorkItem\(current, m\.item\)\);\s*setNotice\(`\$\{m\.item\.id\} was not deleted/, "the row comes back with the reason");
  });

  it("held writes are replayed after the next successful load, creates re-posted and moves re-patched against the fresh version", () => {
    assert.match(hook, /const replayHeld = useCallback/);
    assert.match(hook, /const merged = await replayHeld\(result\.items\);/);
    assert.match(hook, /patchDataWorkItem\(m\.item\.id, current\.version, \{ status: m\.status \}, token\)/);
    // A held delete replays too, and a 404 on replay is success: someone else got there first.
    assert.match(hook, /m\.type === "delete"[\s\S]*?deleteDataWorkItem\(m\.item\.id, token\)[\s\S]*?result\.ok \|\| result\.code === "not_found"/);
  });

  it("the board is fed by the hook and never fetches itself", () => {
    assert.match(page, /const dataWork = useDataWorkQueue\(\{ token: systems\.token \|\| null, active: view === "data" \}\);/);
    assert.match(panels, /onWorkMutation=\{dataWork\.mutate\}/);
    assert.doesNotMatch(board, /fetch\(/, "the board renders and reports; the workspace persists");
  });

  it("the board reports the persisted source without a runtime sample mode", () => {
    assert.match(board, /Persisted on the gateway, \{source\.count\}/);
    assert.doesNotMatch(board, /createdBy === "seed"|seeded sample|Reset sample queue/);
    assert.doesNotMatch(lib, /\bseeded\b|createdBy === "seed"/);
    assert.doesNotMatch(list, /\bseeded\b/);
    assert.match(board, /disabled=\{readOnly\}/);
  });
});
