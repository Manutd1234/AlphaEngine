/**
 * The helper every source-reading suite depends on, and the one hole it had.
 *
 * `stripNonCode` decides what "code" means for this tree. Around a hundred
 * suites read a component with it and then assert on the result, so a span it
 * blanks by accident is a span none of them can see — and the assertion still
 * passes, because a ban over blanked text always does.
 *
 * IT HAD EXACTLY THAT HOLE UNTIL 2026-08-26. Comments, `"double"` and `'single'`
 * quoted strings were blanked; template literals were not. So an apostrophe
 * inside a backtick — "the venue's bounds" — was a live `'` to the single-quote
 * pattern, paired with the next apostrophe anywhere in the file, and everything
 * between the two was replaced.
 *
 * SEVEN FILES CARRIED THE HOLE, measured across `components/`, `lib/` and
 * `app/`: `ParlayLegs` (1,592 characters blanked), `MarginAxis` (2,379),
 * `PayoffByState` (2,540), `BasketWhatIf` (96), `lib/quant/stability.ts` (187),
 * `lib/pnl-attribution/costs.ts` (672) and `lib/gateway.ts` (241 + 212 +
 * 2,783). An odd apostrophe COUNT is a proxy and over-counts about four-fold —
 * most stray apostrophes pair with another still inside the same literal and
 * swallow nothing — so the number to hold is the seven, not the thirty-five the
 * proxy reports.
 *
 * `ParlayLegs` is the one that was live: it is named in `proofs-figures.test.ts`
 * under a ban on `useCoherenceRead|Route\(`, so that ban was passing over it by
 * construction.
 *
 * TWO FIXES WERE WRONG BEFORE THE RIGHT ONE, and this file pins both reasons.
 * Blanking a whole backtick span destroys `${…}`, and an interpolation is
 * exactly where a banned call hides. Blanking only the TEXT keeps the
 * interpolation but loses a constructed id — `markets-subtab-${next}` has its
 * prefix in that text, and two rail guards pin it. What ships neutralises only
 * the QUOTE CHARACTERS inside a template region: the apostrophe can no longer
 * pair outward, and nothing else about the file changes.
 *
 * Every assertion below is a MUTATION: it injects the thing a real guard bans
 * and asserts the stripper still shows it. A guard is not believed here until
 * it has been red.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

describe("what the source stripper counts as code", () => {
  it("keeps an interpolated call visible inside a template literal", () => {
    // THE REGRESSION THAT MATTERS. If a future simplification blanks whole
    // backtick spans, this is what stops it: the ban a hundred suites rely on
    // would go quiet over every interpolated route builder in the tree.
    const mutated = "const caption = `the bounds ${absorptionRoute()} leaves`;";
    assert.match(stripNonCode(mutated), /absorptionRoute\(/,
      "an interpolation was blanked, so a banned call can hide inside one");
  });

  it("keeps the text around it too, because guards read constructed ids", () => {
    // DELIBERATELY NOT BLANKED, and this is the choice the narrow fix makes.
    // `document.getElementById(`markets-subtab-${next}`)` has its id PREFIX in
    // that text, and two rail guards pin exactly that string. Blanking the text
    // fixes the apostrophe bug and costs those two; neutralising only the quote
    // characters fixes it and costs nothing.
    const id = "document.getElementById(`markets-subtab-${next}`)";
    assert.match(stripNonCode(id), /markets-subtab-\$\{next\}/,
      "a constructed id is no longer readable, so the guards that pin one are blind");
  });

  it("neutralises a quote inside a literal so it cannot pair outward", () => {
    const source = "const a = `the venue's bounds`;";
    assert.doesNotMatch(stripNonCode(source), /'/,
      "an apostrophe survives inside a template literal and will pair with the next one");
  });

  it("does not let an apostrophe in a literal blank the code after it", () => {
    // The defect itself, in miniature: two literals, one apostrophe each, and
    // an import between them that used to vanish.
    const source = [
      "const a = `the venue's bounds`;",
      // Resolvable ON PURPOSE. `check_repo_complete.sh` scans raw text for
      // import specifiers and cannot tell a fixture from a real import, so a
      // made-up `"./Figure"` here reads to it as this file importing a module
      // that does not exist — which is exactly the class of thing it is right
      // to fail on. It went red on Linux at 0581f38 while every web job passed,
      // because the check is a separate job. The shape under test is unchanged:
      // an import statement between two apostrophe-bearing template literals.
      'import Figure from "./globals-css";',
      "const b = `don't`;",
      "const c = <Figure />;",
    ].join("\n");
    const code = stripNonCode(source);
    assert.match(code, /import Figure from/, "the import between two literals was blanked");
    assert.match(code, /<Figure \/>/, "the JSX after the second literal was blanked");
  });

  it("still blanks the three kinds it always blanked", () => {
    const source = [
      "/* useCoherenceRead in a block comment */",
      "// useCoherenceRead in a line comment",
      'const a = "useCoherenceRead in a double-quoted string";',
      "const b = 'useCoherenceRead in a single-quoted string';",
      "const real = useCoherenceRead(x);",
    ].join("\n");
    const code = stripNonCode(source);
    assert.equal((code.match(/useCoherenceRead/g) ?? []).length, 1,
      "a mention in prose or a string is being read as a call");
  });

  it("shows the fetch ban the file it was passing over", () => {
    // ParlayLegs is the live case and it is checked against the real file, not
    // against a fixture: a fixture would keep passing after the file changed.
    const source = read("../components/coherence/ParlayLegs.tsx");
    const injected = source.replace(
      "export default function ParlayLegs",
      "const stolen = useCoherenceRead(combosRoute());\nexport default function ParlayLegs",
    );
    assert.notEqual(injected, source, "the injection point moved; this test is no longer mutating anything");
    assert.match(stripNonCode(injected), /useCoherenceRead/,
      "a fetch injected into ParlayLegs is invisible to the ban that forbids it");
    // And the unmutated file still passes, so the fix introduces no false alarm.
    assert.doesNotMatch(stripNonCode(source), /useCoherenceRead|Route\(/,
      "ParlayLegs now trips its own ban, which would be a defect rather than a fix");
  });
});
