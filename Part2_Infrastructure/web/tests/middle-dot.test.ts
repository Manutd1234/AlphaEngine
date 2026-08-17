/**
 * The middle dot is not a word.
 *
 * "quote · crypto", "cache hit · delayed", "23 · day", "Decision loop flow ·
 * Quant developer": two hundred and ninety compounds where a header, a label
 * or a note should have been a phrase. In a tabular readout — peer
 * measurements of the same kind, in mono type, "p50 120 ms · p99 400 ms · n=4"
 * — the dot is a column rule the eye scans across. In running text it is an
 * unexplained abbreviation, and on a header it is a key leaking into the UI.
 *
 * The rule, in three parts:
 *   1. Never on a heading, a kicker, a `<summary>`, a label field, a
 *      section note, a button, a banner or an aria-label. Those are names.
 *   2. Notes, details and captions are prose: peer facts of different kinds
 *      are a comma list ("23 hits, 4 misses"), a qualifier takes a semicolon
 *      ("Configured; no call in 15 minutes"), a two-part label becomes words
 *      ("Cache hit, delayed tier"; "23 of 25 left today").
 *   3. The only place the dot survives is between same-kind measurements in
 *      tabular type, and only through `metricRow` in lib/format.ts — so a
 *      grep for the raw literal finds nothing, and the helper's name states
 *      the contract.
 *
 * Part 3 is a ratchet, in the shape of dead-css.test.ts: the count of raw
 * separators may only go down, and a sweep that removes them must lower the
 * baseline in the same commit so the number stays a measurement.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry) && !/\.generated\./.test(entry)) out.push(full);
  }
  return out;
}

/** The one sanctioned home of the separator. */
const HELPER = join(root, "lib/format.ts");

/** Comments blanked, newlines kept, so a line number still means something. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (_m, lead: string) => lead);

/**
 * A middle dot used as a separator: whitespace, a tag or a JSX brace on at
 * least one side. `k·√`, `2·EMA` and `σ·√t` are multiplication and stay;
 * `"·"` as a lone glyph and `···` as an overflow mark stay.
 */
const SEPARATOR = /(?:^|[\s>}])·(?:[\s<{]|$)/gm;

const files = [...sources(join(root, "components")), ...sources(join(root, "app")), ...sources(join(root, "lib"))]
  .filter((file) => file !== HELPER);

const offendersOf = (pattern: RegExp, label: string): string[] => {
  const out: string[] = [];
  for (const file of files) {
    const text = code(readFileSync(file, "utf8"));
    for (const match of text.matchAll(pattern)) {
      const line = text.slice(0, match.index).split("\n").length;
      out.push(`${file.slice(root.length)}:${line} — ${label}: ${match[0].trim().slice(0, 80)}`);
    }
  }
  return out;
};

describe("the middle dot never names a thing", () => {
  it("no heading, summary or kicker carries one", () => {
    assert.deepEqual(offendersOf(/<(?:h[1-3]|summary)\b[^>]*>[^<{]*·/g, "heading"), []);
    assert.deepEqual(offendersOf(/kicker[^>\n]*>[^<{]*·/g, "kicker span"), []);
    assert.deepEqual(offendersOf(/kicker:\s*[`"'][^`"'\n]*·/g, "kicker field"), []);
  });

  it("no label field, section note or aria-label carries one", () => {
    assert.deepEqual(offendersOf(/\blabel:\s*[`"'][^`"'\n]*·/g, "label field"), []);
    assert.deepEqual(offendersOf(/section-note[^>\n]*>[^<{]*·/g, "section note"), []);
    assert.deepEqual(offendersOf(/aria-label=\{?[`"'][^`"'\n]*·/g, "aria-label"), []);
  });

  it("no button or pill carries one", () => {
    assert.deepEqual(offendersOf(/<button\b[^>]*>[^<{]*·/g, "button"), []);
    assert.deepEqual(offendersOf(/className="pill"[^>]*>[^<{]*·/g, "pill"), []);
  });
});

describe("the raw separator count ratchets down", () => {
  // Measured after the Data, Reliability and Developer sweep on 2026-08-17.
  // Each sweep that follows (Overview, Header, Portfolio/Risk/Research/
  // Execution) lowers this in the same commit; the floor keeps the number
  // honest — a baseline far above reality stops being a ratchet.
  const BASELINE = 163;
  const FLOOR = BASELINE - 40;

  it(`no more than ${BASELINE} raw separators outside metricRow, and the baseline is not stale`, () => {
    const found = offendersOf(SEPARATOR, "separator");
    assert.ok(
      found.length <= BASELINE,
      `${found.length} raw middle-dot separators (baseline ${BASELINE}). New ones must go through metricRow ` +
        `or become prose:\n  ${found.slice(-12).join("\n  ")}`,
    );
    assert.ok(
      found.length >= FLOOR,
      `only ${found.length} raw separators remain — lower BASELINE to ${found.length} so the ratchet keeps biting`,
    );
  });

  it("the helper is the only file that spells the separator as a join", () => {
    assert.deepEqual(offendersOf(/join\(\s*["'`] · ["'`]\s*\)/g, "join with the separator"), []);
    assert.match(readFileSync(HELPER, "utf8"), /export const metricRow/);
  });
});
