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
 * the common case. Dense plots keep keyboard inspection; short process diagrams
 * instead print every value in semantic HTML, avoiding a second interaction
 * model where no hidden reading needs to be discovered.
 *
 * DERIVED, NEVER OBSERVED. `npm test` has no DOM (CLAUDE.md, fact 6). This
 * proves the wiring, the refusals and the marks; whether the six READ wants a
 * viewport, and the plan says so rather than pretending here.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

/**
 * Each new figure, the view that draws it, and — for one of them — the drawing
 * it draws THROUGH.
 *
 * `through` is an indirection, not an exemption, and the difference is that the
 * structural checks follow it. `ParlayReadCost` composes `FormationDiagram`,
 * which already owns the chain grammar, the marks and the `<Figure>` frame; a
 * second SVG chain beside it would be a second way of drawing the same object.
 * So the frame, the empty branch and the semantic readout are asserted on
 * `FormationDiagram` — and the composition itself is asserted here, so the
 * indirection cannot become a way of claiming a figure that is not one.
 */
const FIGURES: Record<string, {
  file: string;
  drawnIn: string;
  replaces: string;
  through?: string;
  staticFlow?: boolean;
  interactiveFlow?: boolean;
}> = {
  SolverProofLoom: {
    file: "../components/coherence/SolverProofLoom.tsx",
    drawnIn: "../components/coherence/ConstraintLadder.tsx",
    replaces: "a fixed four-step browser narrative unrelated to the solver run",
    interactiveFlow: true,
  },
  ParlayReadCost: {
    file: "../components/coherence/ParlayReadCost.tsx",
    drawnIn: "../components/coherence/CombosPane.tsx",
    replaces: "one grey sentence on the branch that IS the view when the venue is slow",
    through: "../components/coherence/FormationDiagram.tsx",
    staticFlow: true,
  },
  FamilyRidge: {
    file: "../components/coherence/FamilyRidge.tsx",
    drawnIn: "../components/coherence/IndexPane.tsx",
    replaces: "a two-row strip of series peaks on a view named for families",
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
      // Where the frame, the empty branch and the readout live: this file, or
      // the drawing it composes.
      const drawing = stripNonCode(read(entry.through ?? entry.file));

      it("exports the named figure component", () => {
        // Product copy is allowed normal punctuation. Guard the code boundary
        // directly instead of making apostrophe parity inside template strings
        // an accidental UI contract.
        assert.match(source, new RegExp(`export default function ${name}\\b`),
          `${name} is not a stable named default export`);
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
        if (entry.through) {
          assert.match(code, new RegExp(`<${entry.through.split("/").pop()!.replace(".tsx", "")}\\b`),
            `${name} names a drawing to compose and does not render it`);
        }
        assert.match(drawing, /<Figure\b/, `${name} draws outside the tab's figure frame`);
        assert.match(code, /(missing=|notes=)/,
          `${name} can be missing a leg, a side or a whole book and says so nowhere`);
      });

      it("has an empty branch that is itself a sentence", () => {
        // A blank plot area and a plot area with nothing in it look identical,
        // and one of them means the feed is down.
        assert.match(drawing, /FigureEmpty|coh-figure__empty|console-empty|holds/,
          `${name} renders an empty axis rather than saying why it is empty`);
      });

      it("keeps every visual reading reachable", () => {
        const marks = read(entry.through ?? entry.file);
        if (entry.interactiveFlow) {
          assert.match(drawing, /<ol\b/, `${name} does not expose its derivation as an ordered flow`);
          assert.match(drawing, /<button\b[\s\S]*aria-pressed=/,
            `${name} has no explicit selected stage for assistive technology`);
          assert.match(drawing, /onPointerEnter=\{[\s\S]*onFocus=\{[\s\S]*onKeyDown=\{/,
            `${name} does not support pointer, focus, and keyboard inspection`);
          for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"]) {
            assert.match(drawing, new RegExp(`\\b${key}:`), `${name} does not handle ${key}`);
          }
          assert.match(marks, /<output\b[\s\S]*aria-live="polite"/,
            `${name} has no stable live inspector for the selected stage`);
          assert.match(drawing, /function threadPath\(/,
            `${name} does not derive a path for the evidence handoff`);
          assert.match(marks, /className="coh-proof-loom__thread"/,
            `${name} does not draw the evidence handoff between stages`);
          assert.match(drawing, /reserveInteractionRow=\{false\}/,
            `${name} reserves a second, empty interaction row`);
          assert.match(marks, /money\(row\.slack\)/,
            "the proof geometry is not accompanied by exact slack values");
          assert.match(marks, /All \$\{evidence\.constraints\.rows\.length\} solver-attached named checks/,
            "the ranked subset has no complete exact ledger");
          return;
        }
        if (entry.staticFlow) {
          assert.match(drawing, /<ol\b/,
            `${name} does not expose its process as an ordered semantic flow`);
          assert.match(drawing, /<article\b/,
            `${name} has no self-contained stage cards`);
          assert.match(drawing, /<ArrowRight\b/,
            `${name} does not show how one stage hands off to the next`);
          assert.match(drawing, /reserveInteractionRow=\{false\}/,
            `${name} reserves an empty plot interaction row`);
          assert.doesNotMatch(stripNonCode(marks), /<Plot\b|sharedX=|useHot\(|pin: true/,
            `${name} keeps hidden per-mark state even though every value is printed`);
          if (name === "ConstraintLadder") {
            assert.match(marks, /money\(constraint\.slack\)/,
              "the proof geometry is not accompanied by exact slack values");
            assert.match(marks, /All \$\{tested\.length\} evaluated constraints/,
              "the ranked subset has no complete exact ledger");
          } else {
            assert.match(marks, /stage\.value \?\? "Not measured"/,
              `${name} does not print unavailable values honestly`);
            assert.match(marks, /status\(stage\.holds\)/,
              `${name} leaves stage state to colour or shape alone`);
          }
          return;
        }

        // Dense plots still need a keyboard readout for values not printed at rest.
        assert.match(drawing, /<Plot\b/, `${name} does not draw inside Plot, so it has no readout at all`);
        assert.ok(/<title>/.test(marks) || /sharedX=/.test(stripNonCode(marks)),
          `${name} carries no per-mark title and no shared axis, so nothing can be read off it`);
      });
    });
  }
});
