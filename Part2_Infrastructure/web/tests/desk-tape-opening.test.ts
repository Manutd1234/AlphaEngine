/**
 * The decision tape opens with a starting state, and that state never passes
 * for the stream.
 *
 * THE DEFECT THIS PINS. Nothing was broken. The gateway was writing, the anon
 * RLS policy admitted the rows, realtime delivery was measured at under a
 * second, and the client reported "live" only after SUBSCRIBED. And a desk that
 * had placed two BTCUSDT orders a minute earlier opened this pane and read
 * "● LIVE" over "No decisions have been recorded since this page opened",
 * because a subscription only ever delivers what commits after it is
 * established. Every component behaved correctly and the surface said the desk
 * was quiet, which is precisely what `DeskTape`'s own docstring says must never
 * happen.
 *
 * So the tape now reads a bounded page of the mirror on mount. That fix has one
 * hard requirement, and it is why this suite exists rather than a two-line
 * change: A BACKFILLED ROW AND A STREAMED ROW MUST NEVER BE INDISTINGUISHABLE.
 * The card's whole argument — read its docstring and `tape-view.ts` — is that
 * the blotter is the RECORD and the tape is the STREAM. If a page of the record
 * silently joins the stream, the tape starts impersonating the pane next door,
 * which is the thing the pane split exists to prevent.
 *
 * Three properties, each asserted rather than argued:
 *
 *  1. the origin travels with the row and reaches the reader as words;
 *  2. the read and the channel are two absences with two names, and no pair of
 *     their states leaves the card silent or lets one read as the other;
 *  3. the read is bounded and reports its own failure, because an unbounded one
 *     would replace "empty under a green badge" with "reading, for ever".
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { describeOpening, openingSurface, tapeSurface } from "../components/execution/tape-view";
import {
  describeTape,
  mergeTape,
  type OpeningState,
  type TapeOpening,
  type TapeRow,
  type TapeState,
} from "../lib/use-desk-tape";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Comment bodies removed before any keyword scan. Both files argue in prose
 * about what they deliberately do NOT do — the gateway route they refuse to
 * read, the `?? 0` they refuse to write — so scanning the raw text finds the
 * explanation and reports the safeguard as the violation. `desk-tape.test.ts`
 * carries the same stripper for the same reason.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const hook = read("../lib/use-desk-tape.ts");
const view = read("../components/execution/tape-view.ts");
const panel = read("../components/execution/DeskTape.tsx");

const STATES: TapeState[] = ["unconfigured", "connecting", "live", "unavailable"];
const OPENINGS: OpeningState[] = ["unconfigured", "reading", "read", "unavailable"];

const openingOf = (state: OpeningState, count = 0, reason: string | null = null): TapeOpening =>
  ({ state, count, reason });

const row = (id: string, origin: TapeRow["origin"]): TapeRow => ({
  id,
  symbol: "BTCUSDT",
  side: "BUY",
  notional: 1_000,
  verdict: "ACCEPTED",
  status: "filled",
  latencyMs: 0.21,
  occurredAt: "2026-08-22T06:35:07Z",
  origin,
  fresh: origin === "stream",
});

// --------------------------------------------------------------------------
// 1. The origin travels with the row
// --------------------------------------------------------------------------

describe("a backfilled row and a streamed row are never the same row", () => {
  it("the merged tape keeps every origin it was given", () => {
    const merged = mergeTape([row("s1", "stream")], [row("o1", "opening"), row("o2", "opening")]);
    assert.deepEqual(merged.map((r) => r.origin), ["stream", "opening", "opening"]);
  });

  it("the stream sits above the opening page, with no clock arithmetic", () => {
    // Deliberately not a sort: Realtime forwards Postgres' own timestamptz text
    // and PostgREST returns ISO-8601, two renderings of one instant that neither
    // a lexicographic nor a `Date.parse` compare orders correctly across the
    // seam. The page was read at mount, so order is structural.
    const merged = mergeTape([row("s1", "stream")], [row("o1", "opening")]);
    assert.deepEqual(merged.map((r) => r.id), ["s1", "o1"]);
    assert.doesNotMatch(code(hook), /\.sort\(/, "the merge started parsing timestamps again");
  });

  it("a row in both halves counts as streamed, because the reader watched it land", () => {
    // A decision committing after the socket subscribes but before the read's
    // snapshot is genuinely in both. Preferring the opening copy would
    // under-report the stream and mark a watched arrival as history.
    const merged = mergeTape([row("both", "stream")], [row("both", "opening")]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].origin, "stream");
  });

  it("the merged tape stays bounded, and the opening page is what gets evicted", () => {
    const streamed = Array.from({ length: 24 }, (_, i) => row(`s${i}`, "stream"));
    const merged = mergeTape(streamed, [row("o1", "opening"), row("o2", "opening")]);
    assert.equal(merged.length, 25, "the tape grew past its window");
    assert.equal(merged.filter((r) => r.origin === "opening").length, 1);
  });

  it("the opening page asks for fewer rows than the tape holds", () => {
    // Otherwise the starting state fills the window and the stream is starved
    // of slots on the surface that exists to show it.
    const max = Number(/MAX_ROWS\s*=\s*(\d+)/.exec(hook)?.[1]);
    const openingRows = Number(/OPENING_ROWS\s*=\s*(\d+)/.exec(hook)?.[1]);
    assert.ok(Number.isFinite(max) && Number.isFinite(openingRows));
    assert.ok(openingRows < max, `an opening page of ${openingRows} fills a tape of ${max}`);
  });

  it("an opening row never flashes as though it had just landed", () => {
    // `.is-fresh` means "this arrived while you were watching". A row read out
    // of the past did not, and a flash on one is a lie about when it happened.
    assert.equal(row("o1", "opening").fresh, false);
    assert.match(code(hook), /fresh: origin === "stream"/);
  });

  it("the reader is told in words, in every row, not by a tint", () => {
    // A colour cannot carry this: forced colours strip it, the fresh-row tint
    // already means something else, and the flash is a one-off. So the origin
    // is a column of text read out with every row.
    assert.match(panel, /<th scope="col">Origin<\/th>/);
    assert.match(panel, /row\.origin === "stream" \? "streamed" : "opening read"/);
    assert.match(panel, /origin column/, "the caption does not tell a screen reader what it is for");
  });
});

// --------------------------------------------------------------------------
// 2. Two absences, two names
// --------------------------------------------------------------------------

describe("the read and the channel fail independently, and say so separately", () => {
  it("produces four distinct sentences for the four read states", () => {
    const sentences = OPENINGS.map((state) => describeOpening(openingOf(state)));
    assert.equal(new Set(sentences).size, OPENINGS.length, `collapsed: ${sentences.join(" / ")}`);
  });

  it("a failed read never reads as an empty corpus", () => {
    const failed = describeOpening(openingOf("unavailable", 0, "AbortError: signal timed out"));
    const empty = describeOpening(openingOf("read", 0));
    assert.notEqual(failed, empty);
    assert.match(failed, /failed/i);
    assert.match(failed, /missing/i);
    // An abort abandoned a request that may well have been working. It cannot
    // claim there was nothing to find.
    assert.doesNotMatch(failed, /no earlier decisions|nothing|empty/i);
    // And it says where the rows it could not fetch still are.
    assert.match(failed, /Blotter/);
    // Postgres' own words, appended rather than paraphrased.
    assert.match(failed, /AbortError: signal timed out/);
  });

  it("a genuinely empty corpus says it is empty rather than behind", () => {
    const empty = describeOpening(openingOf("read", 0));
    assert.match(empty, /no earlier decisions/i);
    assert.doesNotMatch(empty, /failed|dropped|error/i);
  });

  it("a read that returned rows says how many, and that they did not stream", () => {
    assert.match(describeOpening(openingOf("read", 1)), /1 earlier decision\b/);
    assert.match(describeOpening(openingOf("read", 6)), /6 earlier decisions\b/);
    assert.match(describeOpening(openingOf("read", 6)), /rather than from the stream/);
  });

  it("no sentence about the read is ever a sentence about the channel", () => {
    for (const state of STATES) {
      for (const opening of OPENINGS) {
        assert.notEqual(
          describeTape(state, 0),
          describeOpening(openingOf(opening)),
          `${state} and ${opening} say the same thing`,
        );
      }
    }
  });

  it("a failed read speaks even when the channel is live and the table is full", () => {
    // The case the second surface exists for: `tapeSurface` is silent here,
    // because the stream is fine. The tape is still missing every decision from
    // before the pane opened, and the reader has to be told.
    const stream = tapeSurface("live", 8);
    assert.equal(stream.notice, false);
    const opening = openingSurface(openingOf("unavailable", 0, "timeout"), "live");
    assert.equal(opening.notice, true, "a failed opening read went unreported");
    assert.equal(opening.warn, true, "a tape missing its history reported it as a note");
  });

  it("no pair of states leaves the card silent", () => {
    for (const state of STATES) {
      for (const opening of OPENINGS) {
        for (const rowCount of [0, 8]) {
          const said = tapeSurface(state, rowCount).notice
            || openingSurface(openingOf(opening), state).notice;
          assert.ok(said, `${state} + ${opening} with ${rowCount} rows says nothing`);
        }
      }
    }
  });

  it("one missing configuration is reported once, not as two faults", () => {
    // No public Supabase config means no channel AND no mirror to read. Two
    // states, one cause: `describeTape` has already said it.
    const both = openingSurface(openingOf("unconfigured"), "unconfigured");
    assert.equal(both.notice, false);
    assert.equal(tapeSurface("unconfigured", 0).notice, true);
    // Any other pairing still speaks — the suppression is the shared cause, not
    // the read's state alone.
    assert.equal(openingSurface(openingOf("unconfigured"), "live").notice, true);
  });

  it("the panel renders the two notices through the two decisions", () => {
    assert.match(panel, /openingSurface\(opening, state\)/);
    assert.match(panel, /readNotice\.notice &&/);
    assert.match(panel, /\{describeOpening\(opening\)\}/);
    // Siblings, not nested: a read notice inside the channel's branch would
    // make one absence conditional on the other, which is the blur this whole
    // pair of states exists to prevent. The channel's block must be closed
    // before the read's begins.
    const between = panel.slice(
      panel.indexOf("{surface.notice && ("),
      panel.indexOf("{readNotice.notice &&"),
    );
    assert.ok(between.length > 0, "the panel no longer renders both notices");
    assert.ok(
      between.trimEnd().endsWith(")}"),
      "the opening read's notice is nested inside the channel's",
    );
  });
});

// --------------------------------------------------------------------------
// 3. Where the page comes from, and what happens when it does not arrive
// --------------------------------------------------------------------------

describe("the opening page comes from the mirror the stream reads", () => {
  it("reads the same table through the same anon client", () => {
    // Same relation, same RLS policy, same columns: the page is exactly the
    // messages this client would have received had it subscribed a minute
    // earlier. See the argument in the hook's header.
    assert.match(code(hook), /supabase\.from\("order_blotter"\)/);
    assert.match(code(hook), /supabaseBrowser\(\)/);
  });

  it("does not reach for the gateway's blotter route", () => {
    // The authoritative record is DuckDB, which the mirror lags, and it is the
    // Blotter pane's own poll one card away. A page of it inside the tape would
    // be a seam neither side can see and a second moment of one fact.
    assert.doesNotMatch(code(hook), /\/api\/gateway/);
    assert.doesNotMatch(code(hook), /probeGateway/);
  });

  it("names its columns rather than taking whatever the table has", () => {
    assert.match(hook, /OPENING_COLUMNS = "id,symbol,side,notional,verdict,status,latency_ms,occurred_at"/);
    assert.doesNotMatch(code(hook), /select\("\*"\)/);
  });

  it("is bounded, on a named constant, and the deadline is argued", () => {
    // An unbounded read against a server that accepts and never answers leaves
    // the card reading for the life of the tab — the same silent nothing in a
    // different costume.
    assert.match(code(hook), /\.limit\(OPENING_ROWS\)/);
    assert.match(code(hook), /\.abortSignal\(AbortSignal\.timeout\(OPENING_DEADLINE_MS\)\)/);
    assert.match(hook, /OPENING_DEADLINE_MS = [\d_]+/);
    assert.match(hook, /why this number/i, "the deadline is a number with no author");
  });

  it("a failure becomes a named state carrying Postgres' reason, never an empty list", () => {
    assert.match(code(hook), /state: "unavailable", count: 0, reason: error\.message \|\| null/);
    // And a throw that escaped the builder cannot leave the card reading.
    assert.match(code(hook), /catch \(cause\)/);
  });

  it("re-reads when the instrument changes, without resubscribing the socket", () => {
    // The card says "Filtered to {symbol}", so a page for the previous
    // instrument would falsify the sentence above the table. A resubscribe
    // costs a round trip and loses commits; this read costs one indexed scan.
    assert.match(code(hook), /\}, \[symbol\]\);/);
    assert.match(code(hook), /\.eq\("symbol", symbol\)/);
  });

  it("a null notional is dashed, never zeroed", () => {
    // `notional` is nullable in the mirror and a refused order can carry none.
    // A zero there is a claim that the desk decided on nothing.
    assert.match(code(hook), /notional: row\.notional == null \? null : Number\(row\.notional\)/);
    assert.doesNotMatch(code(hook), /notional \?\? 0/);
    assert.match(panel, /A dash means the mirror recorded no value in that column\./);
  });
});

describe("the view module keeps the two decisions apart", () => {
  it("exports both surfaces, pure, so they can be replayed with no DOM", () => {
    assert.match(view, /export function tapeSurface/);
    assert.match(view, /export function openingSurface/);
    assert.match(view, /export function describeOpening/);
    assert.doesNotMatch(code(view), /useState|useEffect|<[A-Za-z]/);
  });
});
