/**
 * The 2026-08-26 Proofs pass: the figures that replace a drawn scalar.
 *
 * "we need to revamp the entire Proofs section with new images that are
 *  innovative and novel … the proof subtab diagram is not interactive and
 *  doesnt show any useful information … Basket, why is it just a straight line"
 *
 * `proofs-figures.test.ts` guards the six that landed the day before and its
 * rules still apply to these; this file is the second table rather than a
 * second set of rules, split because that one is already at its length and
 * because these six answer a different complaint. The earlier pass asked
 * whether a section had ENOUGH figures. This one asks whether the figure a
 * section already had says anything on the answer the reader actually gets.
 *
 * THE COMPLAINT IS ALWAYS THE SAME SHAPE, and naming it once is what this file
 * is for: a figure that draws ONE NUMBER degenerates on the ordinary answer.
 * The Proof view drew 189 against 0, and `ValueStrip` floors a zero bar at 1px
 * and excludes exact zeros from its own floor note, so the second bar was a
 * hairline nothing explained. Basket drew a margin of `-0.000000` against a
 * threshold of `0.0001` on a linear axis, which is one horizontal rule with a
 * mark on it, beside a coverage strip that emits a 3px stub per state when
 * there are no legs — a straight line, twice. The index drew one scalar per
 * family and hid the other three columns in a fold.
 *
 * So every entry below is asserted to draw something with a SHAPE that survives
 * the common case, and to be reachable by keyboard, which is the other half of
 * "not interactive".
 *
 * DERIVED, NEVER OBSERVED. `npm test` has no DOM (CLAUDE.md, fact 6). This
 * proves the wiring, the refusals and the marks; whether the six READ wants a
 * viewport, and the plan says so rather than pretending here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/** Each new figure, and the view that draws it. */
const FIGURES: Record<string, { file: string; drawnIn: string; replaces: string }> = {
  ConstraintLadder: {
    file: "../components/coherence/ConstraintLadder.tsx",
    drawnIn: "../components/coherence/CertificateViews.tsx",
    replaces: "a two-row ValueStrip of rows tested against rows skipped",
  },
  ShortfallScale: {
    file: "../components/coherence/ShortfallScale.tsx",
    drawnIn: "../components/coherence/PortfolioPane.tsx",
    replaces: "a linear margin axis whose mark sat on its own threshold",
  },
};

describe("the figures that replace a drawn scalar", () => {
  for (const [name, entry] of Object.entries(FIGURES)) {
    describe(name, () => {
      const source = read(entry.file);
      const code = stripNonCode(source);

      it("can be read by the guards that read it", () => {
        // A GUARD THAT CANNOT SEE THE FILE IS NOT A GUARD, and this one is
        // invisible from every direction but this.
        //
        // `stripNonCode` — the helper every source-reading suite in this tree
        // uses — blanks block comments, line comments, "double" and 'single'
        // quoted strings. It does NOT blank template literals. So a lone
        // apostrophe inside a backtick pairs with the NEXT apostrophe anywhere
        // in the file and everything between the two is blanked: JSX, imports,
        // hook calls, whatever happens to sit there.
        //
        // Found by writing one. `ConstraintLadder` said "the gateway's
        // programme" inside a template literal, and the `<Figure` assertion
        // below failed on a file that plainly renders one. The same collision
        // would have made the fetch REFUSAL pass on a file that fetched.
        //
        // Measured across `components/`, `lib/` and `app/` on 2026-08-26: 35
        // files carry an odd apostrophe count inside a template literal. The
        // shared helper is where that gets fixed, and it is shared with two
        // other live sessions; this holds the line for the files added here so
        // that at least these guards mean what they say.
        const withoutComments = source
          .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
          .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
        for (const literal of withoutComments.match(/`(?:[^`\\]|\\.)*`/g) ?? []) {
          const apostrophes = (literal.match(/\u0027/g) ?? []).length;
          assert.equal(apostrophes % 2, 0,
            `${name} has an unpaired apostrophe in a template literal, which blanks arbitrary `
            + `code from every suite that reads this file: ${literal.slice(0, 60)}`);
        }
      });

      it("is drawn by the view it is for", () => {
        const host = stripNonCode(read(entry.drawnIn));
        assert.match(host, new RegExp(`<${name}\\b`),
          `${name} exists but nothing renders it, so it replaces ${entry.replaces} nowhere`);
        assert.match(host, new RegExp(`import ${name} from`),
          `${name} is rendered but not imported by name from its own file`);
      });

      it("reads nothing of its own", () => {
        // A figure that quietly needed a route would be a schema change wearing
        // a chart's clothes — reviewed as a drawing, shipped as a contract. The
        // rule `diffusion-figures` states for the announcement arm and
        // `proofs-figures` for the six before these.
        for (const forbidden of [/useCoherenceRead/, /Route\(/, /fetch\(/]) {
          assert.doesNotMatch(code, forbidden,
            `${name} fetches; every field it draws must already be on the wire its view read`);
        }
      });

      it("is a figure, with a footnote it can use", () => {
        assert.match(code, /<Figure\b/, `${name} draws outside the tab's figure frame`);
        assert.match(code, /(missing=|notes=)/,
          `${name} can be missing a leg, a side or a whole book and says so nowhere`);
      });

      it("has an empty branch that is itself a sentence", () => {
        // A blank plot area and a plot area with nothing in it look identical,
        // and one of them means the feed is down.
        assert.match(code, /FigureEmpty|coh-figure__empty|console-empty/,
          `${name} renders an empty axis rather than saying why it is empty`);
      });

      it("puts its marks on the keyboard", () => {
        // `Plot` turns any element carrying a `<title>` into a hover readout AND
        // an arrow-key stop, or takes a `sharedX` axis and reads every mark at
        // one position. A figure with neither is a picture, which is the half of
        // "not interactive" a source scan can see.
        assert.match(code, /<Plot\b/, `${name} does not draw inside Plot, so it has no readout at all`);
        assert.ok(/<title>/.test(source) || /sharedX=/.test(code),
          `${name} carries no per-mark title and no shared axis, so nothing can be read off it`);
      });
    });
  }
});
