/**
 * The section rail's geometry does not depend on which tab is selected.
 *
 * Reported three times, in the reader's words: "dont increase in size as we
 * select the subtabs, it must be standardized", "fix all the subtabs to have
 * the same size", and then "can we standardize the font size for the
 * subheading and dont change as we switch subtabs like why is it enlarging?"
 *
 * Twice it was answered by converging padding and heights, and twice it came
 * back, because a box is not the only thing that can measure differently under
 * selection. The mechanism is TYPE: 650 against 750 is not a colour, it is a
 * wider glyph on every letter of the label, so the selected tab grows, shoves
 * its neighbours along the track, and switching tabs moves the whole row
 * again. `tab-chrome-metrics.test.ts` bans a metric inside a rule keyed on
 * `[aria-selected]`; this file states the property the rail actually needs,
 * which is stronger and survives a rule the tagging there does not reach:
 *
 *   a tab's width is a function of its LABEL and its TRACK, and of nothing
 *   else — not selection, not hover, not focus, not a bare-element rule that
 *   never names the rail at all.
 *
 * That is why the weight is one number for every tab rather than a bold
 * selected label over a hidden bold twin: with a single weight there is no
 * width to reserve, and the reserve cannot rot. The three carriers selection
 * keeps — the accent wash, the contrast step, and the 2px rule drawn inside
 * the box — are held below, so taking the size change away cannot be paid for
 * in colour alone.
 *
 * It also pins the rung, which the same reader asked to raise: "subtab headers
 * can be bigger to 14px and bigger for comfortable setting". --fs-body, and
 * the three Text sizes it resolves to, are asserted as px here.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, locateInGlobals } from "./globals-css";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const css = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

interface Rule {
  readonly context: readonly string[];
  readonly selector: string;
  readonly body: string;
  readonly where: string;
}

/** Every block with the at-rules around it; nested `@media` walked, not regexed. */
function rules(text: string): Rule[] {
  const out: Rule[] = [];
  const context: string[] = [];
  let cursor = 0;
  let start = 0;
  while (cursor < text.length) {
    const character = text[cursor];
    if (character !== "{" && character !== "}") { cursor += 1; continue; }
    if (character === "}") { context.pop(); cursor += 1; start = cursor; continue; }
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
  }
  return out;
}

const all = rules(css);
const declared = (body: string) =>
  [...body.matchAll(/(?:^|;\s*)([a-z-]+)\s*:/g)].map((match) => match[1]);
const value = (body: string, property: string) =>
  body.match(new RegExp(`(?:^|;\\s*)${property}\\s*:\\s*([^;]+)`))?.[1].trim() ?? null;

/**
 * Does this compound reach a tab on the section rail?
 *
 * Two ways, and the second is the one `tab-chrome-metrics.test.ts` cannot see.
 * A rule naming the rail is obvious. A rule naming no class at all — `button`,
 * `button:active:not(:disabled)`, `:where(button, a, [role="tab"]):focus-visible`
 * — reaches every tab on the rail just as surely, from a partial that has
 * never heard of it, and a state-keyed metric hidden in one of those is
 * exactly the kind of rule that gets past a suite keyed on the rail's name.
 */
function reachesRailTab(part: string): boolean {
  if (/\.workspace-subtabs__(actions|picker|navigation|rail-shell)/.test(part)) return false;
  if (/\.workspace-subtabs/.test(part)) return /\bbutton\b|\bstrong\b/.test(part);
  if (/[.#]/.test(part)) return false;
  return /\bbutton\b|\[role="tab"\]/.test(part);
}

const railTab = all.filter((rule) =>
  rule.selector.split(",").some((part) => reachesRailTab(part.trim())));

/**
 * The subset that NAMES the rail. The base sheet's `button` rule sets every
 * button's size and weight and is overridden here by specificity, so counting
 * it as a second declaration of the rail's type would be a false alarm; a
 * STATE-keyed bare rule is a different matter and stays in `railTab` above,
 * because `button:hover:not(:disabled)` at (0,2,1) outranks
 * `.workspace-subtabs button strong` at (0,1,2) and would actually apply.
 */
const railNamed = railTab.filter((rule) => /\.workspace-subtabs/.test(rule.selector));

/** Selectors keyed on how the reader is interacting with the control. */
const STATEFUL = /\[aria-selected|\[aria-pressed|\[aria-current|\[data-active|:hover|:focus|:active|:checked|\.is-active\b/;

/**
 * Anything that changes how much room the tab or its label takes, or where its
 * neighbours therefore sit. `font-weight`, `letter-spacing` and `font-stretch`
 * are the point: none of them is a box property, and all three re-measure the
 * text inside one.
 */
const GEOMETRY = /^(font|font-size|font-weight|font-stretch|font-family|letter-spacing|word-spacing|text-transform|line-height|width|min-width|max-width|height|min-height|max-height|display|position|order|zoom|gap|row-gap|column-gap|top|right|bottom|left)$/;
/** A radius and a hue cost nothing; a border WIDTH is a width, on one tab and
 *  not its neighbour, which is how the seg defect was photographed. */
const movesABox = (property: string) =>
  GEOMETRY.test(property)
  || /^(padding|margin|flex|inset)(-[a-z]+)*$/.test(property)
  || /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?$/.test(property);

describe("the parser reads the rail out of the whole cascade", () => {
  it("finds the rail's tabs, its states, and the bare-element rules over them", () => {
    assert.ok(all.length > 2000, `only ${all.length} rules parsed — the walker lost the sheet`);
    assert.ok(railTab.length > 4, `only ${railTab.length} rules reach a rail tab`);
    assert.ok(
      railTab.some((rule) => /\[aria-selected="true"\]/.test(rule.selector)),
      "no selected rule for the rail — selection has moved somewhere this file cannot see",
    );
    assert.ok(
      railTab.some((rule) => !/[.#]/.test(rule.selector)),
      "no bare-element rule reaches the rail; the second half of this suite is checking nothing",
    );
  });
});

describe("a tab's width is its label and its track, and nothing else", () => {
  const stateful = railTab.filter((rule) => STATEFUL.test(rule.selector));

  it("no state a reader can put a tab into changes its measurements", () => {
    const offenders = stateful
      .map((rule) => ({ rule, found: declared(rule.body).filter(movesABox) }))
      .filter((entry) => entry.found.length > 0)
      .map(({ rule, found }) => `${rule.where} — ${rule.selector} declares ${found.join(", ")}`);
    assert.deepEqual(
      offenders,
      [],
      "selection, hover and focus paint a tab; they may not measure it:\n  "
        + offenders.join("\n  "),
    );
  });

  it("the one weight is the same number wherever it is written", () => {
    // The reserve, stated as arithmetic. 650 everywhere means there is no
    // bold width to reserve; two numbers here is the reported enlargement,
    // whatever selector the second one arrives on.
    const weights = new Set(railNamed
      .map((rule) => value(rule.body, "font-weight"))
      .filter((weight): weight is string => weight !== null));
    assert.equal(
      weights.size,
      1,
      `the rail's label is written at ${[...weights].join(" and ")}; a heavier glyph is a wider one`,
    );
  });

  it("the only thing a press moves is the tab's own paint", () => {
    // `button:active { transform: translateY(1px) }` reaches the rail from the
    // base sheet. It is kept: a transform is composited, so the tab dips
    // without re-laying-out the row. Held to exactly that, because the same
    // selector carrying a scale or a margin would move the neighbours.
    const moved = railTab.filter((rule) => /(?:^|;\s*)transform\s*:/.test(rule.body));
    for (const rule of moved) {
      assert.match(
        value(rule.body, "transform") ?? "",
        /^translateY\(1px\)$/,
        `${rule.where} — ${rule.selector} moves a tab by something other than the 1px press dip`,
      );
    }
  });
});

describe("the two width bands are both label-and-track", () => {
  const deskTab = railNamed.find((rule) =>
    rule.context.length === 0 && /flex:/.test(rule.body) && /\bbutton\b/.test(rule.selector));
  const narrowTab = railNamed.find((rule) =>
    rule.context.some((at) => at.includes("820px")) && /flex:/.test(rule.body));

  it("at desk width every tab is the same width, whatever it says", () => {
    // `flex: 1 1 0` divides the track evenly: the reserve at this band is that
    // the label has no vote at all. A basis of `auto` would hand the width
    // back to the text and put the whole defect one property away.
    assert.ok(deskTab, "the rail's tabs no longer declare a flex at desk width");
    assert.match(deskTab!.body, /flex: 1 1 0/);
  });

  it("below 820px the tabs size to their labels and the track scrolls", () => {
    // The other band, and the one where a weight change would have shoved:
    // `max-content` IS the label's width. It is safe only because the weight
    // above is constant, which is why the two assertions live in one file.
    assert.ok(narrowTab, "the ≤820px band no longer sizes the rail's tabs");
    assert.match(narrowTab!.body, /flex: 1 0 max-content/);
    assert.match(narrowTab!.body, /min-width: \d+px/);
    const scroller = all.find((rule) =>
      rule.context.some((at) => at.includes("820px"))
      && /workspace-subtabs__rail\[data-scroll-affordance/.test(rule.selector));
    assert.ok(scroller, "the ≤820px rail rule is gone");
    assert.match(
      scroller!.body,
      /overflow-x: auto/,
      "content-sized tabs overflow, so this band must scroll rather than clip",
    );
  });

  it("at desk width a label too long for its share truncates rather than pushes", () => {
    // Research supplies nine sections and "Fitted models" is the longest of
    // them; at large it does not fit an even ninth of a laptop track. The
    // degradation is an ellipsis inside a fixed box, so the row's geometry is
    // the same at every Text size — the property this whole file is about.
    const box = railNamed.find((rule) => rule.context.length === 0 && /overflow: hidden/.test(rule.body));
    assert.ok(box, "the rail's tabs no longer clip their own labels");
    assert.match(box!.body, /text-overflow: ellipsis/);
    assert.match(box!.body, /white-space: nowrap/);
    const label = railNamed.find((rule) => /\bstrong\b/.test(rule.selector));
    assert.ok(label, "the rail's label rule is gone");
    assert.match(
      label!.body,
      /min-width: 0/,
      "without this the label refuses to shrink and the row overflows instead of truncating",
    );
  });
});

const tokens = read("app/globals/00-tokens-and-base.css");

describe("the rung the reader asked for, in px", () => {
  const step = (attribute: string) => {
    const block = tokens.match(
      new RegExp(`\\[data-text-size="${attribute}"\\]\\s*\\{[\\s\\S]*?--type-step:\\s*([\\d.]+)`));
    return Number(block?.[1]);
  };
  /** 16px, because `html { font-size: 100% }` — asserted, not assumed. */
  const rem = 16;

  it("--fs-body lands on 12, 14 and 17px across the three Text sizes", () => {
    assert.match(tokens, /html \{\s*font-size: 100%/);
    const multiplier = Number(tokens.match(/--fs-body:\s*calc\(([\d.]+)rem/)?.[1]);
    assert.ok(multiplier > 0, "--fs-body is no longer a rem multiple of --type-step");
    const px = (typeStep: number) => Math.round(rem * multiplier * typeStep * 100) / 100;
    assert.equal(px(step("compact")), 12);
    assert.equal(px(1), 14);
    assert.equal(px(step("large")), 17);
  });

  it("the rail's tabs read that rung, from the box that owns their metrics", () => {
    const sized = railNamed.filter((rule) =>
      rule.context.length === 0 && /(?:^|;\s*)font-size\s*:/.test(rule.body));
    assert.equal(
      sized.length,
      1,
      `${sized.length} rules size a rail tab at desk width:\n  `
        + sized.map((rule) => `${rule.where} — ${rule.selector}`).join("\n  "),
    );
    assert.equal(value(sized[0].body, "font-size"), "var(--fs-body)");
    assert.match(sized[0].selector, /\bbutton\b/);
    assert.ok(
      !/\bstrong\b/.test(sized[0].selector),
      "the label is sized by the button that owns the box, not by the text inside it",
    );
  });

  it("the raise does not move the rail the rest of the page is offset by", () => {
    // --rail-h feeds every sticky offset and scroll-margin on the desk. The
    // tallest tab is the large step: 17px × --lh-body plus the inset, and it
    // has to stay inside the strip's own floor or every deep link lands wrong.
    const lineHeight = Number(tokens.match(/--lh-body:\s*([\d.]+)/)?.[1]);
    const box = railNamed.find((rule) => rule.context.length === 0 && /padding:/.test(rule.body));
    assert.ok(box, "the rail's tabs carry no inset");
    const inset = Number(value(box!.body, "padding")?.match(/(\d+)px/)?.[1]);
    // The strip, not the sticky rule of the same name in 12: one of the two
    // declares the height, and reading the wrong one measures nothing.
    const strip = all.find((rule) => rule.context.length === 0
      && rule.selector === ".workspace-subtabs" && /min-height:/.test(rule.body));
    assert.ok(strip, "the strip declares no height");
    const stripFloor = Number(value(strip!.body, "min-height")?.match(/(\d+)/)?.[1]);
    const tallest = 17 * lineHeight + inset * 2;
    assert.ok(stripFloor >= tallest, `a large-text tab stands ${tallest}px in a ${stripFloor}px strip`);
  });
});

describe("selection is still visible, and not by colour", () => {
  const selected = railTab.filter((rule) => /\[aria-selected="true"\]/.test(rule.selector)).pop();

  it("the 2px rule under the active tab survived the fix", () => {
    assert.ok(selected, "the rail's selected rule is gone");
    assert.match(
      selected!.body,
      /box-shadow: inset 0 -2px 0/,
      "an inset rule, so the ≤820px scroll container cannot clip it",
    );
    const paint = declared(selected!.body).filter((property) => movesABox(property));
    assert.deepEqual(paint, [], "the selected rule may only paint");
  });

  it("the markup says it too, and says it the same way for every tab", () => {
    // A tab that renders an extra child when selected is the same defect in
    // TSX: the row re-measures on every switch and no stylesheet rule shows it.
    const source = read("components/WorkspaceSubtabs.tsx");
    const button = source.match(/<button[\s\S]*?<\/button>/);
    assert.ok(button, "the rail's tab markup has changed shape");
    const conditionals = button![0].split("\n")
      .filter((line) => /\bselected\b/.test(line))
      .filter((line) => !/aria-selected|aria-current|tabIndex/.test(line));
    assert.deepEqual(
      conditionals,
      [],
      `a selected tab renders something an unselected one does not:\n  ${conditionals.join("\n  ")}`,
    );
    assert.equal((button![0].match(/<strong>/g) ?? []).length, 1);
    assert.match(button![0], /aria-selected=\{selected\}/);
    assert.match(button![0], /aria-current=\{selected \? "page" : undefined\}/);
  });
});





/**
 * THE HOLE THIS FILE HAD, and the fourth report. Everything above measures a
 * TAB, and `reachesRailTab` returns false for `.workspace-subtabs__actions` by
 * design — but the rail is a two-column grid and a grid row is as tall as its
 * TALLEST child, so the half excluded from both suites was the half deciding
 * the strip's height. Measured in Chrome at 1512px: Research, Portfolio and
 * Risk carry actions and stood 41px against the other five at 40px, so
 * `--rail-h` published two numbers to every sticky offset on the desk. A 40px
 * strip over a 1px hairline is a 39px row, and 34px controls under
 * `padding: 3px 0` measure 40 — no state rule, which is why
 * `tab-chrome-metrics.test.ts` could not have caught it.
 */
describe("the rail is the height it declares, whatever it is carrying", () => {
  const of = (selector: RegExp, property: RegExp) => all.find((rule) =>
    rule.context.length === 0 && selector.test(rule.selector) && property.test(rule.body));
  const strip = of(/^\.workspace-subtabs$/, /min-height:/);
  const actions = of(/^\.workspace-subtabs__actions$/, /padding:/);
  const controls = of(/\.workspace-subtabs__actions/, /min-height:/);

  it("what the rail carries fits inside the height the rail declares", () => {
    // Fails against the shipped sheet: 34 + 3 + 3 = 40 in a 39px row.
    // REJECTED as the fix: raising the floor to 41px, which levels the eight
    // rails by growing all of them. A whitespace split reads the shorthand —
    // `var(--space-2)` carries no inner space.
    assert.ok(strip && actions && controls, "the strip or one of its halves is gone");
    const floor = Number(value(strip!.body, "min-height")?.match(/(\d+)/)?.[1]);
    const hairline = Number(value(strip!.body, "border-bottom")?.match(/(\d+)px/)?.[1] ?? 0);
    const written = (value(actions!.body, "padding") ?? "").trim().split(/\s+/);
    const px = (side: string) => Number(side?.match(/^(\d+(?:\.\d+)?)(?:px|(?<=^0))$/)?.[1] ?? NaN);
    const block = px(written[0]) + px(written[2] ?? written[0]);
    const control = Number(value(controls!.body, "min-height")?.match(/(\d+)/)?.[1]);
    assert.ok(Number.isFinite(block), "the group's block padding is no longer a px pair");
    assert.ok(control + block <= floor - hairline,
      `the action group measures ${control + block}px in a ${floor - hairline}px row, so a rail `
        + "carrying actions stands taller than one that does not, and --rail-h publishes two "
        + "different numbers to the desk's sticky offsets");
  });

  it("both halves of the rail stand on one floor", () => {
    // The claim the sheet's comment already made — "the same 34px the tabs
    // themselves stand at, so the two halves share one line" — asserted by
    // nothing, and broken by the padding that lifted the controls off it.
    const tabFloor = railNamed.find((r) => r.context.length === 0
      && /\bbutton\b/.test(r.selector) && /min-height:/.test(r.body));
    assert.ok(tabFloor && controls, "the rail's tabs declare no floor");
    assert.equal(value(controls!.body, "min-height"), value(tabFloor!.body, "min-height"),
      "the tabs and the controls beside them are two heights");
  });
});
