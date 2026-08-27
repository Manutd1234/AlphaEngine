/**
 * Hot: the index under the reader's hand, shared by a figure and the table
 * that explains it — never spoken, never kept, scoped to the pair.
 *
 * The figure's mark hook publishes the index it is showing; the table lights
 * that row. A row's pointer or focus publishes its index; the figure lights
 * that mark. Both read one context, and both index ONE array in document
 * order, so they can never disagree about which entity is meant.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read, stripNonCode } from "./helpers/workspace-sources";

const hot = read("../lib/coherence/use-hot.tsx");
const marks = read("../lib/coherence/use-mark-readout.ts");
const figure = read("../components/coherence/Figure.tsx");
const interaction = read("../app/globals/10n-engine-interaction.css").replace(/\/\*[\s\S]*?\*\//g, " ");

describe("the hot primitive", () => {
  it("is a context with no element and no voice", () => {
    assert.match(hot, /export function HotSource\(/);
    assert.match(hot, /export function useHot\(/);
    const code = stripNonCode(hot);
    assert.doesNotMatch(code, /<div|<p\b|aria-live|role=/, "hot renders an element or speaks");
  });
  it("is inert outside a provider, so a figure standing alone is unchanged", () => {
    assert.match(stripNonCode(hot), /context \?\? \{ hot: null, setHot: noop \}/);
  });
});

describe("the mark hook publishes what it shows", () => {
  it("records the shown mark's index in show(), from the list it already holds", () => {
    // RAW source between the two declarations, so this reads the real body
    // rather than a comment about it.
    const body = marks.slice(marks.indexOf("const show = useCallback("), marks.indexOf("const onPointerMove"));
    assert.ok(body.length > 200, "show() is no longer where this reads it");
    assert.match(body, /marks\.current\.length \? marks\.current : collect\(\)/,
      "show() walks the DOM again instead of the list the hook already holds");
    assert.match(body, /const at = found\.indexOf\(element\);/, "show() does not record the mark's index");
    assert.match(body, /setHotIndex\(at >= 0 \? at : null\)/,
      "a mark that is not in the list publishes -1, and -1 is not a row");
  });

  it("hands the index out and clears it with the readout", () => {
    assert.match(stripNonCode(marks), /hotIndex,/, "the hook does not hand the index out");
    const clear = marks.slice(marks.indexOf("const clear = useCallback("), marks.indexOf("focusIndexRef.current = focusIndex;"));
    assert.ok(clear.length > 20, "clear() is no longer where this reads it");
    assert.match(clear, /setHotIndex\(null\)/, "leaving the figure leaves the row lit");
  });

  it("the plot publishes it in an effect, never during render", () => {
    // Setting a PARENT's state during render is the one thing React refuses
    // outright, and it is the obvious way to write this.
    assert.match(figure, /const \{ setHot \} = useHot\(\);/, "Plot does not reach the hot context");
    assert.match(figure, /useEffect\(\(\) => \{ setHot\(marks\.hotIndex\); \}, \[setHot, marks\.hotIndex\]\);/,
      "the hot index is published during render, or not at all");
  });
});

interface Site {
  /** The section that renders the provider. */
  file: string;
  /**
   * The component rendered INSIDE it, holding both halves.
   *
   * A component cannot consume the context it renders — the provider's value
   * only reaches its descendants — so the section wraps one child, and that
   * child owns the figure, the table, and the index they share.
   */
  inner: string;
  /** The figure that takes `hot` and publishes its own. */
  figure: string;
  /**
   * The component in the same file whose body holds the ROWS, when they are
   * not inline in the inner.
   *
   * `StakeTable` is rendered by two callers — the plan and the whole-family
   * view — so its markup cannot move into either of them. It takes `hot` and
   * an `onHot` publisher instead, which shares the index exactly as inline
   * rows do; what changes is only where this file looks for the handlers.
   */
  rowsIn?: string;
}

const HOT_SITES: Site[] = [
  { file: "CalibrationCorpus.tsx", inner: "Composition", figure: "CorpusShares" },
  // Markets. The replay's table and the strip that prices it are the same six
  // configurations in the same order, both open on the page — no fold to open
  // first, which is what disqualified the Stake pair, whose table sits inside a
  // `<details>` where a lit row would be lit behind a closed door.
  { file: "AblationPane.tsx", inner: "ReplayTable", figure: "ValueStrip" },
  // The plan's bars against the numbers behind them. Its table is FOLDED, so
  // the lit row is worth nothing until a reader opens the disclosure — and
  // everything to the reader who does, which is the one checking a bar.
  { file: "surface/StakeView.tsx", inner: "AdmittedPlan", figure: "StakeBars", rowsIn: "StakeTable" },
];

/** A top-level function's body: from its declaration to the next one, or the end. */
function bodyOf(source: string, name: string): string {
  const at = source.indexOf(`function ${name}(`);
  if (at === -1) return "";
  const next = source.indexOf("\nfunction ", at + 1);
  const exported = source.indexOf("\nexport ", at + 1);
  const ends = [next, exported].filter((index) => index !== -1);
  return source.slice(at, ends.length ? Math.min(...ends) : source.length);
}

describe("every hot site", () => {
  for (const site of HOT_SITES) {
    it(`${site.file}: the pair shares one hot index in both directions`, () => {
      const source = read(`../components/coherence/${site.file}`);
      const code = stripNonCode(source);

      const provider = code.indexOf("<HotSource>");
      const closes = code.indexOf("</HotSource>", provider);
      assert.ok(provider !== -1 && closes !== -1, "the pair is not wrapped in a provider");
      assert.match(code.slice(provider, closes), new RegExp(`<${site.inner}\\b`),
        `the provider does not wrap ${site.inner}`);

      const inner = bodyOf(code, site.inner);
      assert.ok(inner.length > 200, `${site.inner} is not a top-level function in this file`);
      assert.match(inner, /useHot\(\)/, "nothing inside the provider consumes the hot index");
      assert.match(inner, new RegExp(`<${site.figure}\\b`), `${site.figure} is outside the provider's child`);
      assert.match(inner, /hot=\{hot\}/, "the figure is not told what is hot");
      // The rows: inline in the inner, or in a component the inner renders and
      // hands the index to. Either way ONE index, published and consumed.
      const rows = site.rowsIn ? bodyOf(code, site.rowsIn) : inner;
      assert.ok(rows.length > 100, `${site.rowsIn ?? site.inner} is not a top-level function in this file`);
      assert.match(rows, /<table/, "the rows are not a table");
      if (site.rowsIn) {
        assert.match(inner, new RegExp(`<${site.rowsIn}\\b`), `${site.rowsIn} is not rendered by the provider's child`);
        assert.match(inner, /onHot=\{setHot\}/, "the table cannot publish, so hot is one-directional");
      }
      for (const handler of ["onPointerEnter", "onPointerLeave", "onFocus", "onBlur"]) {
        assert.match(rows, new RegExp(`${handler}=\\{`), `a row has no ${handler}, so hot is one-directional`);
      }
      assert.match(site.rowsIn ? bodyOf(source, site.rowsIn) : bodyOf(source, site.inner), /is-hot/, "a hot row is not marked");
      // AND THE FIGURE MARKS ITS OWN. Found by mutation on 2026-08-27: with
      // `is-hot` deleted from the figure's mark this file stayed green, so the
      // table→figure direction — the whole point of handing `hot` down — was
      // unguarded. A pair where only the table lights is half a pair.
      const dir = site.file.includes("/") ? `${site.file.slice(0, site.file.lastIndexOf("/"))}/` : "";
      const drawing = read(`../components/coherence/${dir}${site.figure}.tsx`);
      assert.ok(drawing.trim().length > 500, `${site.figure} is not where this expects it`);
      assert.match(stripNonCode(drawing), /hot\?: number \| null/, `${site.figure} takes no hot index`);
      assert.match(drawing, /is-hot/, `${site.figure} never marks the row it is told is hot`);

      // Hooks first: the child is a component, and a hook below a conditional
      // return tears the tab down on a cold load.
      const hookAt = inner.indexOf("useHot()");
      const returnAt = inner.search(/^ {2}if \(/m);
      assert.ok(returnAt === -1 || hookAt < returnAt, "useHot sits below a conditional return");
    });
  }
  it("counts the sites it has", () => {
    assert.equal(HOT_SITES.length, 3);
  });
});

describe("hot on a mark is a stroke, never a fill", () => {
  it("declares the mark rule with a stroke-width and no fill", () => {
    const rule = interaction.match(/\.coherence-plane \.coh-plot \.is-hot \{([^}]*)\}/);
    assert.ok(rule, "no hot rule for marks");
    assert.match(rule[1], /stroke-width/);
    assert.doesNotMatch(rule[1], /fill:/, "hot changes a fill, which is meaning by colour");
  });
});
