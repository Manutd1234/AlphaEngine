/**
 * The work queue as a flow: geometry, motion, and the two things that break it.
 *
 * The connector between stages is drawn into the column gutter with negative
 * offsets. Those offsets and the gap were three separate hardcoded numbers that
 * had to agree, and nothing said so — change the gap and the arrows detach or
 * overshoot, in a way that looks like a rendering glitch rather than a rule
 * nobody wrote down. They share one custom property now, and this asserts it.
 *
 * The other hazard is the priority accent. It lives on `border-left-color` at
 * the same specificity as the hover rule, so a hover written with the
 * `border-color` shorthand silently repaints P0 red as P2 blue — a card
 * changing severity under the pointer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const css = read("../app/globals.css");
const board = read("../components/data/DataWorkBoard.tsx");

/** The declaration block of a rule, anchored at the start of a line. */
function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `stylesheet no longer contains ${selector}`);
  const open = css.indexOf("{", start);
  return css.slice(open, css.indexOf("}", open));
}

describe("the gutter and its connector share one number", () => {
  it("the board declares the gap as a custom property", () => {
    const block = rule(".data-workboard__board");
    assert.match(block, /--wq-gap:\s*\d+px;/);
    assert.match(block, /gap:\s*var\(--wq-gap\);/);
  });

  it("the connector track spans exactly the gutter", () => {
    const block = rule(".data-work-column:not(:last-child)::before");
    assert.match(block, /right:\s*calc\(-1 \* var\(--wq-gap\)\);/);
    assert.match(block, /width:\s*var\(--wq-gap\);/);
    // A literal offset here is the bug this test exists for.
    assert.doesNotMatch(block, /right:\s*-\d+px/);
  });

  it("the arrow badge stays centred in the gutter at any width", () => {
    const block = rule(".data-work-column:not(:last-child)::after");
    assert.match(block, /right:\s*calc\(-13px - var\(--wq-gap\) \/ 2\);/);
    assert.doesNotMatch(block, /right:\s*-\d+px/);
  });

  it("the arrow keeps its vertical anchor to the column heading", () => {
    // Both offsets are measured from the column's padding box, which did not
    // move; changing them would drift the arrows off the header midline.
    assert.match(rule(".data-work-column:not(:last-child)::before"), /top:\s*27px;/);
    assert.match(rule(".data-work-column:not(:last-child)::after"), /top:\s*15px;/);
  });

  it("the scroll-mode breakpoint overrides the same property", () => {
    // Not a second literal gap: the connectors read --wq-gap, so a raw `gap`
    // here would leave them pointing at the wrong place below 980px.
    // Anchored on the override's own track sizing — the sheet carries more
    // than one `@media (max-width: 980px)` block.
    const start = css.indexOf("minmax(226px, 1fr)");
    assert.notEqual(start, -1, "the sub-980px board override is missing");
    const block = css.slice(css.lastIndexOf("{", start), css.indexOf("}", start));
    assert.match(block, /--wq-gap:\s*\d+px;/);
  });
});

describe("columns are bounded at both ends", () => {
  it("neither takes all the leftover space nor leaves it empty", () => {
    /**
     * This pinned `minmax(200px, 216px)` as a literal, and both halves of that
     * history matter.
     *
     * `1fr` came first and was replaced because a queue card is a fixed amount of
     * text: the extra width became whitespace inside the card while the arrows
     * stayed short. 216px then overcorrected — four columns and three gutters
     * occupied about 1068px of a ~1800px canvas, so the board sat in the middle
     * of the panel with wide empty margins and card titles wrapping to two lines
     * while the space they needed sat unused beside them.
     *
     * So the assertion is the SHAPE rather than the numbers: a floor that keeps a
     * card readable, and a ceiling that stops an ultrawide display stretching one
     * across half a metre. A future adjustment inside those bounds should not have
     * to edit a test.
     */
    const block = rule(".data-workboard__board");
    const match = /grid-template-columns:\s*repeat\(4, minmax\((\d+)px, (\d+)px\)\);/.exec(block);
    assert.ok(match, "the four-column track is gone or no longer bounded at both ends");
    const [floor, ceiling] = [Number(match[1]), Number(match[2])];
    assert.ok(floor >= 200, `floor ${floor}px is below a readable card`);
    assert.ok(ceiling > floor, "a ceiling at or below the floor is a fixed width, not a range");
    assert.ok(ceiling >= 380, `ceiling ${ceiling}px still leaves the desk-width canvas half empty`);
    assert.ok(ceiling <= 520, `ceiling ${ceiling}px lets one card stretch across an ultrawide panel`);
  });

  it("the arrows are drawn from the same measurement as the gutter", () => {
    // The connector width and the badge offset both derive from --wq-gap, which
    // is what makes "longer arrows" a one-token change rather than three numbers
    // that have to be kept in agreement.
    const board = rule(".data-workboard__board");
    const gap = /--wq-gap:\s*(\d+)px;/.exec(board);
    assert.ok(gap, "--wq-gap is gone");
    assert.ok(Number(gap[1]) >= 80, `a ${gap[1]}px gutter is too short to read as a flow`);
  });

  it("centres the run without stranding the first column", () => {
    // `safe` is load-bearing: plain centring on a scrollable grid puts the
    // start edge outside the scrollable region, so Intake becomes unreachable
    // once the tracks bottom out.
    const block = rule(".data-workboard__board");
    assert.match(block, /justify-content:\s*start;/);
    assert.match(block, /justify-content:\s*safe center;/);
  });
});

describe("cards answer to the pointer without losing their priority", () => {
  it("lifts on hover and on keyboard focus alike", () => {
    // The status select is the card's only focusable child, so :focus-within
    // is what gives keyboard users the same affordance.
    const start = css.indexOf("\n.data-work-card:hover,");
    assert.notEqual(start, -1, "the hover rule is missing");
    const block = css.slice(css.indexOf("{", start), css.indexOf("}", start));
    assert.match(css.slice(start, start + 80), /:focus-within/);
    assert.match(block, /transform:\s*translateY\(-1px\);/);
    assert.match(block, /box-shadow:/);
  });

  it("never repaints the priority accent", () => {
    const start = css.indexOf("\n.data-work-card:hover,");
    const block = css.slice(css.indexOf("{", start), css.indexOf("}", start));
    // The three named sides are the whole point; `border-color` or
    // `border-left-color` here would turn a P0 card blue under the pointer.
    assert.match(block, /border-top-color:/);
    assert.match(block, /border-right-color:/);
    assert.match(block, /border-bottom-color:/);
    assert.doesNotMatch(block, /border-color:|border-left-color:/);
  });

  it("uses the motion ladder rather than a literal duration", () => {
    const block = rule(".data-work-card");
    assert.match(block, /transition:[^;]*var\(--dur-fast\)[^;]*var\(--ease\)/);
    assert.doesNotMatch(block, /transition:[^;]*\d+ms/);
  });
});

describe("a moved card arrives visibly, once", () => {
  it("animates on arrival with an existing keyframe", () => {
    assert.match(rule(".data-work-card.is-just-moved"), /animation:\s*rise-in var\(--dur\)/);
  });

  it("is set by every path that puts a card somewhere new", () => {
    assert.match(code(board), /setJustMoved\(item\.id\)/);
    assert.match(code(board), /setJustMoved\(id\)/);
    assert.match(code(board), /setJustMoved\(null\)/);
  });

  it("clears itself, and only for its own animation", () => {
    // `both` fill pins the transform, so a card that never cleared this class
    // would stop responding to hover until it remounted. And the live badge's
    // halo also fires animationend here under reduced motion.
    assert.match(code(board), /animationName !== "rise-in"/);
    assert.match(code(board), /setJustMoved\(\(current\) => \(current === item\.id \? null : current\)\)/);
  });

  it("still moves cards through the select, not by dragging", () => {
    // The select is the accessible mechanism; a drag-only board would be
    // unusable by keyboard and is asserted against elsewhere too.
    assert.doesNotMatch(board, /draggable=/);
    assert.match(board, /aria-label=\{`Status for \$\{item\.id\}`\}/);
  });
});

describe("the live badge is decoration over a word, never colour alone", () => {
  it("appears only on in-progress cards", () => {
    assert.match(code(board), /item\.status === "progress" &&/);
  });

  it("carries the meaning in text, with the dot hidden from the tree", () => {
    const badge = code(board).slice(code(board).indexOf('className="data-work-live"'));
    assert.match(badge.slice(0, 200), /<i aria-hidden \/>/);
    assert.match(badge.slice(0, 200), /Active/);
  });

  it("loops a halo rather than the dot itself", () => {
    // The dot stays put; only the ring animates, which is what survives the
    // reduced-motion clamp as a plain static dot.
    assert.match(rule(".data-work-live i::after"), /animation:\s*wq-live-pulse/);
    assert.match(css, /@keyframes wq-live-pulse/);
  });

  it("rests at the same state the clamp forces it to", () => {
    // Reduced motion pins one 1ms iteration; the final frame must therefore be
    // the resting appearance, or the badge would freeze mid-pulse.
    const frames = css.slice(css.indexOf("@keyframes wq-live-pulse"));
    assert.match(frames.slice(0, 200), /60%,\s*100% \{[^}]*opacity:\s*0;/);
  });

  it("adds no second reduced-motion block", () => {
    assert.equal((css.match(/@media \(prefers-reduced-motion: reduce\)/g) ?? []).length, 1);
  });
});
