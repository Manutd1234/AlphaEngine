/**
 * Three controls are called "subtabs", and none of them may change size.
 *
 * "standardize the front, dont increase in size as we select the subtabs, it
 * must be standardized." Reported twice. The first pass read "subtabs" as the
 * segmented pane switcher and fixed it there — `.seg button + button` seamed
 * every segment but the first, so the raised chip was a pixel narrower when
 * segment one was pressed, which `seg-metrics.test.ts` holds. The report came
 * back, because a reader here can mean any of three things by the word:
 *
 *   1. `.workspace-tabs`     the eight role tabs in the header
 *   2. `.workspace-subtabs`  the section rail under the page head
 *   3. `.seg`                the in-panel pane switcher
 *
 * Two defects were behind the second report, and neither was a state rule.
 * The rail was sized in FOUR partials at once — 06 (34px over an 8px/13px
 * inset), 07 (8px/6px below 620px), 12 (a `calc(var(--chrome-rail) - 2px)`
 * floor over 8px/12px) and 15 (34px, 5px/9px, which is what the browser
 * applies). Three lost silently on specificity, in files whose comments
 * described them as live: nothing was wrong on screen at any one instant, and
 * no reader could tell which number was the real one. The label's rung has now
 * moved twice, and is back at --fs-body because the reader asked for 14px.
 *
 * So, for all three, read against the concatenated cascade rather than one
 * partial (a rule appended to a later file is how four sizes accumulated): no
 * metric may follow selection, hover, focus or a variant class; each box is
 * declared in ONE place, with the fingertip floor paid once for all of them;
 * and the type reads the ladder, never a literal. `seg-metrics.test.ts` is the
 * deeper suite on `.seg`, not duplicated here.
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
  /** The at-rules this sits inside, outermost first. */
  readonly context: readonly string[];
  readonly selector: string;
  readonly body: string;
  /** `app/globals/15-navigator-and-trailing-layer.css:62`. */
  readonly where: string;
}

/**
 * Every declaration block, with the at-rules it is nested in. Hand-walked for
 * the reason `seg-metrics.test.ts` gives: `@media` blocks nest, and a regex
 * stopping at the first `}` reads a media query's first rule as the whole
 * block — the failure this file exists to catch.
 */
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

/**
 * Properties that decide how much space the control's own box occupies.
 * `border-radius` and every `*-color` are deliberately absent: a corner and a
 * hue cost nothing. `border` and `border-left` are in, because a border on one
 * tab and not on another is a width — the mechanism behind the photographed
 * seg defect, and why every rail tab reserves its neighbours' divider.
 */
function isBoxMetric(property: string): boolean {
  if (/^(min-height|max-height|height|line-height|font|font-size|font-weight|font-stretch|letter-spacing|word-spacing|text-transform)$/.test(property)) return true;
  if (/^padding(-(top|right|bottom|left|inline|block)(-(start|end))?)?$/.test(property)) return true;
  return /^border(-(top|right|bottom|left|inline|block)(-(start|end))?)?(-width)?$/.test(property);
}

/** Everything above, plus anything else that moves a box or its neighbours. */
function isReflow(property: string): boolean {
  return isBoxMetric(property)
    || /^(width|min-width|max-width|margin(-[a-z]+)?|gap|row-gap|column-gap|flex(-[a-z]+)?|inset(-[a-z]+)?|top|right|bottom|left|transform|position|display|order|writing-mode)$/.test(property);
}

/** The properties a rule declares. */
const declared = (body: string) =>
  [...body.matchAll(/(?:^|;\s*)([a-z-]+)\s*:/g)].map((match) => match[1]);
const boxMetrics = (body: string) => declared(body).filter(isBoxMetric);
const reflowMetrics = (body: string) => declared(body).filter(isReflow);

/** Which control a single selector belongs to, or null for anything else. */
function control(selector: string): string | null {
  if (/:not\([^)]*\.seg/.test(selector)) return null;
  if (/(^|[\s,>+~(])\.seg\b|\.seg--|-seg\b/.test(selector)) return "seg";
  if (/\.workspace-subtabs__picker/.test(selector)) return null;
  if (/\.workspace-subtabs__actions/.test(selector)) {
    return /\bbutton\b|\.rail-toggle/.test(selector) ? "rail-action" : "rail-actions-group";
  }
  if (/\.workspace-subtabs/.test(selector)) {
    return /\bbutton\b|\bstrong\b/.test(selector) ? "rail-tab" : "rail";
  }
  if (/\.workspace-tabs/.test(selector)) {
    return /\bbutton\b|\bspan\b/.test(selector) ? "role-tab" : "role-tabs";
  }
  return null;
}

/** Every rule touching any of the three controls, tagged with which. */
const chrome = all.flatMap((rule) => {
  const parts = rule.selector.split(",").map((part) => part.trim());
  const names = new Set(parts.map(control).filter((name): name is string => name !== null));
  return names.size === 0 ? [] : [{ rule, controls: names }];
});

const of = (name: string) => chrome.filter((entry) => entry.controls.has(name));
/** Desk width: outside every media block, where the one definition must live. */
const desk = (name: string) => of(name).filter((entry) => entry.rule.context.length === 0);
const coarse = (entry: { rule: Rule }) => entry.rule.context.some((at) => at.includes("pointer: coarse"));

/** Selectors keyed on how the reader is interacting with the control. */
const STATEFUL = /\[aria-selected|\[aria-pressed|\[aria-current|\[data-active|:hover|:focus|:active|:checked|\.is-active\b/;

describe("the parser reads the whole cascade", () => {
  // A walker that quietly returned nothing would make everything below
  // vacuously true — the shape of dead test this codebase keeps catching.
  it("finds all three controls, inside media blocks and out", () => {
    assert.ok(all.length > 2000, `only ${all.length} rules parsed — the walker lost the sheet`);
    for (const name of ["role-tab", "rail", "rail-tab", "rail-action", "seg"]) {
      assert.ok(of(name).length > 0, `no rules found for ${name}`);
    }
    assert.ok(
      chrome.some((entry) => coarse(entry)),
      "the coarse-pointer block was not found — the fingertip floor is unchecked",
    );
    const stateful = new Set(chrome
      .filter((entry) => STATEFUL.test(entry.rule.selector))
      .flatMap((entry) => [...entry.controls]));
    for (const name of ["role-tab", "rail-tab", "seg"]) {
      assert.ok(stateful.has(name), `${name} has no state rule at all — selection has moved`);
    }
  });
});

describe("selection changes paint, never metrics", () => {
  const stateful = chrome.filter((entry) => STATEFUL.test(entry.rule.selector));

  it("no state rule declares a property that moves a box", () => {
    // The report, stated as a rule. A heavier selected label, a wider inset, a
    // thicker border, a taller floor or a margin on hover all do the same
    // thing: the row resizes as the reader clicks along it, and on a sticky
    // rail the whole page below shifts with it.
    const offenders = stateful
      .map((entry) => ({ entry, found: reflowMetrics(entry.rule.body) }))
      .filter((entry) => entry.found.length > 0)
      .map(({ entry, found }) => `${entry.rule.where} — ${entry.rule.selector} declares ${found.join(", ")}`);
    assert.deepEqual(
      offenders,
      [],
      "a selected tab must occupy exactly the space an unselected one does:\n  "
        + offenders.join("\n  "),
    );
  });

  it("a variant class does not resize a tab either", () => {
    // `.is-secondary` added `padding-left: 9px` and a `border-left` over a base
    // rule already declaring 9px and a 1px transparent border. The numbers
    // matched, so the row was even by coincidence; the next edit to the base
    // inset would have made one tab in it a different width.
    const secondary = chrome.filter((entry) => /\.is-secondary/.test(entry.rule.selector));
    assert.ok(secondary.length > 0, ".is-secondary has left the sheet — drop this check with it");
    for (const entry of secondary) {
      assert.deepEqual(
        reflowMetrics(entry.rule.body),
        [],
        `${entry.rule.where} — a quieter tab must be a quieter tab, not a different-sized one`,
      );
    }
  });

  it("selection is still said by something that is not colour", () => {
    // Restated beside the metric ban so one cannot be satisfied by breaking
    // the other: take the size change away, and hue alone may not replace it.
    const railSelected = of("rail-tab")
      .filter((entry) => /\[aria-selected="true"\]/.test(entry.rule.selector))
      .pop();
    assert.ok(railSelected, "the rail's selected rule is gone");
    assert.match(
      railSelected!.rule.body,
      /box-shadow: inset 0 -2px 0/,
      "the rail's 2px rule is the carrier that is not colour, and it is drawn INSIDE the box",
    );
    const tabUnderline = of("role-tab").find((entry) => /::after/.test(entry.rule.selector)
      && /\[aria-selected="true"\]/.test(entry.rule.selector));
    assert.ok(tabUnderline, "the role tabs' underline no longer follows the selected tab");
    // And the markup carries it for assistive tech whatever the sheet paints.
    assert.match(read("components/WorkspaceSubtabs.tsx"), /aria-selected=\{selected\}/);
    assert.match(read("components/WorkspaceHeader.tsx"), /aria-selected=\{view === item\.id\}/);
  });
});

describe("one set of metrics per control, in one place", () => {
  /**
   * Where each control's box may be declared. The rail is the point of the
   * list: four partials declared it and the reader could not tell which one
   * shipped. The role tabs keep theirs in the shell (01) plus the header's
   * measured width ladder in 14, which `header-ladder.test.ts` pins; `.seg`
   * keeps the arrangement `seg-metrics.test.ts` already holds.
   */
  const HOME: Record<string, RegExp> = {
    "role-tabs": /01-workspace-shell|12-workspace-standardisation|14-symbol-combobox/,
    "role-tab": /01-workspace-shell|14-symbol-combobox/,
    rail: /15-navigator-and-trailing-layer/,
    "rail-tab": /15-navigator-and-trailing-layer/,
    "rail-actions-group": /12-workspace-standardisation|15-navigator-and-trailing-layer/,
    "rail-action": /12-workspace-standardisation/,
    seg: /00-tokens-and-base|12-workspace-standardisation/,
  };

  /**
   * The one rule left somewhere else, and why. `07-data-operations.css`
   * re-insets the rail's tabs below 620px for a grid that no longer exists —
   * 15 hides the rail-shell at that width for the native picker, and the rule
   * is (0,1,1) against 15's (0,2,1) in any case, so it has never applied to
   * anything. Named rather than deleted because 07 is outside this pass;
   * naming it is what stops a fifth home opening quietly beside it.
   */
  const KNOWN_ELSEWHERE = ["app/globals/07-data-operations.css"];

  it("no partial outside the list sizes one of these controls", () => {
    const offenders: string[] = [];
    for (const entry of chrome) {
      const found = boxMetrics(entry.rule.body);
      if (found.length === 0) continue;
      // The fingertip floor is one rule for every control at once, in 15's
      // coarse block. Splitting it per control is how a touch target goes
      // missing on one tab and nobody notices.
      if (coarse(entry)) continue;
      for (const name of entry.controls) {
        const home = HOME[name];
        if (!home || home.test(entry.rule.where)) continue;
        if (KNOWN_ELSEWHERE.some((file) => entry.rule.where.startsWith(file))) continue;
        offenders.push(`${entry.rule.where} — ${entry.rule.selector} declares ${found.join(", ")} for ${name}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a second home for a metric has opened; converge it where the control lives:\n  "
        + offenders.join("\n  "),
    );
  });

  it("the dead override in 07 is still dead, and still the only one", () => {
    // Checked rather than merely allowed: if it leaves its media block it is
    // (0,1,1) against 15's (0,2,1) and a reader would take it for live.
    const foreign = chrome.filter((entry) =>
      boxMetrics(entry.rule.body).length > 0
      && KNOWN_ELSEWHERE.some((file) => entry.rule.where.startsWith(file)));
    assert.ok(foreign.length <= 1, `07 now carries ${foreign.length} rail metrics, not one`);
    for (const entry of foreign) {
      assert.ok(entry.rule.context.some((at) => at.includes("max-width")), entry.rule.where);
    }
  });

  it("each metric is declared exactly once at desk width", () => {
    // The four-partial split, stated as an arithmetic the next author cannot
    // argue with. Media blocks are excluded: a responsive override is a second
    // VALUE for a narrower screen, not a second definition of the control.
    const counted = (name: string, property: string) =>
      desk(name).filter((entry) => declared(entry.rule.body).includes(property));
    const once: [string, string][] = [
      ["rail", "min-height"], ["rail-tab", "min-height"], ["rail-tab", "padding"],
      ["rail-tab", "font-size"], ["rail-tab", "font-weight"], ["role-tab", "padding"],
      ["rail-action", "min-height"], ["rail-action", "padding"],
      ["rail-action", "font-size"], ["rail-actions-group", "padding"],
    ];
    for (const [name, property] of once) {
      const found = counted(name, property);
      assert.equal(
        found.length,
        1,
        `${name} declares ${property} ${found.length} times, and the cascade decides which:\n  `
          + found.map((entry) => `${entry.rule.where} — ${entry.rule.selector}`).join("\n  "),
      );
    }
    // The one font-size sits on the button, which owns the box; `strong`
    // carries weight and truncation. Two elements sizing one label is how the
    // rail ended up a rung above the navigation it is subordinate to.
    const label = desk("rail-tab").find((entry) => /\bstrong\b/.test(entry.rule.selector));
    assert.ok(label, "the rail's label rule is gone");
    assert.ok(
      !declared(label!.rule.body).includes("font-size"),
      `${label!.rule.where} — the label is sized by the button above it, not here`,
    );
  });
});

describe("the size is the smaller one, and it is on the ladder", () => {
  it("no control names a literal font size", () => {
    const offenders = chrome
      .flatMap((entry) => [...entry.rule.body.matchAll(/font-size:\s*([^;]+)/g)]
        .map((match) => ({ entry, value: match[1].trim() })))
      .filter(({ value }) => !value.startsWith("var(--fs-"))
      .map(({ entry, value }) => `${entry.rule.where} — ${entry.rule.selector}: ${value}`);
    assert.deepEqual(offenders, [], `off the type ladder:\n  ${offenders.join("\n  ")}`);
  });

  it("the section rail sits on the rung the reader asked for", () => {
    // Was --fs-sm, one rung under the role tabs' fixed 13px, on the reading of
    // "do not increase in size" that took it to mean the rail's own type. It
    // did not: "subtab headers can be bigger to 14px and bigger for comfortable
    // setting". subtab-chrome-stability.test.ts holds the three px it lands on.
    const railTab = desk("rail-tab").find((entry) => /font-size/.test(entry.rule.body));
    assert.ok(railTab, "the rail's tabs carry no size at all");
    assert.match(railTab!.rule.body, /font-size: var\(--fs-body\)/);
    assert.match(css, /\.workspace-tabs button span \{[^}]*font-size: var\(--fs-chrome-tab\)/);
  });

  it("the rail's tabs and its action controls stand on one line", () => {
    // Two halves of one row. They were 34px and 28px in the files, 34 and 34
    // after the cascade had finished with them — one of those numbers was a
    // fiction and it was not visible from either file.
    const floor = (name: string) =>
      desk(name).flatMap((entry) => [...entry.rule.body.matchAll(/min-height:\s*(\d+)px/g)]
        .map((match) => Number(match[1])));
    assert.deepEqual(floor("rail-tab"), [34]);
    assert.deepEqual(floor("rail-action"), [34]);
    // And the strip is no taller than a tab plus its baseline: a taller strip
    // detaches the active tab's 2px rule from the hairline it is meant to meet.
    const strip = desk("rail").find((entry) => /min-height/.test(entry.rule.body));
    assert.ok(strip, "the rail has no height");
    const height = Number(strip!.rule.body.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
    assert.ok(height > 0 && height <= 40, `the strip is ${height}px around a 34px tab`);
  });

  it("the fingertip floor is paid once, in one block, for every control", () => {
    const raised = chrome.filter((entry) => coarse(entry) && /min-height/.test(entry.rule.body));
    assert.ok(raised.length > 0, "nothing raises these controls for a fingertip");
    for (const entry of raised) {
      const height = Number(entry.rule.body.match(/min-height:\s*(\d+)px/)?.[1] ?? 0);
      // 40px inside the seg's own 3px frame and 1px border is 48px of control:
      // the documented exception, and it clears 44 by more than the rest do.
      const framed = entry.controls.has("seg") ? height + 3 * 2 + 1 * 2 : height;
      assert.ok(framed >= 44, `${entry.rule.where} reaches ${framed}px at the fingertip`);
    }
  });
});

describe("no component sizes this chrome from the outside", () => {
  it("the rail and the header tabs are sized by the sheet alone", () => {
    // An inline style on a tab would be a fifth home the rules above cannot
    // see, and the sheet is meant to be the one authority.
    const offenders: string[] = [];
    for (const file of ["components/WorkspaceSubtabs.tsx", "components/WorkspaceHeader.tsx"]) {
      read(file).split("\n").forEach((line, index) => {
        if (/style=\{\{[^}]*(fontSize|padding|minHeight|fontWeight|height)/.test(line)) {
          offenders.push(`${file}:${index + 1} — ${line.trim().slice(0, 80)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `chrome sized outside the sheet:\n  ${offenders.join("\n  ")}`);
    // And the markup the rules above are written against is still the markup.
    const source = read("components/WorkspaceSubtabs.tsx");
    assert.match(source, /className=\{isSecondary \? "is-secondary" : undefined\}/);
    assert.match(source, /<strong>\{tab\.label\}<\/strong>/);
  });
});
