/**
 * The tail-latency trend opens the Reliability overview, and the fold it used
 * to push the first symptom past is paid for rather than argued away.
 *
 * The reader asked for this order directly: "put the tail latency at the top
 * and the triage and incident path below it". The order the file shipped with
 * was the opposite, and it was the opposite ON PURPOSE — the note above the
 * split recorded that opening with the chart put a plot, a heading and a legend
 * between the rail and the only list on the tab that says what is wrong right
 * now, so on a laptop the first symptom sat under the fold.
 *
 * That is a real defect, not a preference, and the reorder does not repeal it.
 * What repeals it is the 54px the card gave back — a shorter plot, a block-box
 * svg, a legend margin that only belongs above a chart, and a tighter gap under
 * the head's rule. This suite pins the ORDER and the PAYMENT together, because
 * either one alone is the bug: the order without the savings puts the symptom
 * back under the fold, and the savings without the order are 54px of nothing.
 *
 * Read as source, like every other suite here. There is no renderer in this
 * project and no browser in the test runner, so the arithmetic itself lives in
 * the comment the last assertion guards; what is checkable mechanically is that
 * each term of it is still the number the file declares.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { globalsCss, locateInGlobals } from "./globals-css";

const root = join(import.meta.dirname, "..");
const read = (relative: string) => {
  const text = readFileSync(join(root, relative), "utf8");
  assert.ok(text.length > 500, `${relative} did not load`);
  return text;
};

/**
 * One line, one space. Every needle below is a SENTENCE, and a sentence in a
 * comment is wrapped to the column the file happens to use — a needle tied to
 * one line break rots the day a word is added above it. The same trick
 * `summarised-reliability.test.ts` uses on prose, for the same reason.
 */
const flat = (text: string) => text.replace(/\s+/g, " ");

const attention = read("components/systems/ReliabilityAttention.tsx");
const trend = read("components/systems/LatencyTrend.tsx");

/** JSX comment bodies blanked, newlines kept, so prose is never read as markup. */
const markup = attention.replace(/\{\/\*[\s\S]*?\*\/\}/g, (block) =>
  block.replace(/[^\n]/g, " "));

/** The last rule matching `selector` exactly, with the partial it came from. */
function rule(selector: string): { body: string; where: string } {
  const pattern = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "g");
  const matches = [...globalsCss.matchAll(pattern)];
  assert.ok(matches.length > 0, `no rule for ${selector}`);
  const last = matches[matches.length - 1];
  const open = globalsCss.indexOf("{", last.index);
  return { body: globalsCss.slice(open + 1, globalsCss.indexOf("}", open)), where: locateInGlobals(open) };
}

describe("the trend is above the triage list, in the DOM and not only on screen", () => {
  it("renders before the split that carries the symptom list", () => {
    const chart = markup.indexOf("<LatencyTrend");
    const split = markup.indexOf('className="reliability-overview__split"');
    assert.ok(chart > 0, "the trend chart is no longer rendered here");
    assert.ok(split > 0, "the triage and incident-path split is gone");
    assert.ok(
      chart < split,
      "the trend must come FIRST: the reader asked for the tail latency at the top "
      + "and the triage and incident path below it",
    );
  });

  it("moves the chart in source order, not with CSS order", () => {
    /**
     * `order` or `grid-row` would put the plot on top for a sighted reader and
     * leave a screen reader and the tab key walking the old sequence — two
     * different pages from one file. `.reliability-overview` is a grid, so the
     * temptation is one line away.
     */
    const overview = rule(".reliability-overview");
    assert.doesNotMatch(overview.body, /\border\s*:/, `${overview.where}: visual order must not diverge from DOM order`);
    assert.doesNotMatch(markup, /<LatencyTrend[^>]*style=/, "the chart must not be positioned inline");
  });

  it("leaves the keyboard sequence exactly where it was", () => {
    // The chart holds no control, so moving it past the symptom buttons cannot
    // reorder the tab ring. This is what makes the reorder free for a keyboard
    // reader, and it stops being true the day the chart grows a control.
    for (const forbidden of ["<button", "tabIndex", "onClick", "href="]) {
      assert.ok(
        !trend.includes(forbidden),
        `LatencyTrend now carries ${forbidden} — it sits ahead of the symptom list, `
        + "so a control here takes focus before the thing that says what is wrong",
      );
    }
  });

  it("keeps each section labelled by its own heading, at one level", () => {
    const labelled = [...markup.matchAll(/<section\b[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(labelled.length, 2, "the two triage sections must each still name their own heading");
    for (const id of labelled) {
      assert.ok(markup.includes(`<h2 id="${id}">`), `${id} names no h2 in this file`);
    }
    // The chart's own section labels itself in LatencyTrend.tsx, at the same
    // level: three h2 siblings, so a reader's outline gained no depth.
    assert.match(trend, /<section className="card latency-trend" aria-labelledby="reliability-latency-trend-title">/);
    assert.match(trend, /<h2 id="reliability-latency-trend-title">/);
    assert.doesNotMatch(markup, /<h3\b/, "the reorder must not have re-levelled a heading");
  });
});

describe("the height the reorder spends is the height the card gave back", () => {
  it("the plot is 140 user units, and not back at 168", () => {
    const height = /\nconst HEIGHT = (\d+);/.exec(trend);
    assert.ok(height, "LatencyTrend no longer declares a HEIGHT");
    const value = Number(height![1]);
    assert.ok(value <= 140, `the plot is ${value} units: above the symptom list the budget is 140`);
    assert.ok(
      value >= 120,
      `${value} units leaves under 82 of inner plot after MARGIN — below the overview KPI deck's `
      + "96px spark, which is where a second reading of the series stops being one",
    );
  });

  it("the svg is a block box, so it reserves no descender under the plot", () => {
    const svg = rule(".latency-trend svg");
    assert.match(svg.body, /display:\s*block/, `${svg.where}: an inline svg reserves a text descender beneath itself`);
  });

  it("the legend drops the margin it only needs above a chart", () => {
    const legend = rule(".latency-trend .legend");
    assert.match(legend.body, /margin-bottom:\s*0/, `${legend.where}: this legend is the card's last child`);
    // And the shared rule keeps its gap for the eleven call sites that sit on
    // top of their chart — the scoped override is the whole point.
    assert.match(rule(".legend").body, /margin-bottom:\s*10px/, "the shared legend gap was retuned instead of overridden");
  });

  it("tightens the air around the head's rule without moving the rule", () => {
    const head = rule(".latency-trend > .section-heading.compact");
    assert.match(head.body, /padding-bottom:\s*var\(--space-2\)/, `${head.where}: the gap above the rule`);
    assert.match(head.body, /margin-bottom:\s*var\(--space-2\)/, `${head.where}: the gap below the rule`);
    for (const metric of ["min-height", "font-size", "line-height"]) {
      assert.ok(
        !head.body.includes(metric),
        `${head.where}: ${metric} here changes the head's HEIGHT, and every card head on this `
        + "tab is aligned to this one",
      );
    }
  });

  it("takes the packaging before the plot, and says so where both are read", () => {
    // 26px of the 54 is packaging and 28 is plot. If a later reader trims the
    // plot again without reading why, this is the sentence that stops them.
    assert.match(flat(trend), /28 of the card's 54px saving is here/);
    assert.match(flat(globalsCss), /hand back 26 of them and cost the chart nothing/);
  });
});

describe("the note above the split still records the trade-off it was overruled on", () => {
  const note = flat(attention.slice(0, attention.indexOf("<LatencyTrend")));

  it("keeps the defect the old order existed to prevent, in its own terms", () => {
    for (const fact of [
      "168px plot plus its heading and legend",
      "the first symptom sat below the fold",
    ]) {
      assert.ok(note.includes(fact), `the cost the old order was paying for is gone from the note: "${fact}"`);
    }
  });

  it("names the decider and the instruction, so the next reader does not revert it", () => {
    assert.match(note, /put the tail latency at the top and the triage and incident path below it/);
  });

  it("carries the fold arithmetic, not an assertion that it fits", () => {
    // Every term a later change would invalidate: the chrome above the panel,
    // the card's before and after, the two presets and the laptop viewport.
    for (const term of ["324px before any content", "307px card", "739px down", "807px down", "790"]) {
      assert.ok(note.includes(term), `the arithmetic lost the term "${term}", and cannot be rechecked without it`);
    }
  });

  it("names what was rejected and what the rejection costs", () => {
    assert.match(note, /REJECTED/);
    assert.match(note, /120 units/, "the cheaper plot that would close the Large-preset gap is not named");
    assert.match(note, /17px/, "the price of refusing it is not stated");
  });
});
