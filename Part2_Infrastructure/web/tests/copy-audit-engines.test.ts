/**
 * The copy audit, extended to the two engine rails.
 *
 * `copy-audit.test.ts` names four shapes of restating copy and covers the eight
 * role tabs. It does not reach `markets` (Quotes) or `coherence` (Proofs), which
 * are where the drawings live — and a drawing changes what counts as restating.
 * On a tab of tables, a sentence beside a number is often the only thing saying
 * what the number is for. On a tab of figures, the same sentence is the figure
 * read aloud.
 *
 * Two more shapes, both measured on these rails before being written:
 *
 *   5. A `<Figure reading>` running from one end of its own axis to the other.
 *   6. A wire-supplied prose column rendered raw in a table of measurements.
 *
 * WHAT THE MEASUREMENT CHANGED. A first pass flagged five paraphrase columns and
 * proposed cutting four. Four of the five turned out to be legitimate and the
 * plan was wrong about them, which is worth recording because the distinction is
 * the whole rule:
 *
 *   - `RfqPane`'s `What it means` / `What it is not` map a LITERAL `STATES`
 *     table. Those rows are vocabulary, and a definition column on a glossary is
 *     the content, not a paraphrase of it.
 *   - `ShellCommandReference`'s `What it reads` maps a literal `DERIVED_FILES`.
 *     A command's effect is not derivable from its name.
 *   - `CalibrationScore`'s `What it reads` holds definitions authored in the
 *     file — what a Brier score measures, why "untestable" is a skip — and the
 *     rows whose notes did restate their own figure already had the notes
 *     emptied rather than the column dropped from under the rows that teach.
 *     The argument is recorded at the `<th>` itself.
 *   - `surface/DistributionView`'s `Reading` is the ROW LABEL, first column. A
 *     header-text match cannot tell a row label from a paraphrase; only the
 *     cells can.
 *
 * So shape 6 is not "a column whose header sounds explanatory". It is: the row
 * came off the wire, and the cell holds prose that came off the wire with it.
 * That is checkable, and it is the one case that was actually there.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (relative: string) => readFileSync(join(here, relative), "utf8");

/** Comments stripped: a comment explaining a removal must not fail its own test. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** Every component on the two engine rails. */
function engineFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".tsx")) out.push(path);
    }
  };
  for (const root of ["../components/coherence", "../components/markets"]) {
    const dir = join(here, root);
    try {
      if (statSync(dir).isDirectory()) walk(dir);
    } catch {
      // A rail that does not exist as its own directory is covered by the other.
    }
  }
  return out;
}

const shortName = (path: string) => path.split("/web/")[1] ?? path;

/**
 * The value of every `reading={...}` in a source, brace-balanced.
 *
 * A window of N characters cannot do this. The first version of this file used
 * one and it was VACUOUS on exactly the readings worth auditing: the long ones
 * overran the window, matched nothing, and passed. Proved by re-introducing the
 * cut sentence and watching the rule stay green while its pinned assertion went
 * red. Count the braces instead — template literals and ternaries nest freely.
 */
function readings(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/reading=\{/g)) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
      i += 1;
    }
    if (depth === 0) out.push(source.slice(start, i - 1));
  }
  return out;
}

describe("shape 5 — a reading does not read the axis aloud", () => {
  const files = engineFiles();

  it("finds the readings it is meant to be checking", () => {
    // Guards the extractor, not the copy: a brace matcher that silently
    // returned nothing would make every rule below pass on an empty set.
    const found = files.flatMap((f) => readings(code(readFileSync(f, "utf8"))));
    assert.ok(found.length >= 8,
      `expected the engine rails to carry readings to audit, found ${found.length}`);
    assert.ok(found.every((value) => value.trim().length > 0),
      "the brace matcher returned an empty value, so it is not reading what it thinks");
    assert.ok(found.some((value) => value.length > 400),
      "no reading over 400 characters was extracted — the long ones are the point");
  });

  it("no reading states both ends of its own series", () => {
    // `from X … to Y` over two interpolations is the axis: the extent of the
    // thing drawn directly beneath the sentence. It is the one fact a reader
    // cannot miss, and the one a caption is worst at adding to.
    const offenders: string[] = [];
    for (const file of files) {
      for (const value of readings(code(readFileSync(file, "utf8")))) {
        if (/\bfrom \$\{[\s\S]{0,80}?\bto \$\{/.test(value)) {
          offenders.push(`${shortName(file)}: ${value.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    assert.deepEqual(offenders, [],
      `these readings recite the extent of the drawing under them:\n    ${offenders.join("\n    ")}`);
  });

  it("the survival reading keeps the judgement it made", () => {
    // The positive half of the pin. What went was the two endpoints; what must
    // stay is the claim the geometry does not make — that a crossing between
    // two quoted strikes is bracketed rather than located, because the exchange
    // quotes nothing inside the gap. Cutting that would be losing the point.
    const survival = read("../components/coherence/SurvivalChart.tsx");
    assert.match(survival, /the crossing is bracketed, not located/,
      "the bracketed-not-located judgement is the reason this reading exists");
    assert.doesNotMatch(code(survival), /Survival runs from \$\{/,
      "the opening sentence gave the curve's two endpoints — the axis, read aloud");
  });
});

describe("shape 6 — wire prose is not a column of a table of measurements", () => {
  it("no wire-fed row renders a wire prose field as a bare cell", () => {
    // The test is not what the column is CALLED. It is whether the row came off
    // the wire and the cell holds prose that came off the wire with it. A
    // literal glossary is exempt by construction: its rows are authored here.
    const PROSE_FIELDS = /\b(detail|verdict|note|notes|reason|says|summary|basis|explanation)\b/;
    const offenders: string[] = [];
    for (const file of engineFiles()) {
      const source = code(readFileSync(file, "utf8"));
      for (const match of source.matchAll(/<td[^>]*>\{(\w+)\.(\w+)(?:\s*\?\?\s*[^}]*)?\}<\/td>/g)) {
        const [, object, field] = match;
        // `row`/`data`/`item` are the wire record; `fact`/`part` are authored.
        if (!/^(row|data|entry|record)$/.test(object)) continue;
        if (!PROSE_FIELDS.test(field)) continue;
        offenders.push(`${shortName(file)}: <td>{${object}.${field}}</td>`);
      }
    }
    assert.deepEqual(offenders, [],
      `unbounded wire prose in a measured row — fold it behind a <details>:\n    ${offenders.join("\n    ")}`);
  });

  it("the dispersion notes are kept, and folded", () => {
    // The positive half: the gateway's reasons are not deleted. Every one of
    // them is still rendered, one disclosure per row, because the counts they
    // explain are columns of that same row and nothing else says why a quote
    // was left out of them.
    const rfq = read("../components/coherence/RfqPane.tsx");
    assert.match(rfq, /<summary>How this row reached its usable count<\/summary>/,
      "the fold must name what it hides");
    assert.match(rfq, /<p>\{row\.detail\}<\/p>/,
      "every word the gateway sent still renders");
  });

  it("a borrowed sentence keeps its own punctuation", () => {
    // Appending a full stop to a string we did not write claims to know it
    // ended without one. `panel.detail` is composed by the gateway.
    const rfq = code(read("../components/coherence/RfqPane.tsx"));
    assert.doesNotMatch(rfq, /\{panel\.detail\}\./,
      "the gateway's sentence ends where the gateway ended it");
    assert.match(rfq, /The gateway says: \{panel\.detail\}/,
      "wire text stays attributed — unattributed, it reads as ours");
  });

  it("a glossary keeps its definition column", () => {
    // The exemption, stated as an assertion so that cutting these later fails
    // with the argument rather than passing quietly.
    const shell = read("../components/coherence/ShellCommandReference.tsx");
    assert.match(shell, /<th scope="col">What it reads<\/th>/,
      "a command's effect is not derivable from its name");
    const score = read("../components/coherence/CalibrationScore.tsx");
    assert.match(score, /<th scope="col">What it reads<\/th>/,
      "these cells define what a Brier score measures; the restating notes were emptied instead");
  });
});
