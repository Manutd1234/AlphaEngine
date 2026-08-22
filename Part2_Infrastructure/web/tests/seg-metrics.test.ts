/**
 * The segmented control has ONE size, and pressing it does not change it.
 *
 * Two defects were screenshotted on the running desk, both on `.seg`.
 *
 * The first: Portfolio's Performance switcher — "Flow, lifetime" beside
 * "Trend, this session" — photographed at two different widths depending on
 * which side was selected. The mechanism is in `00-tokens-and-base.css`: the
 * seam is drawn as `.seg button + button { border-left: 1px }` over a
 * `.seg button { border: 0 }`, so segment ONE's box is a pixel narrower than
 * every segment after it, and the raised chip — the only thing on the control
 * with a visible edge — is a different width depending on which segment is
 * pressed. A metric was carrying the selection. The fix is the house one:
 * reserve the seam on every segment, transparent, and let the pressed rules
 * do nothing but paint.
 *
 * The second: four rules sized the same control and disagreed — 32px/--fs-lg
 * from the bare rule, --fs-body on `.research-seg button`, 34px/--fs-lg/a 14px
 * inset on `.blotter-views__bar .seg button`, and 24px/--fs-sm in the rail, on
 * a control thirty-eight call sites render across eight tabs. They are
 * converged on the smallest of the four, in `12-workspace-standardisation.css`.
 *
 * These tests are the ratchet on both. They read the concatenated cascade the
 * browser actually applies (`tests/globals-css.ts`), not one partial — a rule
 * added to a later partial is exactly how the four sizes accumulated in the
 * first place, and a suite reading only file 12 would never see it. "Subtabs"
 * also names the role tabs and the section rail, held to the same two rules by
 * `tab-chrome-metrics.test.ts`. */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, locateInGlobals } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

interface Rule {
  /** The at-rule context this sits in, outermost first. */
  readonly context: readonly string[];
  /** The selector list, whitespace collapsed. */
  readonly selector: string;
  /** The declarations, whitespace collapsed. */
  readonly body: string;
  /** `app/globals/12-…css:1476`. */
  readonly where: string;
}

/**
 * Every declaration block in the sheet, with the at-rules it is nested in.
 *
 * Hand-walked rather than regexed: `@media` blocks nest, and a regex that
 * stops at the first `}` reads a media query's first rule as the whole block.
 * That is the failure mode this file exists to catch, so it may not be the
 * failure mode of the file itself.
 */
function rules(text: string): Rule[] {
  const out: Rule[] = [];
  const context: string[] = [];
  let cursor = 0;
  let start = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character === "{") {
      const selector = text.slice(start, cursor).trim().replace(/\s+/g, " ");
      if (selector.startsWith("@")) {
        context.push(selector);
        cursor += 1;
        start = cursor;
        continue;
      }
      let depth = 1;
      let scan = cursor + 1;
      for (; scan < text.length && depth > 0; scan += 1) {
        if (text[scan] === "{") depth += 1;
        else if (text[scan] === "}") depth -= 1;
      }
      out.push({
        context: [...context],
        selector,
        body: text.slice(cursor + 1, scan - 1).trim().replace(/\s+/g, " "),
        where: locateInGlobals(cursor),
      });
      cursor = scan;
      start = cursor;
      continue;
    }
    if (character === "}") {
      context.pop();
      cursor += 1;
      start = cursor;
      continue;
    }
    cursor += 1;
  }
  return out;
}

const all = rules(css);

/** Every `.tsx` under a directory, recursively. */
function sourceFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Rules whose selector list names the segmented control at all. */
const segRules = all.filter(
  (rule) =>
    /(^|[\s,>+~(])\.seg\b|\.seg--|-seg\b/.test(rule.selector)
    // `.blotter-toolbar button:not(.seg button)` names the seg only to EXCLUDE
    // itself from a toolbar rule. It sizes everything that is not a segment.
    && !/:not\([^)]*\.seg/.test(rule.selector),
);

/**
 * The properties that decide how much space a segment occupies.
 *
 * `min-width` and `max-width` are deliberately absent: they cap a control's
 * OUTER box (`.workspace-subtab-panel > .seg` stops a two-option switcher
 * stretching 1,200px across a desk) and are the same whichever side is
 * pressed. Everything below changes the box a LABEL sits in.
 */
const METRIC =
  /(?:^|;\s*)(min-height|max-height|height|padding|padding-[a-z]+|font-size|font-weight|font-stretch|letter-spacing|word-spacing|text-transform|border-width|border-[a-z]+-width|border(?!-[a-z]*color)(?:-[a-z]+)?)\s*:/;

/** Which of those a body declares, for a readable failure. */
function metrics(body: string): string[] {
  return [...body.matchAll(/(?:^|;\s*)([a-z-]+)\s*:/g)]
    .map((match) => match[1])
    .filter((property) => METRIC.test(`${property}:`));
}

describe("the parser reads the sheet, not a slice of it", () => {
  // A brace-walker that silently returned nothing would make every assertion
  // below vacuously true, which is the shape of dead test this codebase has
  // already been bitten by.
  it("finds the seg's own rules, inside media blocks and out", () => {
    assert.ok(all.length > 2000, `only ${all.length} rules parsed — the walker lost the sheet`);
    assert.ok(segRules.length >= 15, `only ${segRules.length} seg rules found`);
    const base = segRules.find((rule) => rule.selector === ".seg button" && rule.context.length === 0);
    assert.ok(base, ".seg button was not found outside a media block");
    const coarse = segRules.find((rule) => rule.context.some((at) => at.includes("pointer: coarse")));
    assert.ok(coarse, "the coarse-pointer seg rule was not found inside its media block");
  });
});

describe("pressing a segment changes paint, never metrics", () => {
  const pressed = segRules.filter((rule) => rule.selector.includes("aria-pressed"));

  it("there are pressed-state rules to check", () => {
    assert.ok(pressed.length >= 3, `only ${pressed.length} pressed seg rules — the state moved`);
  });

  it("no pressed rule declares a property that changes the box", () => {
    // This is the reported defect stated as a rule. A heavier label, a wider
    // inset, a thicker border or a taller floor on the selected side all do
    // the same thing: the control resizes as the reader clicks between panes,
    // and on Performance it took the two cards below it along for the ride.
    const offenders = pressed
      .map((rule) => ({ rule, found: metrics(rule.body) }))
      .filter((entry) => entry.found.length > 0)
      .map((entry) => `${entry.rule.where} — ${entry.rule.selector} declares ${entry.found.join(", ")}`);
    assert.deepEqual(
      offenders,
      [],
      "a selected segment must occupy exactly the space an unselected one does:\n  "
        + offenders.join("\n  "),
    );
  });

  it("selection is still said by something that is not colour", () => {
    // The house rule, restated here beside the metric ban so a future author
    // cannot satisfy one by breaking the other: strip the weight change and
    // you must NOT reach for hue alone to replace it. `accent-budget.test.ts`
    // owns the same claim from the other side.
    const raised = [...css.matchAll(/\.seg button\[aria-pressed="true"\]\s*\{([^}]*)\}/g)].pop();
    assert.ok(raised, "the base pressed rule is gone");
    assert.match(raised![1], /box-shadow:/, "the raised chip's shadow is the non-colour carrier");
    assert.match(raised![1], /background:\s*var\(--surface-1\)/);
  });

  it("every segment reserves the seam, so the chip is one width", () => {
    // `00` seams all-but-the-first segment. Left alone, segment one's box is
    // 1px narrower than its neighbours' and the raised chip is a different
    // width depending on which side is pressed — the photographed defect.
    // The house rule gives every segment the border and lets 00's
    // `border-left-color` rules paint it in or out.
    const house = segRules.filter(
      (rule) => rule.selector === ".seg button" && /border-left:/.test(rule.body),
    );
    assert.equal(house.length, 1, "exactly one rule reserves the seam on every segment");
    assert.match(
      house[0].body,
      /border-left:\s*1px solid transparent/,
      "the reserved seam must be transparent — colouring it here would draw a seam on segment one",
    );
    // And the seam that IS drawn is drawn by colour alone, so it costs no box.
    assert.match(css, /\.seg button \+ button \{[^}]*border-left: 1px solid var\(--rule-soft\)/);
    assert.match(css, /\.seg button\[aria-pressed="true"\][^{]*\{\s*border-left-color: transparent;/);
  });
});

describe("one size, on all eight tabs", () => {
  const sizing = segRules.filter((rule) => metrics(rule.body).length > 0);

  /**
   * The only selectors allowed to size a segment.
   *
   * `.seg` is the frame (its 3px padding is the well the chips sit in);
   * `.seg button` is the segment, declared once for the desk and once inside
   * the single coarse-pointer block. `.seg button + button` is the seam, and
   * it is here only because it is the paired half of the reservation the
   * pressed-state suite above pins: the same 1px the house rule already gives
   * every segment, so it adds no box to any of them. Anything else would be a
   * fifth size arriving the way the first four did — locally, reasonably, and
   * invisibly to the tab next door.
   */
  const ALLOWED = new Set([".seg", ".seg button", ".seg button + button"]);

  it("nothing but the frame and the segment carries a metric", () => {
    const offenders = sizing
      .filter((rule) => !ALLOWED.has(rule.selector))
      .map((rule) => `${rule.where} — ${rule.selector} declares ${metrics(rule.body).join(", ")}`);
    assert.deepEqual(
      offenders,
      [],
      "a per-tab seg size is back; converge it in 12 instead:\n  " + offenders.join("\n  "),
    );
  });

  it("the four that disagreed are named, so their return is loud", () => {
    // Named rather than merely absent: the general rule above would also pass
    // if `.seg` stopped existing. These are the exact three overrides that
    // were removed, and the rail block that was folded into the house rule.
    const named = [
      ".research-seg button",
      ".blotter-views__bar .seg button",
      ".workspace-subtabs__actions .seg button",
      ".workspace-subtabs__actions .seg",
    ];
    // Three of the four were deleted outright and one kept a `white-space`
    // rule, so most of the loop below skips. Without this line the whole
    // check would pass on an empty stylesheet.
    assert.ok(
      named.some((selector) => all.some((rule) => rule.selector === selector)),
      "none of the four selectors is in the sheet at all — this check has stopped checking",
    );
    for (const selector of named) {
      const rule = all.find((candidate) => candidate.selector === selector);
      if (!rule) continue;
      assert.deepEqual(
        metrics(rule.body),
        [],
        `${selector} sizes the seg again (${rule.where}) — that is the defect the user photographed`,
      );
    }
  });

  it("the one size reads the ladder and the spacing tokens", () => {
    // The LAST `.seg button` outside a media block: two partials declare it
    // (00 sets the flex behaviour and the chip radius, 12 the size), and the
    // cascade applies the later one. Reading the first would assert against
    // the rule that lost.
    const base = segRules
      .filter((rule) => rule.selector === ".seg button" && rule.context.length === 0)
      .pop();
    assert.ok(base, ".seg button has no desk rule");
    assert.match(base!.body, /font-size: var\(--fs-[a-z0-9-]+\)/, "a literal px size is off the ladder");
    assert.match(base!.body, /padding: 3px var\(--space-2\)/, "the inset reads a spacing token");
    assert.match(base!.body, /min-height: 24px/);
  });

  it("the fingertip minimum is paid once, for every seg", () => {
    // 40px inside the seg's 3px frame and 1px border is 48px of control, and
    // 44px inside the rail's tighter frame — both past the floor the coarse
    // block enforces for every other control. It has to name `.seg button`:
    // the house rule's 24px floor is (0,1,1) and outranks the bare `button`
    // rule that used to carry panel segs there.
    const coarse = segRules.filter((rule) =>
      rule.context.some((at) => at.includes("pointer: coarse")));
    assert.equal(coarse.length, 1, "one coarse seg rule, or the touch contract has forked");
    assert.equal(coarse[0].selector, ".seg button");
    const height = coarse[0].body.match(/min-height:\s*(\d+)px/);
    assert.ok(height, "the coarse seg rule sets no min-height");
    assert.ok(
      Number(height![1]) + 3 * 2 + 1 * 2 >= 44,
      `${height![1]}px inside the seg's frame does not reach 44px at the fingertip`,
    );
  });
});

describe("the variant classes lost their sizes to the cascade, and must stay lost", () => {
  /**
   * Thirty-eight call sites render `.seg`, and ten of them hang a second class
   * on the same element — `.research-seg`, `.console-seg`, `.seg--side`,
   * `.developer-work__kinds`, `.data-workboard__kinds` and the rest. Three of
   * those still carry a metric on their own buttons, in partials 07 and 08:
   *
   *   .developer-work__kinds button      { min-height: 34px; padding-inline: 10px }
   *   .developer-api-catalog__groups button { min-height: 34px; padding-inline: 9px }
   *   .data-workboard__kinds button      { font-size: var(--fs-xs) }
   *
   * All three are (0,1,1), exactly what `.seg button` is, and all three are
   * declared BEFORE it, so the cascade already resolves them to the house size
   * and Developer and Data render at the other six tabs' metrics — but only
   * because of source order, which no error, no type and no build warning
   * protects. They are not deleted here because 07 and 08 are outside this
   * pass; the rule is stated instead. A variant may lose a size to the
   * cascade, but it may never be declared after the rule that beats it.
   */
  const houseRule = css.lastIndexOf(".seg button {");

  /** Second classes that components put on a `.seg` element. */
  const variants = (() => {
    const found = new Set<string>();
    for (const file of sourceFiles(join(root, "components"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/className="seg ([^"{]+)"/g)) {
        for (const name of match[1].trim().split(/\s+/)) found.add(name);
      }
    }
    return [...found].sort();
  })();

  it("the call sites still hang variant classes worth checking", () => {
    assert.ok(houseRule > 0, "the house `.seg button` rule is gone from the sheet");
    assert.ok(variants.length >= 8, `only ${variants.length} seg variant classes found: ${variants}`);
  });

  it("every variant that sizes a segment is declared before the house rule", () => {
    const offenders: string[] = [];
    let sizersSeen = 0;
    for (const rule of all) {
      const owns = variants.some((variant) =>
        new RegExp(`\\.${variant.replace(/[-_]/g, "[-_]")}(\\b|[\\s.:,>+~])`).test(rule.selector));
      if (!owns || metrics(rule.body).length === 0) continue;
      sizersSeen += 1;
      const at = css.indexOf(`${rule.selector} {`);
      if (at === -1 || at < houseRule) continue;
      offenders.push(`${rule.where} — ${rule.selector} declares ${metrics(rule.body).join(", ")}`);
    }
    assert.deepEqual(
      offenders,
      [],
      "a seg variant now sizes itself AFTER the house rule, so one tab's switcher has "
        + "forked from the other seven again:\n  " + offenders.join("\n  "),
    );
    // The three named above are real and still in the sheet. If they were
    // deleted this check would go quiet, and a quiet check that was never
    // going to fire is the one this codebase keeps catching.
    assert.ok(
      sizersSeen >= 3,
      `only ${sizersSeen} variant rules carry a metric — 07 and 08 declared three when this `
        + "was written. If they were cleaned up, delete this suite rather than leaving it green",
    );
  });
});

describe("the call sites agree with the sheet", () => {
  const files = sourceFiles(join(root, "components"));

  it("the seg is still rendered widely enough for one size to matter", () => {
    const callers = files.filter((file) => /className="seg\b|className=\{"seg\b/.test(readFileSync(file, "utf8")));
    assert.ok(
      callers.length >= 18,
      `only ${callers.length} components render a .seg — if the control has been retired, `
        + "retire this suite with it rather than leaving it green over nothing",
    );
  });

  it("no component sizes a segment from the outside", () => {
    // The sheet is the one place the size lives. An inline style or a Tailwind
    // literal on a seg button would be a fifth size again, and neither
    // `type-scale.test.ts` nor the rules above would see it as a seg rule.
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (!/\bseg\b/.test(line)) return;
        if (/style=\{\{[^}]*(fontSize|padding|minHeight|fontWeight)/.test(line)) {
          offenders.push(`${file.slice(root.length)}:${index + 1} — ${line.trim().slice(0, 80)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `a seg sized outside the sheet:\n  ${offenders.join("\n  ")}`);
  });
});
