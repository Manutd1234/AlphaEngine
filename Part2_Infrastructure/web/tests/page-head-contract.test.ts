/**
 * The page header is the one thing every workspace shares, so its height has to
 * be a property of its anatomy rather than of how long someone's copy happened
 * to be. It was not: `.page-insight` floored at 81px, which is the height of a
 * chip whose note is ONE line, while the rule's own comment claimed it was
 * "sized for the two-line note, on every tab". Data wraps five of six notes and
 * Reliability wraps one, so those two opened 171px against everyone else's 168,
 * and by 900px the spread was 47px.
 *
 * Two things close it, and both are asserted here: the floor is the arithmetic
 * of the anatomy, and the note slot reserves its second line whether or not the
 * note fills it. Neither is visible to a rendering test that only looks at one
 * tab — the divergence only exists BETWEEN tabs — so these assertions guard the
 * numbers directly.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = join(import.meta.dirname, "..");
const globals = readFileSync(join(root, "app/globals.css"), "utf8");
const pageHead = readFileSync(join(root, "components/workspace/PageHead.tsx"), "utf8");

/** The declaration body of the last rule matching `selector` exactly. */
function ruleBody(css: string, selector: string): string {
  const pattern = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  const matches = [...css.matchAll(pattern)];
  assert.ok(matches.length > 0, `no rule found for ${selector}`);
  const last = matches[matches.length - 1];
  const start = css.indexOf("{", last.index);
  const end = css.indexOf("}", start);
  return css.slice(start + 1, end);
}

/* The chip's fixed anatomy — border, padding and the two row gaps. The three
   line-heights are read off the rules below and checked against the floor's
   own arithmetic, so a change to any one of them has to be reflected in the
   floor rather than silently outgrowing it. */
const FIXED_PX = 1 * 2 + 9 * 2 + 2 * 2;

/** The line-height a rule declares, resolving the --lh-* tokens. */
function lineHeightOf(body: string): number {
  const raw = /line-height:\s*([^;]+);/.exec(body)?.[1]?.trim();
  assert.ok(raw, "rule declares no line-height");
  const tokens: Record<string, number> = { "var(--lh-none)": 1, "var(--lh-tight)": 1.2, "var(--lh-snug)": 1.35, "var(--lh-body)": 1.5, "var(--lh-loose)": 1.6 };
  const value = tokens[raw!] ?? Number(raw);
  assert.ok(Number.isFinite(value), `unreadable line-height ${raw}`);
  return value;
}

describe("the metric chip is sized by its anatomy, not by its copy", () => {
  it("the floor is the anatomy's own arithmetic, in the tokens the rows are drawn with", () => {
    const body = ruleBody(globals, ".page-insight");
    const declared = /min-height:\s*calc\(([^;]+)\);/.exec(body);
    assert.ok(declared, ".page-insight must declare a calc() min-height — a px number drifts from the anatomy, and did");
    const calc = declared![1];
    // Fixed part.
    assert.match(calc, new RegExp(`^${FIXED_PX}px \\+`), `the fixed part must be ${FIXED_PX}px (border, padding, gaps)`);
    // The three lines, each multiplier read from its rule.
    const label = lineHeightOf(ruleBody(globals, ".page-insight > span"));
    const value = lineHeightOf(ruleBody(globals, ".page-insight > strong"));
    const note = lineHeightOf(ruleBody(globals, ".page-insight > small"));
    assert.match(calc, new RegExp(`\\+ ${label} \\* var\\(--fs-2xs\\)`), `label line must be ${label} × --fs-2xs`);
    assert.match(calc, new RegExp(`\\+ ${value} \\* var\\(--fs-title\\)`), `value line must be ${value} × --fs-title`);
    assert.match(calc, new RegExp(`\\+ ${(note * 2).toFixed(2)} \\* var\\(--fs-2xs\\)`), `note lines must be ${note} × 2 × --fs-2xs`);
    // And the label's rung and the value's rung are the ones the calc names.
    assert.match(ruleBody(globals, ".page-insight > span"), /font-size:\s*var\(--fs-2xs\)/);
    assert.match(ruleBody(globals, ".page-insight > strong"), /font-size:\s*var\(--fs-title\)/);
    assert.match(ruleBody(globals, ".page-insight > small"), /font-size:\s*var\(--fs-2xs\)/);
  });

  it("the note slot reserves its second line whether or not the note fills it", () => {
    const body = ruleBody(globals, ".page-insight > small");
    assert.match(
      body,
      /min-height:\s*calc\(1\.34em\s*\*\s*2\)/,
      "the note must reserve two lines. Without it a tab whose notes all fit on one " +
        "line renders a shorter chip, and only the grid's row-stretch hides that — " +
        "which works within a row and not at all between tabs.",
    );
    /* The clamp is on the text, not on the row: the row also holds an optional
       sparkline, and a line count meant for words would clip an SVG. */
    const text = ruleBody(globals, ".page-insight > small > span:first-child");
    assert.match(text, /-webkit-line-clamp:\s*2/, "the note text is clamped to the two lines it reserves");
  });

  it("a chip carrying a sparkline is no taller than one without", () => {
    const spark = ruleBody(globals, ".page-insight__spark");
    assert.match(
      spark,
      /flex-shrink:\s*0/,
      "the spark shares the note's reserved slot rather than adding a row below it; " +
        "if it could be pushed to its own line the chip would outgrow the floor",
    );
  });

  it("no chip opts out of the floor for being a button", () => {
    const body = ruleBody(globals, "button.page-insight");
    assert.doesNotMatch(
      body,
      /min-height:\s*auto/,
      "a chip that happens to be a button is still a chip; opting it out meant a header " +
        "whose metrics were all actionable opened shorter than one whose metrics were not",
    );
  });
});

describe("the header's status pill has a rule for every tone it declares", () => {
  it("every PageStatus tone is styled", () => {
    const declared = /tone:\s*("(?:good|warn|critical|neutral)"\s*\|\s*)+"(?:good|warn|critical|neutral)"/.exec(pageHead);
    assert.ok(declared, "PageStatus must declare its tone union — parsing broke?");
    const tones = [...declared[0].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
    assert.ok(tones.length >= 4, `expected at least four tones, parsed ${tones.join(", ")}`);
    for (const tone of tones) {
      assert.ok(
        globals.includes(`.page-status.is-${tone}`),
        `PageStatus accepts "${tone}" but .page-status.is-${tone} has no rule, so it renders as ` +
          "the bare pill — a state indistinguishable from an unstyled fallback",
      );
    }
  });
});

describe("a clipped provenance line is recoverable", () => {
  it("the note carries its full text as a title", () => {
    assert.match(
      pageHead,
      /<span title=\{typeof metric\.note === "string" \? metric\.note : undefined\}>\{metric\.note\}<\/span>/,
      "the note is clamped to two lines, so a long one is clipped. The provenance line is " +
        "the half a reader checks when a number looks wrong; losing its tail silently is the " +
        "worst way to lose it.",
    );
  });
});
