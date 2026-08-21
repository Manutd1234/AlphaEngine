/**
 * British spelling, in the words a reader actually sees.
 *
 * `CLAUDE.md` opens with "British spelling throughout, in prose and in
 * identifiers", and until now that was the only house rule with nothing behind
 * it — every other one names a test that turns red. It drifted exactly as an
 * unenforced convention does: the Overview tab shipped a kicker reading
 * "AlphaEngine command center" in a file whose own comment eight lines earlier
 * said "the command centre band", and `KpiDeck` rendered "modeled cost" while
 * the rest of the tree wrote "modelled" in eight places. `copy-audit.test.ts`
 * had ended up pinning `/modeled cost/` with a failure message that said
 * "modelled" — the guard was arguing with itself.
 *
 * ── Scope, and why it is narrow ─────────────────────────────────────────────
 *
 * Only text a reader sees: JSX text nodes, and string literals assigned to the
 * props that render as words. NOT identifiers, NOT comments, NOT CSS.
 *
 * CSS is the reason this cannot be a naive grep. `color`, `color-mix()`,
 * `prefers-color-scheme` and `text-align: center` are spelled the American way
 * *by specification* — writing `colour` there produces a stylesheet that does
 * nothing. So a value that looks like CSS is skipped, and the word list below
 * deliberately omits nothing-but-CSS words rather than trying to except them
 * case by case.
 *
 * A word list, not a dictionary. It holds the American forms that have actually
 * appeared in this tree or are one slip away from it. It may grow; it should
 * never need a suppression list, because anything it flags is either a real
 * violation or a sign the entry was too broad to keep.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** American form -> the British form this codebase uses. */
const AMERICAN: Record<string, string> = {
  center: "centre", centers: "centres", centered: "centred",
  modeled: "modelled", modeling: "modelling", modeler: "modeller",
  canceled: "cancelled", canceling: "cancelling",
  labeled: "labelled", labeling: "labelling",
  behavior: "behaviour", behaviors: "behaviours",
  analyze: "analyse", analyzed: "analysed", analyzing: "analysing",
  normalize: "normalise", normalized: "normalised", normalization: "normalisation",
  optimize: "optimise", optimized: "optimised", optimization: "optimisation",
  summarize: "summarise", summarized: "summarised",
  recognize: "recognise", recognized: "recognised",
  organize: "organise", organized: "organised",
  utilize: "utilise", utilized: "utilised",
  favorite: "favourite", favorites: "favourites",
  defense: "defence", offense: "offence",
  fulfill: "fulfil", enrollment: "enrolment",
  catalog: "catalogue",
};

/** Props whose string value is rendered as words a reader reads. */
const TEXT_PROPS = [
  "kicker", "label", "title", "description", "why", "status", "detail",
  "heading", "caption", "hint", "note", "summary", "placeholder",
  "aria-label", "ariaLabel", "legend", "message",
];

/**
 * Does this string look like CSS or code rather than prose?
 *
 * `color-mix(in srgb, ...)`, `(prefers-color-scheme: dark)` and Tailwind class
 * strings all legitimately carry American spellings, and none of them is prose.
 */
const looksLikeCode = (value: string) =>
  /[(){}:;]|--|\bvar\b|\bsrgb\b|^[a-z-]+(\s+[a-z0-9:[\]/.-]+)*$/.test(value.trim());

function sources(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Comments stripped: a comment naming the American form must not fail its own test. */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** Every run of prose this file renders. */
function renderedText(source: string): string[] {
  const code = stripComments(source);
  const out: string[] = [];
  // JSX text nodes: >  some words  <
  for (const match of code.matchAll(/>\s*([^<>{}]{3,})\s*</g)) out.push(match[1]);
  // String values of props that render as words.
  const props = TEXT_PROPS.map((p) => p.replace(/[^\w-]/g, "")).join("|");
  for (const match of code.matchAll(new RegExp(`\\b(?:${props})\\s*[=:]\\s*["'\`]([^"'\`]{3,})["'\`]`, "g"))) {
    out.push(match[1]);
  }
  return out.filter((text) => !looksLikeCode(text));
}

describe("the desk speaks British English", () => {
  const files = [...sources(join(root, "components")), ...sources(join(root, "app"))];

  it("scans a meaningful number of files, so a broken walk cannot pass silently", () => {
    // The same trap `copy-audit.test.ts` documents: a scan that finds nothing
    // because it looked nowhere reads exactly like a clean bill of health.
    assert.ok(files.length > 100, `only ${files.length} component files scanned`);
  });

  it("no rendered word uses the American spelling", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const relative = file.slice(root.length);
      for (const text of renderedText(source)) {
        for (const word of text.match(/[A-Za-z]+/g) ?? []) {
          const british = AMERICAN[word.toLowerCase()];
          if (british) {
            offenders.push(`${relative}: "${word}" should be "${british}" — ${text.trim().slice(0, 60)}`);
          }
        }
      }
    }
    assert.deepEqual(offenders, [],
      `American spellings in rendered text:\n    ${offenders.join("\n    ")}`);
  });
});
