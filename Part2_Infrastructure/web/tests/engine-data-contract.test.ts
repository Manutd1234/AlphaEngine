/**
 * Every table on the two engine tabs, held to one shape.
 *
 * Twenty-two tables in nineteen files, and until 2026-08-26 they agreed on
 * almost nothing: five different ways to print a null, a numeric column
 * without `.num` beside one with it, a total row spelled two ways, a table with
 * no caption, a muted dash carrying its meaning in colour. None of it was
 * wrong on its own and none of it was the same twice, which is what "uniform
 * layouts, designs and formatting for data" was asked for.
 *
 * The contract is DECLARED in `tests/helpers/engine-tables.ts` — what each
 * column is headed and what kind of cell sits under it — and this file holds
 * the markup to it. A header-text scan cannot tell an identifier from a
 * quantity or a marks column from a cell that happens to hold a glyph;
 * `copy-audit-engines` records four columns a first pass flagged wrongly for
 * exactly that reason. So the kinds are written down, and the rules read them.
 *
 * KNOWN_RED, and why it is asserted rather than skipped. Eight of the tables
 * are the Markets tab's, applied by the session that holds those files against
 * this contract (the plan's slice 19). Their debts are listed here and each
 * entry is asserted to STILL FAIL — an entry that goes green without leaving
 * the list is the stale-allow-list defect `tabular-numerals` describes: a list
 * that stops describing the tree and starts excusing it.
 *
 * Comments are blanked before every read (`table-shape.ts`); the tables' own
 * doc blocks quote the literals below.
 */

import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TABLES, type TableDecl } from "./helpers/engine-tables";
import {
  bodyCells, captions, headerAttributes, headerLabels, tables, totalRow, words, type TableSource,
} from "./helpers/table-shape";
import { read } from "./helpers/workspace-sources";

const MARKS = /[●▲✕○◌✓→]/;

/** `file#nth → rule` debts that are asserted red until the session that holds the file lands them. */
const KNOWN_RED: ReadonlyArray<readonly [key: string, rule: string]> = [
  ["components/coherence/AblationPane.tsx#0", "focusable-wrap"],
  ["components/coherence/BasketSize.tsx#0", "focusable-wrap"],
  ["components/coherence/DispersionTable.tsx#0", "focusable-wrap"],
  ["components/coherence/FeesPane.tsx#0", "focusable-wrap"],
  ["components/coherence/UniversePane.tsx#0", "focusable-wrap"],
  ["components/coherence/surface/StakeView.tsx#0", "focusable-wrap"],
  ["components/coherence/UniversePane.tsx#0", "num-column:Grid"],
  ["components/coherence/FeesPane.tsx#0", "total-row"],
];
const known = new Set(KNOWN_RED.map(([key, rule]) => `${key} ${rule}`));

const keyOf = (decl: TableDecl) => `${decl.file}#${decl.nth ?? 0}`;

/** Assert a rule holds — or, when the table is a known debt for that rule, that it still fails. */
function hold(decl: TableDecl, rule: string, ok: boolean, message: string): void {
  const debt = known.has(`${keyOf(decl)} ${rule}`);
  if (debt) {
    assert.ok(!ok, `${keyOf(decl)} now satisfies "${rule}" — remove it from KNOWN_RED, the debt is repaid`);
    return;
  }
  assert.ok(ok, `${keyOf(decl)}: ${message}`);
}

function engineTsx(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "diffusion") continue;
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path, `${rel}/${entry}`);
      else if (entry.endsWith(".tsx")) out.push(`${rel}/${entry}`);
    }
  };
  walk(join(process.cwd(), "components", "coherence"), "components/coherence");
  return out.sort();
}

const SOURCES = new Map<string, TableSource[]>();
for (const decl of TABLES) {
  if (!SOURCES.has(decl.file)) SOURCES.set(decl.file, tables(read(`../${decl.file}`)));
}
const tableOf = (decl: TableDecl): TableSource => {
  const found = SOURCES.get(decl.file)?.[decl.nth ?? 0];
  assert.ok(found, `${keyOf(decl)}: no such table in the file`);
  return found;
};

describe("every engine table is declared, and every declaration is a table", () => {
  it("the scan and the declaration agree, file by file", () => {
    const declared = new Map<string, number>();
    for (const decl of TABLES) declared.set(decl.file, (declared.get(decl.file) ?? 0) + 1);
    const found = new Map<string, number>();
    for (const file of engineTsx()) {
      const count = tables(read(`../${file}`)).length;
      if (count) found.set(file, count);
    }
    assert.deepEqual(
      Object.fromEntries([...found].sort()),
      Object.fromEntries([...declared].sort()),
      "a <table> exists without a row in engine-tables.ts, or a row names a table that has gone",
    );
    assert.equal(TABLES.length, 22);
  });

  it("KNOWN_RED names only declared tables and rules this file checks", () => {
    const keys = new Set(TABLES.map(keyOf));
    for (const [key] of KNOWN_RED) assert.ok(keys.has(key), `${key} is in KNOWN_RED and not declared`);
  });
});

describe("one shape: coh-table in a table-wrap, captioned, focusable when wide", () => {
  for (const decl of TABLES) {
    it(`${keyOf(decl)} — ${decl.what}`, () => {
      const table = tableOf(decl);
      hold(decl, "class", /className="coh-table"/.test(table.attributes), 'the table is not className="coh-table"');
      hold(decl, "wrap", /className="table-wrap"/.test(table.before), "the table is not inside a div.table-wrap");
      const wide = decl.columns.length >= 6 || decl.generated === true;
      if (wide) {
        hold(decl, "focusable-wrap", /table-wrap"[^>]*tabIndex=\{0\}|tabIndex=\{0\}[^>]*className="table-wrap"/.test(table.before),
          "a scroll region six or more columns wide must carry tabIndex={0} on its wrap, or a keyboard cannot reach it");
      }
      const caps = captions(table);
      hold(decl, "caption", caps.length === 1 && /coh-table__caption/.test(caps[0]),
        "exactly one <caption className=\"coh-table__caption\"> per table");
      hold(decl, "total-row", totalRow(table) === (decl.total ?? null),
        `the total row is ${totalRow(table) ?? "absent"}; the contract says ${decl.total ?? "none"} — one spelling: tfoot > tr.coh-table__total`);
      if (decl.headless) {
        hold(decl, "headless", !/<thead>/.test(table.block), "declared headless but draws a <thead>");
      }
    });
  }
});

describe("the columns are the ones declared, over the cells declared", () => {
  for (const decl of TABLES) {
    if (decl.headless) continue;
    it(`${keyOf(decl)} heads ${decl.columns.length} columns as declared`, () => {
      const table = tableOf(decl);
      const labels = headerLabels(table);
      assert.deepEqual(labels, decl.columns.map(([label]) => label),
        `${keyOf(decl)} is headed [${labels.join(" | ")}]. If a column was renamed, rename it in engine-tables.ts in the same change.`);
      if (decl.cellsElsewhere || decl.generated) return;
      const cells = bodyCells(table);
      assert.equal(cells.length, decl.columns.length, `${keyOf(decl)} draws ${cells.length} cells per row against ${labels.length} headers`);
      for (const [index, [label, token]] of decl.columns.entries()) {
        if (!token) continue;
        assert.ok(cells[index].inner.includes(token),
          `${keyOf(decl)}: column "${label}" does not read ${token}; the cell holds: ${words(cells[index].inner).slice(0, 80)}`);
      }
    });
  }
});

describe("a quantity column is .num on its header and its cells; an identifier is not", () => {
  for (const decl of TABLES) {
    if (decl.headless || decl.cellsElsewhere || decl.generated) continue;
    it(`${keyOf(decl)} marks its quantities`, () => {
      const table = tableOf(decl);
      const heads = headerAttributes(table);
      const cells = bodyCells(table);
      for (const [index, [label, , kind]] of decl.columns.entries()) {
        const numHead = /\bnum\b/.test(heads[index] ?? "");
        const numCell = /\bnum\b/.test(cells[index]?.attributes ?? "");
        if (kind === "num") {
          hold(decl, `num-column:${label}`, numHead && numCell, `"${label}" is a quantity and lacks .num on its ${numHead ? "cell" : "header"}`);
        } else if (index > 0) {
          hold(decl, `text-column:${label}`, !numHead && !numCell, `"${label}" is ${kind} and carries .num`);
        }
      }
      const rowHeader = cells[0];
      if (rowHeader?.tag === "th") {
        const numKey = /\bnum\b/.test(rowHeader.attributes);
        hold(decl, "row-key", numKey === (decl.rowKey === "quantity"),
          numKey ? "a .num row header must be declared rowKey: quantity" : "declared rowKey: quantity but the row header is not .num");
      }
    });
  }
});

describe("marks only where declared, and null is one dash with a reason", () => {
  for (const decl of TABLES) {
    if (decl.headless || decl.cellsElsewhere) continue;
    it(`${keyOf(decl)} keeps glyphs to its marks column and never fakes a null`, () => {
      const table = tableOf(decl);
      const cells = bodyCells(table);
      for (const [index, [label, , kind]] of decl.columns.entries()) {
        const cell = cells[index];
        if (!cell || kind === "marks" || cell.tag === "th") continue;
        hold(decl, `no-mark:${label}`, !MARKS.test(cell.inner),
          `"${label}" is ${kind} and prints a status mark; declare the column "marks" if the glyph is the reading`);
      }
      for (const cell of cells) {
        hold(decl, "null-dash", !/"-"|"n\/a"|className="muted">—/.test(cell.inner),
          "a null cell is the em dash \"—\" and nothing else — not a hyphen, not n/a, and never a muted dash carrying its meaning in colour");
      }
    });
  }
});

describe("the two literals other suites pin are restated where the shape is declared", () => {
  it("DispersionTable keeps its per-row fold and the detail paragraph inside it", () => {
    const source = read("../components/coherence/DispersionTable.tsx");
    assert.match(source, /<summary>How this row reached its usable count<\/summary>/);
    assert.match(source, /<p>\{row\.detail\}<\/p>/);
  });
});
