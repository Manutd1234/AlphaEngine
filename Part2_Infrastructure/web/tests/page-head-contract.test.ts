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

/* The chip anatomy, from the rules below. Kept here so a change to any one of
   them has to be reflected in the floor, rather than silently outgrowing it. */
const BORDER = 1 * 2;
const PADDING = 9 * 2;
const LABEL_LINE = 15;
const ROW_GAPS = 2 * 2;
const VALUE_LINE = 14.5 * 1.24;
const NOTE_LINES = 10 * 1.34 * 2;
const REQUIRED = BORDER + PADDING + LABEL_LINE + ROW_GAPS + VALUE_LINE + NOTE_LINES;

describe("the metric chip is sized by its anatomy, not by its copy", () => {
  it("the floor fits a label, a value and a two-line note", () => {
    const body = ruleBody(globals, ".page-insight");
    const declared = /min-height:\s*(\d+(?:\.\d+)?)px/.exec(body);
    assert.ok(declared, ".page-insight must declare a min-height — without one the chip is copy-sized");
    const floor = Number(declared[1]);
    assert.ok(
      floor >= REQUIRED,
      `.page-insight floors at ${floor}px but its own anatomy needs ${REQUIRED.toFixed(2)}px. ` +
        "A chip whose note wraps will overflow the floor and stretch its whole row, " +
        "which is how Data and Reliability opened taller than the other six tabs.",
    );
    /* Not arbitrarily tall either: a floor well above the anatomy is padding
       pretending to be a contract. */
    assert.ok(floor < REQUIRED + 4, `.page-insight floors at ${floor}px, more than its anatomy explains`);
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
    assert.match(body, /-webkit-line-clamp:\s*2/, "the note is clamped to the two lines it reserves");
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
      /<small title=\{typeof metric\.note === "string" \? metric\.note : undefined\}>/,
      "the note is clamped to two lines, so a long one is clipped. The provenance line is " +
        "the half a reader checks when a number looks wrong; losing its tail silently is the " +
        "worst way to lose it.",
    );
  });
});
