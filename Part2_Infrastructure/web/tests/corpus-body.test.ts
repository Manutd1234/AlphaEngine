/**
 * The corpus result body, read back as rows.
 *
 * A search result used to print its embedded text as one pre-wrap paragraph.
 * It is a table now, and the table is only honest if it carries every line
 * the vector saw, in order, with nothing reworded — so the parser is pinned
 * on fidelity first and on the one omission it is allowed.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseCorpusBody } from "@/lib/corpus-body";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const SUMMARY = [
  "Execution summary 2026-08-22",
  "Session closed at: 2026-08-23T00:00:00.497104+00:00",
  "Decisions: 16 (13 accepted, 3 rejected)",
  "Decision latency ms: mean 0.139, max 0.245",
  "Fills: 13",
  "Venue mix: BINANCE 12 fills, 36,000.00 USD, -0.03 bps average slippage; PAPER_EQUITY/Tiingo 1 fills",
].join("\n");

describe("parseCorpusBody keeps what was embedded", () => {
  it("splits each line on its FIRST colon only", () => {
    const rows = parseCorpusBody(SUMMARY, "Execution summary 2026-08-22");
    const closed = rows.find((r) => r.label === "Session closed at");
    assert.ok(closed, "a timestamp line lost its label");
    // Two more colons live inside the value; none of them is a split point.
    assert.equal(closed.value, "2026-08-23T00:00:00.497104+00:00");
  });

  it("keeps every line, in order, with the title as the one omission", () => {
    const rows = parseCorpusBody(SUMMARY, "Execution summary 2026-08-22");
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Session closed at", "Decisions", "Decision latency ms", "Fills", "Venue mix"],
    );
    // The title is the row's heading already; it is not repeated as a row.
    assert.ok(!rows.some((r) => r.value === "Execution summary 2026-08-22"));
    // Without a title to match, the first line is kept as prose — nothing is
    // dropped on a guess.
    const untitled = parseCorpusBody(SUMMARY);
    assert.equal(untitled[0].label, null);
    assert.equal(untitled[0].value, "Execution summary 2026-08-22");
  });

  it("keeps a line with no label as prose rather than dropping it", () => {
    const rows = parseCorpusBody("Drawdown breach on BTCUSDT.\nSeverity: high\nTriggered by the 4h close.");
    assert.deepEqual(rows, [
      { label: null, value: "Drawdown breach on BTCUSDT." },
      { label: "Severity", value: "high" },
      { label: null, value: "Triggered by the 4h close." },
    ]);
  });

  it("does not mistake a URL or a clock time for a label", () => {
    // A label starts with a letter and is short; "http" followed by "//…"
    // would pass the first test, so the value must be non-empty after the
    // colon and the label must stay under the length cap.
    const rows = parseCorpusBody("See: http://example.test/run/1\n12:30 the book was flat");
    assert.deepEqual(rows, [
      { label: "See", value: "http://example.test/run/1" },
      { label: null, value: "12:30 the book was flat" },
    ]);
    const long = `${"a".repeat(60)}: value`;
    assert.deepEqual(parseCorpusBody(`Fills: 1\n${long}`)[1], { label: null, value: long });
  });

  it("returns nothing for a body with no facts, so the paragraph is used", () => {
    assert.deepEqual(parseCorpusBody("A free-text incident note with no fields."), []);
    assert.deepEqual(parseCorpusBody(""), []);
  });
});

describe("the corpus panel renders the rows and keeps the paragraph fallback", () => {
  const panel = read("../components/research/ResearchCorpus.tsx");
  const connected = read("../components/research/ConnectedDocuments.tsx");

  it("tables the body through the parser", () => {
    assert.match(panel, /import \{ parseCorpusBody \} from "@\/lib\/corpus-body"/);
    assert.match(panel, /<table className="corpus-result__table">/);
    // A prose line spans both columns rather than being squeezed into one.
    assert.match(panel, /<td colSpan=\{2\} className="corpus-result__prose">/);
  });

  it("keeps the paragraph for a body with no rows, as the embedded text", () => {
    assert.match(panel, /rows\.length === 0 && \(/);
    assert.match(panel, /<p className="corpus-result__body">\{match\.body\}<\/p>/);
  });

  it("the graph fold is a table with the relation and its evidence in their own columns", () => {
    assert.match(connected, /<table className="corpus-connected__table">/);
    for (const head of ["Document", "Kind", "Relation", "Evidence", "Hops"]) {
      assert.match(connected, new RegExp(`<th scope="col">${head}</th>`), `no ${head} column`);
    }
    assert.doesNotMatch(connected, /corpus-connected__list/, "the old list is still rendered");
  });
});
