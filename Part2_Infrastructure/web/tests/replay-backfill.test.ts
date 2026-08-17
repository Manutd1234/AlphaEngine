/**
 * Replay and backfill: the proxies validate and forward, the panel says what
 * it spends and what its empty states do not prove.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const jobs = read("app/api/gateway/data/jobs/route.ts");
const schedules = read("app/api/gateway/data/schedules/route.ts");
const panel = read("components/data/ReplayBackfillPanel.tsx");
const console_ = read("components/DataConsole.tsx");

describe("the job proxies", () => {
  it("reads are open, the submit is operator-gated and validated", () => {
    assert.match(jobs, /export async function GET\(request: NextRequest\)/);
    assert.match(jobs, /const rejection = authorise\(request\.headers\.get\("authorization"\)\);/);
    assert.match(jobs, /const CAPABILITIES = new Set\(\["quote", "bars", "news", "fundamentals"\]\);/);
    assert.match(jobs, /A symbol such as BTCUSDT or AAPL is required/);
    assert.match(jobs, /A backfill needs an interval and a from_at before to_at/);
    assert.match(jobs, /kind must be "replay" or "backfill"/);
    assert.match(schedules, /export async function GET\(\)/);
    assert.doesNotMatch(schedules, /authorise/, "the schedule is a read");
  });

  it("forwards to the gateway's typed routes and answers 202 for an accepted job", () => {
    assert.match(jobs, /callGateway<Record<string, unknown>>\("\/api\/data\/replay"/);
    assert.match(jobs, /callGateway<Record<string, unknown>>\("\/api\/data\/backfill"/);
    assert.match(jobs, /status: 202/);
  });
});

describe("the panel", () => {
  it("is mounted under the pipeline inspector on Lineage & Payloads and gated on the operator", () => {
    assert.match(console_, /<ReplayBackfillPanel\s+symbol=\{workspaceSymbol\}/);
    assert.match(console_, /operatorReady=\{operatorReady\}/);
    assert.match(panel, /const canSubmit = !locked && operatorReady && busy === null;/);
  });

  it("states what each submit spends and where the result goes", () => {
    assert.match(panel, /Spends one interactive provider call through this workspace; the gateway records the contract result\./);
    assert.match(panel, /Binance for a crypto pair, this workspace(&apos;|')s registry for an equity/);
  });

  it("every empty state says what it does not prove, and nothing returns null", () => {
    assert.match(panel, /No replay or backfill job has been submitted since the gateway started\./);
    assert.match(panel, /Nothing here says the queue is empty\./);
    assert.match(panel, /No schedule is configured — set <code>DATA_SCHEDULES<\/code>/);
    assert.match(panel, /Executor not configured\./);
    assert.doesNotMatch(panel, /return null;/);
  });

  it("reads through the gateway deadline and gives the write its own", () => {
    assert.match(panel, /probeGateway<JobsPayload>\("\/api\/gateway\/data\/jobs\?limit=25"\)/);
    assert.match(panel, /probeGateway<SchedulesPayload>\("\/api\/gateway\/data\/schedules"\)/);
    assert.match(panel, /const SUBMIT_DEADLINE_MS = 9_000;/);
    assert.match(panel, /setTimeout\(\(\) => controller\.abort\(\), SUBMIT_DEADLINE_MS\)/);
  });

  it("a succeeded job says 'persisting…' until the completion hook has written", () => {
    assert.match(panel, /const persisted = typeof s\.persisted_at === "string";/);
    assert.match(panel, /persisting…/);
  });
});
