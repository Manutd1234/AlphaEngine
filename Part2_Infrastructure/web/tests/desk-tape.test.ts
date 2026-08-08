/**
 * The decision tape says which of four things is true.
 *
 * A realtime channel has a failure mode a poll does not: it drops silently and
 * keeps looking connected. On a trading surface, a tape showing nothing because
 * its channel died is indistinguishable from a quiet desk — and those must
 * never be confusable, which is the same rule `describeSearchOutcome` states
 * for the research index.
 *
 * So the states are asserted as distinct sentences rather than trusted to a
 * component reading a boolean.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeTape, type TapeState } from "../lib/use-desk-tape";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Comment bodies removed before any keyword scan. Every one of these files
 * explains in prose what it deliberately does NOT do — `process.env[name]`,
 * UPDATE/DELETE events, the service-role key — so scanning the raw text finds
 * the explanation and reports the safeguard as the violation. This is the
 * fourth test in this suite to need it; it is a property of writing code that
 * documents its own hazards.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const hook = read("../lib/use-desk-tape.ts");
const client = read("../lib/supabaseClient.ts");
const panel = read("../components/execution/DeskTape.tsx");

const STATES: TapeState[] = ["unconfigured", "connecting", "live", "unavailable"];

describe("every tape state reads as a different fact", () => {
  it("produces four distinct sentences when empty", () => {
    const sentences = STATES.map((state) => describeTape(state, 0));
    assert.equal(new Set(sentences).size, STATES.length, `collapsed: ${sentences.join(" / ")}`);
  });

  it("a dropped channel never reads as an idle desk", () => {
    const dropped = describeTape("unavailable", 0);
    const quiet = describeTape("live", 0);
    assert.notEqual(dropped, quiet);
    // The words that carry the difference. A reader skimming has to see that
    // rows are being MISSED, not merely absent.
    assert.match(dropped, /missed|dropped/i);
    assert.match(quiet, /no decisions have been recorded/i);
  });

  it("unconfigured is not a fault", () => {
    const off = describeTape("unconfigured", 0);
    assert.match(off, /not configured/i);
    assert.doesNotMatch(off, /error|fail|down/i);
  });

  it("live with rows reports the count and agrees on plurality", () => {
    assert.match(describeTape("live", 1), /1 decision\b/);
    assert.match(describeTape("live", 4), /4 decisions\b/);
  });
});

describe("the tape is a stream, not a source of record", () => {
  it("the panel says so where a reader will see it", () => {
    // The blueprint's hook returns the blotter, implying the subscription is
    // the record. A channel that drops silently cannot be one.
    assert.match(panel, /complete record/i);
    assert.match(panel, /authoritative/i);
  });

  it("subscribes to INSERT only", () => {
    // order_blotter is append-only by trigger, so UPDATE and DELETE are not
    // merely unused — they cannot occur.
    assert.match(hook, /event:\s*"INSERT"/);
    assert.doesNotMatch(code(hook), /"UPDATE"|"DELETE"|"\*"/);
  });

  it("bounds what it retains", () => {
    // A tape is a window on the recent past. Unbounded growth in a long-lived
    // tab is a leak that only shows up after hours.
    assert.match(hook, /MAX_ROWS\s*=\s*\d+/);
    assert.match(hook, /slice\(0, MAX_ROWS - 1\)/);
  });
});

describe("the browser client cannot hold more than it needs", () => {
  it("keeps no session for an identity that never exists", () => {
    assert.match(client, /persistSession:\s*false/);
    assert.match(client, /autoRefreshToken:\s*false/);
  });

  it("returns null rather than throwing when unconfigured", () => {
    assert.match(client, /if \(!url \|\| !anonKey\) return null;/);
  });

  it("reads the public variables statically", () => {
    // Next substitutes `process.env.NEXT_PUBLIC_*` textually at build time, so a
    // dynamic lookup resolves to undefined in the browser bundle — a mistake
    // that reads fine and fails only in production.
    assert.match(code(client), /process\.env\.NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(code(client), /process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    assert.doesNotMatch(code(client), /process\.env\[/);
  });

  it("never names the service-role key", () => {
    assert.doesNotMatch(code(client + hook + panel), /SERVICE_ROLE/);
  });
});
