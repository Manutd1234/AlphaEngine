/**
 * The lineage output is a table, and it still says everything it used to.
 *
 * WHICH SURFACE THIS IS
 * ---------------------------------------------------------------------------
 * "Lineage" is the Data console's `lineage` section (`lib/sections.ts` labels it
 * "Lineage & Payloads"). `DataConsole` mounts `PipelineInspector` there, the
 * inspector requests `GET /api/system/inspect`, and `PipelineRestTrace` draws
 * the answer: cache key, TTL, provenance, every skipped provider, upstream
 * calls, raw vendor JSON and normalised output. So the lineage output IS
 * `PipelineRestTrace`, and that is the file these assertions read. The first
 * test pins the routing itself, because an assertion that reads the renderer
 * is only meaningful while that renderer is what the tab mounts.
 *
 * WHAT IS BEING PINNED, AND WHY IN THIS SHAPE
 * ---------------------------------------------------------------------------
 * The three RECORD zones — provenance, skipped providers, upstream calls — were
 * three bespoke layouts (a definition grid, left-accented cards, bordered cards
 * with a flex badge row). They are now the house table idiom: `.table-wrap`
 * plus a plain `<table>`, the same one roughly thirty other panels use, so the
 * border, the header band and the tabular-mono figures all come from
 * `00-tokens-and-base.css` and no second table style was invented.
 *
 * The failure mode a table invites is the one this file exists to stop: a
 * column is dropped because it did not fit. A lineage view exists to be
 * complete, so the field roll-call below is deliberately mechanical — every
 * value the payload carries is named, and losing one fails here rather than
 * being noticed months later by someone who needed it during an incident.
 *
 * There is no DOM harness in this suite, so these are source-text assertions,
 * exactly like `data-diagnostics-ui.test.ts` next door.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss } from "./globals-css";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

const restTrace = read("../components/systems/PipelineRestTrace.tsx");
const inspector = read("../components/systems/PipelineInspector.tsx");
const dataConsole = read("../components/DataConsole.tsx");
const sections = read("../lib/sections.ts");

/** Comment bodies blanked, newlines kept, so prose is never read as markup. */
const markup = restTrace.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, (block) => block.replace(/[^\n]/g, " "));

describe("the lineage tab still renders through the inspector", () => {
  it("the Data console mounts the pipeline inspector in the lineage section", () => {
    assert.match(sections, /id: "lineage", label: "Lineage & Payloads"/);
    assert.match(dataConsole, /tabId="lineage"[\s\S]{0,400}<PipelineInspector/);
  });

  it("the inspector delegates the REST answer to the renderer under test", () => {
    assert.match(inspector, /import RestTrace from "@\/components\/systems\/PipelineRestTrace"/);
    assert.match(inspector, /<RestTrace result=\{result\}/);
  });
});

describe("the record zones are real tables, drawn by the house idiom", () => {
  const tables = [...markup.matchAll(/<table>/g)];

  it("renders one table per record zone", () => {
    // Provenance, skipped providers, upstream calls. Not a maximum — a fourth
    // record zone is welcome — but fewer than three means a zone regressed to
    // a bespoke list.
    assert.ok(tables.length >= 3, `only ${tables.length} tables in the lineage renderer`);
  });

  it("every table sits inside a focusable .table-wrap", () => {
    // A wide table scrolls INSIDE its wrap, never the page. A scroll container
    // nobody can focus is unreachable by keyboard and by every switch device,
    // which is why the repo's precedent is `tabIndex={0}` on the wrap and why
    // it is asserted rather than left to habit.
    for (const table of tables) {
      const before = markup.slice(0, table.index);
      const wrap = before.lastIndexOf("<div className=\"table-wrap\"");
      assert.ok(wrap >= 0, "a <table> in the lineage renderer has no .table-wrap around it");
      const openTag = before.slice(wrap, before.indexOf(">", wrap) + 1);
      assert.match(openTag, /tabIndex=\{0\}/, `this .table-wrap cannot be focused: ${openTag}`);
    }
    assert.equal((markup.match(/className="table-wrap"/g) ?? []).length, tables.length);
  });

  it("every table has a header row of column headers and a named caption", () => {
    for (const table of tables) {
      const body = markup.slice(table.index, markup.indexOf("</table>", table.index));
      assert.match(body, /<caption className="sr-only">/, "a lineage table has no caption");
      assert.match(body, /<thead>[\s\S]*?<th scope="col"[\s\S]*?<\/thead>/,
        "a lineage table has no header row of scope=col cells");
      assert.match(body, /<tbody>[\s\S]*?<th scope="row"/,
        "a lineage table's rows have no row header, so the identity column is unlabelled");
    }
  });

  it("the header row has exactly one heading per column of the body", () => {
    // The way a table silently loses a field: a column header is deleted and
    // the cells shift left under the wrong headings, or a cell is deleted and
    // the header points at nothing. Counting both ends catches either, and it
    // is the assertion that makes "no field was lost" structural rather than
    // a promise the roll-call below has to keep on its own.
    for (const table of tables) {
      const body = markup.slice(table.index, markup.indexOf("</table>", table.index));
      const head = body.slice(body.indexOf("<thead>"), body.indexOf("</thead>"));
      const firstRow = body.slice(body.indexOf("<tbody>"), body.indexOf("</tr>", body.indexOf("<tbody>")));
      const columns = (head.match(/<th scope="col"/g) ?? []).length;
      const cells = (firstRow.match(/<th scope="row"/g) ?? []).length
        + (firstRow.match(/<td[ >]/g) ?? []).length;
      assert.equal(cells, columns,
        `a lineage table has ${columns} column headers and ${cells} cells in its first row`);
    }
  });

  it("the borders and the tabular figures come from the shared rule, not this card", () => {
    // The point of reusing the idiom: `.table-wrap` and `table` are already
    // styled once, globally. A second table style written for this panel is
    // the regression, so the component must declare no table geometry at all.
    assert.match(globalsCss, /\.table-wrap \{\s*overflow-x: auto;/);
    // And the sideways scroll belongs to the wrap, never to the page. Same
    // page-level guard `developer-diagram-layout.test.ts` pins for its strip:
    // `html { overflow-x: clip }`, clip rather than hidden because hidden
    // would make every ancestor a scroll container and break `position:
    // sticky` inside them.
    assert.match(globalsCss, /overflow-x: clip/,
      "the page-level guard against a sideways scroll is gone, so a wide lineage table "
        + "would drag the whole workspace sideways");
    assert.match(globalsCss, /\ntable \{[^}]*border-collapse: collapse;[^}]*\}/);
    assert.match(globalsCss, /\ntable \{[^}]*font-variant-numeric: tabular-nums;[^}]*\}/);
    assert.match(globalsCss, /\ntable \{[^}]*border: 1px solid var\(--rule\);[^}]*\}/);
    assert.doesNotMatch(markup, /borderCollapse|overflowX|border: "1px/,
      "the lineage renderer is growing a second table style of its own");
    // Type reads the ladder, never a literal — the house rule, checked here
    // because a new table is exactly where a stray `fontSize: 11` appears.
    assert.doesNotMatch(markup, /fontSize|fontFamily/);
  });
});

describe("no field was lost in the move to tables", () => {
  /**
   * The roll call. Left of the arrow is the payload field
   * (`components/systems/inspect-types.ts`), right of it is proof the renderer
   * still reads it. Nothing here is decorative: each one was on screen before
   * the tables and has to be on screen after.
   */
  const fields: Array<[string, RegExp]> = [
    // Cache verdict and timing — the zone that stayed a definition grid.
    ["cache.key", /result\.cache\.key/],
    ["cache.state", /result\.cache\.state/],
    ["cache.configuredTtlMs", /result\.cache\.configuredTtlMs/],
    ["cache.ttlRemainingMs", /result\.cache\.ttlRemainingMs/],
    ["cache.ageMs", /result\.cache\.ageMs/],
    ["totalMs", /result\.totalMs/],
    // The executed path — the zone that stayed an ordered list.
    ["lineage[].stage", /stage\.stage/],
    ["lineage[].detail", /stage\.detail/],
    // Provenance, now one table row.
    ["provenance.label", /result\.provenance\.label/],
    ["provenance.provider", /result\.provenance\.provider/],
    ["provenance.fetchedAt", /result\.provenance\.fetchedAt/],
    ["provenance.latencyMs", /result\.provenance\.latencyMs/],
    ["provenance.cached", /result\.provenance\.cached/],
    ["provenance.delayed", /result\.provenance\.delayed/],
    ["provenance.quotaRemaining", /result\.provenance\.quotaRemaining/],
    ["provenance.quotaLimit", /result\.provenance\.quotaLimit/],
    ["provenance.quotaWindow", /result\.provenance\.quotaWindow/],
    // Skipped providers, now one row each.
    ["attempts[].provider", /attempt\.provider/],
    ["attempts[].reason", /SKIP_LABEL\[attempt\.reason\] \?\? attempt\.reason/],
    ["attempts[].detail", /attempt\.detail/],
    // Upstream calls, now one row each.
    ["upstream.note", /result\.upstream\.note/],
    ["upstream.calls[].provider", /call\.provider/],
    ["upstream.calls[].method", /call\.method/],
    ["upstream.calls[].status", /call\.status/],
    ["upstream.calls[].ms", /call\.ms/],
    ["upstream.calls[].ok", /call\.ok/],
    ["upstream.calls[].error", /call\.error/],
    ["upstream.calls[].url", /call\.url/],
    ["upstream.calls[].body.bytes", /call\.body\.bytes/],
    ["upstream.calls[].body.truncated", /call\.body\.truncated/],
    ["upstream.calls[].body.value", /call\.body\.value/],
    // The normalised payload and the error the pool reported.
    ["data", /JsonTree value=\{result\.data\}/],
    ["error", /\{result\.error\}/],
  ];

  for (const [field, pattern] of fields) {
    it(`still renders ${field}`, () => {
      assert.match(markup, pattern,
        `${field} disappeared from the lineage view. A column may not be dropped to make the `
          + "table fit — a wide table scrolls inside its .table-wrap instead.");
    });
  }

  it("the skip reason is a column of its own, not prose inside another cell", () => {
    // The most valuable column in the whole view: an incident is usually the
    // question "why did the provider I expected not answer", and the answer is
    // this cell. It is a header, so it can be scanned down.
    assert.match(markup, /<th scope="col">Reason<\/th>/);
    assert.match(markup, /<td className="console-skip__reason">\{SKIP_LABEL/);
  });

  it("the provider that answered and the providers that did not are both named", () => {
    assert.match(markup, /<caption className="sr-only">Answer provenance<\/caption>/);
    assert.match(markup, /ranked above the one that answered, and why each was skipped/);
  });
});

describe("an absent value dashes and says why", () => {
  it("names the cause of every missing cell", () => {
    // Null is never coerced to zero and an empty cell is never left blank: a
    // blank reads as a rendering fault, and a bare dash reads as "unknown"
    // when the truth is "no number exists, for this stated reason".
    for (const reason of ["— not metered", "— none recorded", "— not retained", "— no response"]) {
      assert.ok(markup.includes(reason), `the lineage tables no longer say "${reason}"`);
    }
  });

  it("coerces no absent measurement to zero", () => {
    assert.doesNotMatch(markup, /\?\?\s*0\b/, "a null measurement is being rendered as zero");
  });

  it("reports an empty capture instead of rendering nothing", () => {
    assert.match(markup, /result\.upstream\.calls\.length === 0 \?/);
    assert.ok(markup.includes("None — the cache answered."));
  });
});

describe("raw vendor JSON is not forced into cells", () => {
  it("keeps JsonTree for the bodies and lists them beside the table", () => {
    // A vendor payload is a tree, not a row. The tabular facts about a call
    // (provider, method, status, time, bytes, error, URL) moved into the
    // table; the body itself stayed in the tree that can actually show it.
    assert.match(markup, /import JsonTree from "@\/components\/systems\/JsonTree"/);
    assert.match(markup, /<summary>Raw response body<\/summary>\s*<JsonTree value=\{call\.body\.value\}/);
    assert.doesNotMatch(markup, /<td[^>]*>\s*<JsonTree/, "a JSON tree is being crammed into a table cell");
  });
});
