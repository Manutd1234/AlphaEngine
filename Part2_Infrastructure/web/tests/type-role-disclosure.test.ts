/**
 * THE DISCLOSURE ROLES — two rungs the role map had no room to carry.
 *
 * "for the words hidden, can you make it smaller, similar to the attachment"
 * "make sure that we have consistent font sizes and there is a segregation
 *  between different types of text and which sections use which sizes"
 *
 * WHAT WAS ACTUALLY WRONG, and it was not a size somebody picked badly.
 * ------------------------------------------------------------------------
 * `.console-card summary` has read --fs-body (14px) since it was written. The
 * BODY under it had no rung at all: `> p` was styled for padding only, so the
 * text inherited `body` — which on this desk reads --fs-title (17px), the
 * CARD-TITLE rung, a divergence recorded at length in `type-role-map.test.ts`
 * under "body prose" and deliberately not fixed there.
 *
 * The consequence is the one the reader photographed: **detail that had been
 * folded away came back three points LARGER than the question that hid it.**
 * A disclosure is the quietest thing on a card and it was setting the loudest
 * type on it. Nothing looked wrong in any single rule, which is why it survived
 * every sweep — the defect only exists in the relationship between two rules,
 * and until this file there was nowhere that relationship was written down.
 *
 * WHY A SEPARATE FILE
 * ------------------------------------------------------------------------
 * `type-role-map.test.ts` is the map and would be the right home. It sits at
 * 399 lines against a 400-line ceiling that is a one-way ratchet, so a role
 * cannot be added to it without shaving prose that is load-bearing. The
 * precedent is `type-diagram-ladder.test.ts`, split off the foot of that same
 * file on 2026-08-23 for exactly this reason. Two roles, same idiom, same
 * anchors-not-selectors scoping: a role cannot be detected from a selector, so
 * each names the rules that ARE it.
 *
 * WHAT NO TEST HERE CAN DO. `npm test` is plain Node with no jsdom, no browser
 * and no layout engine, and no new dependency may be added, so every number
 * below is read out of the sheet and multiplied — never observed. That 13px is
 * a comfortable size for folded prose, and that the pair reads as one voice
 * rather than two, are outside what a string comparison can reach.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules, declaredRung, selectorList } from "./globals-rules";

/** Comment bodies blanked, newlines kept, so prose is never read as a rule. */
const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) =>
  block.replace(/[^\n]/g, " "));

const rules = cssRules(declarations, locateInGlobals);

/** The bare token behind a declaration: `var(--fs-sm)` → `--fs-sm`. */
const token = (declaration: string) => declaration.replace(/^var\(|\)$/g, "");

/** The winning `font-size` for a selector: the LAST context-free rule naming it. */
function shipped(selector: string): { rung: string; where: string } | null {
  let found: { rung: string; where: string } | null = null;
  for (const rule of rules) {
    if (rule.context.length) continue;
    if (!selectorList(rule.selector).includes(selector)) continue;
    const rung = declaredRung(rule.body);
    if (rung) found = { rung, where: rule.where };
  }
  return found;
}

/**
 * The ladder, in px at the default preset, read out of the tokens partial.
 *
 * Derived from the sheet rather than hard-coded: a comparison against numbers
 * typed into a test would keep passing after somebody re-tuned the ladder,
 * which is the failure mode this whole family of suites exists to prevent.
 */
function ladderPx(): Map<string, number> {
  const out = new Map<string, number>();
  for (const match of declarations.matchAll(
    /--(fs-[a-z0-9-]+):\s*calc\(([\d.]+)rem \* var\(--type-step\)\)/g)) {
    out.set(`--${match[1]}`, Number(match[2]) * 16);
  }
  for (const match of declarations.matchAll(/--(fs-[a-z0-9-]+):\s*(\d+)px/g)) {
    out.set(`--${match[1]}`, Number(match[2]));
  }
  return out;
}

interface Role {
  readonly rung: string;
  readonly why: string;
  readonly anchors: readonly string[];
}

const ROLES: Record<string, Role> = {
  "disclosure summary": {
    rung: "--fs-body",
    why: "The question a fold asks. It is a control — clickable, focusable, with a "
      + "marker — but it is read as a sentence, so it takes the prose rung named for "
      + "the job rather than the --fs-xl the control family reads. Unchanged by this "
      + "pass: it was already right, and the body under it was what disagreed.",
    anchors: [".console-card summary"],
  },
  "disclosure body": {
    rung: "--fs-sm",
    why: "The answer a fold hides. ONE rung under its summary, not two: the pair is a "
      + "question and its answer and must read as one voice, which is the difference "
      + "between a disclosure and a card. Set on `details.disclosure` rather than on "
      + "`> p`, because half these bodies are a <dl>, a <ul> or a <div> — a `> p` rung "
      + "sizes the ones that happen to be prose and leaves the rest inheriting the "
      + "17px card-title rung that `body` carries.",
    anchors: [".console-card details.disclosure"],
  },
};

describe("the disclosure roles have one declared size each", () => {
  for (const [role, spec] of Object.entries(ROLES)) {
    it(`${role} reads ${spec.rung}`, () => {
      for (const anchor of spec.anchors) {
        const found = shipped(anchor);
        assert.ok(found, `${anchor} declares no font-size, so ${role} has no rung`);
        assert.equal(token(found.rung), spec.rung,
          `${anchor} at ${found.where} reads ${found.rung}; ${role} is ${spec.rung} because ${spec.why}`);
      }
    });
  }

  it("every anchor names a rule that exists", () => {
    // Guards the reader, not the sheet: an anchor that matched nothing would
    // make its role pass while saying nothing about the desk.
    for (const spec of Object.values(ROLES)) {
      for (const anchor of spec.anchors) {
        assert.ok(rules.some((rule) => selectorList(rule.selector).includes(anchor)),
          `no rule anywhere in globals names ${anchor}`);
      }
    }
  });
});

describe("one rung for the role, across every partial", () => {
  /**
   * Selectors naming the `<summary>` ELEMENT. A class that merely contains the
   * word — `.reliability-dependency-summary`, `.codebase-filelist__summary`,
   * `.coh-lesson__summary`, `.codex-card__summary` — is a different role
   * wearing a similar name, and matching on the substring would drag four of
   * them in and make the rule unmaintainable.
   */
  const ELEMENT = /(^|[\s>,(])summary\b/;

  const summaryRules = rules.filter((rule) =>
    ELEMENT.test(rule.selector) && declaredRung(rule.body) !== null);

  it("finds the summary rules it is meant to be checking", () => {
    assert.ok(summaryRules.length >= 6,
      `only ${summaryRules.length} sized <summary> rules found; the matcher is not reading the sheet`);
  });

  it("no partial declares a second size for a disclosure summary", () => {
    // WHAT THIS CAUGHT, and none of it was visible in any single file: FIVE
    // sizes for one role. --fs-xs in `13-warm-bright-pass`, `10a`, `10e` and
    // `10h`; --fs-body in `02`, `03`, `06`; --fs-lg in `07`; --fs-title in a
    // block of `14q` since deleted. Worse than the spread was the cascade —
    // `13`'s `.disclosure > summary` and `02`'s `.console-card summary` have
    // EQUAL specificity, so the later partial won and every fold inside a
    // console card shipped a 12.75px question over a 13px answer. Inverted, and
    // both files looked correct on their own.
    const offenders = summaryRules
      .filter((rule) => declaredRung(rule.body) !== `var(${ROLES["disclosure summary"].rung})`)
      .map((rule) => `${rule.where}: ${rule.selector.slice(0, 60)} -> ${declaredRung(rule.body)}`);
    assert.deepEqual(offenders, [],
      `a disclosure summary has one rung on this desk:\n    ${offenders.join("\n    ")}`);
  });
});

describe("a fold is quieter than the card it sits on", () => {
  const px = ladderPx();

  it("the ladder was read, not assumed", () => {
    assert.ok(px.size > 10, `only ${px.size} rungs parsed out of the tokens partial`);
    for (const rung of ["--fs-sm", "--fs-body", "--fs-title"]) {
      assert.ok(px.has(rung), `${rung} is not on the ladder this test just read`);
    }
  });

  it("hidden words are smaller than the words around them", () => {
    // The reader's ask, as an invariant, measured against what ships. `body` is
    // the rung every unstyled paragraph on the desk inherits, so this is the
    // comparison that says whether folded detail is quieter than the prose it
    // was folded out of.
    const body = shipped("body");
    const fold = shipped(".console-card details.disclosure");
    assert.ok(body && fold, "body or the disclosure declares no font-size");
    const prose = px.get(token(body.rung));
    const hidden = px.get(token(fold.rung));
    assert.ok(prose != null && hidden != null, "a rung on this comparison is off-ladder");
    assert.ok(hidden < prose,
      `folded detail ships ${hidden}px against ${prose}px of surrounding prose — `
      + "a disclosure that comes back larger than the page is the defect this file was written for");
  });

  it("the summary and its body are exactly one rung apart", () => {
    // Segregation without a second voice. Two rungs apart and the answer reads
    // as a footnote to the question rather than as the answer to it; equal and
    // there is no telling the fold's question from what it hides.
    const steps = [...px.entries()]
      .filter(([name]) => /^--fs-(2xs|xs|sm|body|md|lg|xl|2xl|title)$/.test(name))
      .sort((a, b) => a[1] - b[1])
      .map(([name]) => name);
    const ask = shipped(".console-card summary");
    const answer = shipped(".console-card details.disclosure");
    assert.ok(ask && answer, "a disclosure rule declares no font-size");
    const summary = steps.indexOf(token(ask.rung));
    const hidden = steps.indexOf(token(answer.rung));
    assert.ok(summary >= 0 && hidden >= 0, "a shipped disclosure rung is not on the content ladder");
    assert.equal(summary - hidden, 1,
      `summary ships ${token(ask.rung)} and body ships ${token(answer.rung)}, `
      + `${summary - hidden} rungs apart on ${steps.join(" < ")}`);
  });
});
