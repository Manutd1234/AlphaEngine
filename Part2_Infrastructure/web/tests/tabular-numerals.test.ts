/**
 * A cell that prints a number prints it in tabular figures.
 *
 * Proportional digits are different widths — a "1" is narrower than an "8" —
 * so a column of them does not line up and a value that changes from 1,234 to
 * 8,888 grows the cell. On a desk that repaints every twenty seconds that is
 * layout jitter: the whole row breathes once per poll. `.num` sets the mono
 * face and `font-variant-numeric: tabular-nums`, and the rule is that every
 * cell whose content is a formatted number carries it.
 *
 * MEASURED before this was written rather than assumed: 69 numeric cells
 * carried `.num` and 31 did not, and 8 of the 31 were in one table — the
 * Research runs, where Sharpe, return and CAGR columns took a tone class from
 * `sign()` that REPLACED `num` rather than joining it. The tone said whether
 * the figure was good; it also, silently, made it proportional.
 *
 * DERIVED, NOT OBSERVED, as every geometric claim in this suite is: the check
 * is that a cell printing a formatter's result carries the class, which a
 * source scan can hold where no DOM-less test can hold a pixel width. The
 * formatters are the ones `lib/format.ts` exports for money, percentages and
 * fixed-precision figures; a cell printing one of those IS a number.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

/**
 * Comments only — NOT `stripNonCode`. That helper blanks string literals, and
 * the thing this file reads IS a string literal: `className="num"` becomes
 * `className=""` and every cell reads as bare. The first run of this suite
 * reported 0 cells carrying the class where a comments-only strip finds 69,
 * which the sanity check below exists to catch. A comment can still not
 * launder a match, because a `<td className="num">` inside a doc block is
 * gone before the scan.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const WEB = fileURLToPath(new URL("..", import.meta.url));

function tsxUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    for (const entry of readdirSync(at)) {
      const path = join(at, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".tsx")) out.push(path);
    }
  };
  walk(join(WEB, dir));
  return out;
}

/** The formatters whose output is, by construction, a number. */
const NUMERIC = "usd|pct|fmt|compact|formatDuration|metricRow|decimalLabel|priceLabel|dollarsLabel|contractsLabel|countLabel|secondsLabel|probLabel";
/** An element whose content opens with a numeric formatter call. */
const CELL = new RegExp(`<(td|span|dd|strong|b)([^>]*)>\\{(?:${NUMERIC})\\(`, "g");

/**
 * Cells that print a number without `.num`, and why each is allowed to.
 *
 * A RATCHET THAT ONLY SHRINKS. Not a ban, because two of these are genuinely
 * not tabular — a single figure inline in a sentence has nothing to line up
 * with — and the rest are debt this file records rather than hides. A new one
 * fails; an entry that gains the class must LEAVE the list, or the list stops
 * describing the tree and starts excusing it.
 */
const ALLOWED = new Set<string>([
  // A single share printed inside a legend row, beside a swatch: one figure,
  // nothing to align with, and the row is not a column.
  "components/portfolio/AllocationDonut.tsx",
  // The utilisation figure sits inside a positioned span whose colour IS the
  // reading; it is one number under a bar, not a column of them.
  "components/execution/LiquidityBook.tsx",
]);

describe("the scan is finding what it counts", () => {
  it("sees the cells that already carry the class", () => {
    // The empty-scan trap: a pattern that matched nothing would pass the ban
    // below trivially. Sixty-nine cells carried `.num` when this was written.
    let carrying = 0;
    for (const path of tsxUnder("components")) {
      for (const match of stripComments(readFileSync(path, "utf8")).matchAll(CELL)) {
        if (/\bnum\b/.test(match[2])) carrying++;
      }
    }
    assert.ok(carrying >= 60, `only ${carrying} numeric cells carry .num — the pattern has stopped matching`);
  });
});

describe("every numeric cell prints tabular figures", () => {
  it("carries .num wherever a formatter's result is the cell", () => {
    const bare: string[] = [];
    for (const path of tsxUnder("components")) {
      const rel = path.slice(WEB.length).replace(/^\/+/, "");
      if (ALLOWED.has(rel)) continue;
      const code = stripComments(readFileSync(path, "utf8"));
      for (const match of code.matchAll(CELL)) {
        if (!/\bnum\b/.test(match[2])) {
          const line = code.slice(0, match.index).split("\n").length;
          bare.push(`${rel}:${line}  <${match[1]}${match[2].trim() ? " " + match[2].trim().slice(0, 40) : ""}>`);
        }
      }
    }
    assert.deepEqual(bare, [],
      `these cells print a number in proportional digits, so the column jitters as values change:\n  ${bare.join("\n  ")}`);
  });

  it("keeps the allow-list honest — an entry that gained the class must leave", () => {
    const stale = [...ALLOWED].filter((rel) => {
      const code = stripComments(readFileSync(join(WEB, rel), "utf8"));
      return ![...code.matchAll(CELL)].some((m) => !/\bnum\b/.test(m[2]));
    });
    assert.deepEqual(stale, [], `these no longer have a bare numeric cell and must be removed from ALLOWED:\n  ${stale.join("\n  ")}`);
  });
});
