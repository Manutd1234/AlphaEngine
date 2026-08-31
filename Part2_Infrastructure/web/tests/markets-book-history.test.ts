/**
 * The recorded book tape: four answers, one read, and a derived price that says so.
 *
 * `/api/coherence/books/history` is the first read of `book_snapshots` as a
 * SERIES. The gateway suite (`tests/test_coherence_books_history.py`) owns the
 * query — ordering, the newest-window limit, the implied ask and its nulls. This
 * owns the browser half, which is three properties the Python side cannot see:
 *
 *  1. THE READ IS GATED ON ITS OWN VIEW. It is the cheap read of the two — DuckDB
 *     rather than the venue — but a section that fetched a history nobody opened
 *     would spend it on every reader who came to look at a ladder. That is the
 *     rule the whole tab is built on and the reason `SECTION_READS` leaves two
 *     entries deliberately empty.
 *  2. EVERY EMPTY STATE IS DRAWN. Four refusals reach a reader as "no data"
 *     otherwise, and on a deployment whose recorder never ran the empty branch
 *     IS the view. The standing instruction on this desk is that an empty branch
 *     gets a figure, not a grey sentence.
 *  3. THE IMPLIED ASK IS NAMED AS DERIVED wherever it is drawn. The snapshot
 *     card says which rail supplied it, beside the native bid it is compared to.
 *
 * Derived, never observed: this proves the markup and the wiring, not that a
 * reader met the figure (CLAUDE.md, fact 6).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { booksHistoryRoute } from "../lib/coherence/routes";
import { read, stripNonCode } from "./helpers/workspace-sources";

const section = read("../components/coherence/BooksSection.tsx");
const figure = read("../components/coherence/BookHistory.tsx");
const instrument = read("../components/coherence/BooksInstruments.tsx");
const css = read("../components/coherence/BooksInstruments.module.css");

describe("the route names one market and a window", () => {
  it("carries the ticker encoded, so a slash in one cannot escape the query", () => {
    assert.equal(
      booksHistoryRoute("KXBTCD-26AUG25/T1", 10),
      "/api/gateway/coherence/books/history?ticker=KXBTCD-26AUG25%2FT1&limit=10",
    );
  });

  it("defaults to a window rather than the whole tape", () => {
    // 2,000 is what the sibling history routes default to and it is the wrong
    // number here: at a fifteen-second recorder poll it is eight hours of one
    // market, which is further back than this question ever reaches.
    assert.match(booksHistoryRoute("KXA"), /limit=600$/);
  });

  it("and no component spells the path itself", () => {
    // `coherence-routes.test.ts` holds this for the tab as a whole; stated here
    // too because a NEW route is exactly when someone inlines one.
    assert.doesNotMatch(stripNonCode(section), /\/api\/gateway\/coherence/);
    assert.doesNotMatch(stripNonCode(figure), /\/api\/gateway\/coherence/);
    assert.doesNotMatch(stripNonCode(instrument), /\/api\/gateway\/coherence/);
  });
});

describe("the read is gated on the view that draws it", () => {
  it("only History asks for the tape", () => {
    // RAW source, not `stripNonCode`. That helper blanks string LITERALS as
    // well as comments — which is right for asking what code does and exactly
    // wrong here, because the view id being matched against is a literal and
    // the assertion would be checking `view === ""`.
    assert.match(
      section,
      /booksHistoryRoute\([\s\S]{0,40}\),\s*\n\s*active && view === "history" && Boolean\(current\),/,
      "the recorded tape is read for a reader who opened Books to see a ladder",
    );
  });

  it("and it is not warmed with the section", () => {
    // The warm plan spends a read when a reader looks like they are about to
    // open a SECTION. This one is behind a view, so warming it would fetch a
    // history for every reader who crossed the rail.
    const console_ = read("../components/MarketsConsole.tsx");
    const start = console_.indexOf("const SECTION_READS");
    const plan = console_.slice(start, console_.indexOf("\n};", start));
    assert.doesNotMatch(plan, /booksHistoryRoute/);
  });
});

describe("all four answers are drawn, not written", () => {
  it("the figure names each state and never collapses them", () => {
    for (const state of ["unavailable", "unconfigured", "ok"]) {
      assert.ok(figure.includes(`"${state}"`), `the figure does not distinguish the ${state} state`);
    }
    // The empty branch is the one a demo deployment meets, and it says what the
    // tape DOES hold rather than only what it does not.
    assert.match(figure, /history\.recorded\.length/,
      "an unrecorded market is told the tape is empty and not what it holds instead");
  });

  it("every branch renders a Figure, so no state is a bare sentence", () => {
    // Four returns before the drawing, and each one is framed. An empty branch
    // that returned a `<p>` would be the grey-sentence defect this desk keeps
    // being reported for.
    const returns = (figure.match(/return \(\s*\n\s*<Figure/g) ?? []).length;
    assert.ok(returns >= 3, `only ${returns} framed refusals; an empty state is a figure, not a paragraph`);
    assert.doesNotMatch(stripNonCode(figure), /<p className="console-empty"/,
      "a refusal here is drawn in the figure frame, not as a loose paragraph");
  });

  it("and one reading is refused rather than drawn as a flat line", () => {
    assert.match(figure, /points\.length < 2/);
  });
});

describe("the derived price says it is derived", () => {
  it("names the native bid and implied ask separately on the ribbon and readout", () => {
    assert.match(instrument, /data-mark="bid">YES bid, native/);
    assert.match(instrument, /data-mark="ask">YES ask, implied/);
    assert.match(instrument, /active\.implied_yes_ask/);
    assert.match(instrument, /Ask read off the NO rail/);
    assert.match(instrument, /Native bid → implied ask/);
  });

  it("gives the two series distinct labels, shapes, and accents", () => {
    assert.match(css, /\.bidPoint,[\s\S]*?\.askPoint\s*\{[^}]*var\(--series-1\)/);
    assert.match(css, /\.askPoint\s*\{[^}]*var\(--series-3\)[^}]*border-radius:\s*0[^}]*rotate\(45deg\)/s);
    assert.match(instrument, /className=\{styles\.bidPoint\}/);
    assert.match(instrument, /className=\{styles\.askPoint\}/);
  });
});

describe("the flipbook claims only what the selected snapshot holds", () => {
  it("keeps a missing side absent rather than turning it into zero", () => {
    assert.match(instrument, /bid == null \|\| ask == null \? "One side is absent, never zero\."/);
    assert.match(instrument, /ask == null \? "No NO bid behind the ask" : "Ask read off the NO rail"/);
    assert.match(instrument, /active\.best_yes_bid \?\? "—"/);
    assert.match(instrument, /toCenticents\(active\.best_yes_bid\)/);
    assert.match(instrument, /toCenticents\(active\.implied_yes_ask\)/);
    assert.match(instrument, /values\.bid != null && values\.ask != null \? <i className=\{styles\.spreadStitch\}/,
      "a spread band is drawn for a snapshot that did not measure both sides");
  });

  it("starts at the newest stable timestamp key and exposes every recorded position", () => {
    assert.match(instrument, /const keys = history\.points\.map\(\(point\) => `\$\{history\.ticker \?\? point\.ticker\}:\$\{point\.ts_ns\}`\)/);
    assert.match(instrument, /const \[requestedKey, setRequestedKey\] = useState<string \| null>\(null\)/);
    assert.match(instrument, /requestedKey != null && keys\.includes\(requestedKey\) \? requestedKey : keys\.at\(-1\)!/);
    assert.match(instrument, /min=\{0\} max=\{history\.points\.length - 1\} value=\{index\}/);
    assert.match(instrument, /onChange=\{\(event\) => setIndex\(Number\(event\.target\.value\)\)\}/);
    assert.match(instrument, /aria-valuetext=\{valueText\}/);
    assert.match(instrument, /aria-live="polite" aria-atomic="true"/);
  });

  it("offers bounded previous and next controls beside the range", () => {
    assert.match(instrument, /onClick=\{\(\) => setIndex\(index - 1\)\} disabled=\{index === 0\} aria-label="Previous recorded snapshot"/);
    assert.match(instrument, /type="range"/);
    assert.match(instrument, /onClick=\{\(\) => setIndex\(index \+ 1\)\} disabled=\{index === history\.points\.length - 1\} aria-label="Next recorded snapshot"/);
    assert.match(instrument, /Math\.max\(0, Math\.min\(keys\.length - 1, next\)\)/,
      "a direct history selection can escape the recorded range");
  });

  it("positions samples by their real timestamps rather than equal snapshot slots", () => {
    assert.match(instrument, /const firstTs = history\.points\[0\]\.ts_ns/);
    assert.match(instrument, /const lastTs = history\.points\.at\(-1\)!\.ts_ns/);
    assert.match(instrument, /\(point\.ts_ns - firstTs\) \/ Math\.max\(1, lastTs - firstTs\)/);
    assert.match(instrument, /const timeTicks = Array\.from\(\{ length: 5 \}/);
    assert.match(instrument, /timeTicks\.map\(\(value, tick\) => <span/);
    assert.match(instrument, /axisTimeLabel\(value, !sameDay\)/);
    assert.doesNotMatch(instrument, /const x = `\$\{\(pointIndex \/|const x = `\$\{\(i \/\s*\(?history\.points\.length/,
      "the ribbon reverted to evenly spaced snapshots and erased polling gaps");
  });

  it("uses one full-ribbon pointer target while the scrubber owns keyboard access", () => {
    assert.match(instrument, /role="img" aria-label=\{`[^`]*history\.points\.length[^`]*Snapshot control below/);
    assert.match(instrument, /onPointerDown=\{inspectPointer\}/);
    assert.match(instrument, /const targetTs = firstTs \+ \(lastTs - firstTs\) \* ratio/);
    assert.match(instrument, /Math\.abs\(history\.points\[pointIndex\]\.ts_ns - targetTs\)/);
    assert.match(instrument, /className=\{styles\.historyPoint\} data-selected=\{pointIndex === index \? true : undefined\} aria-hidden="true"/);
    assert.doesNotMatch(instrument, /<button[^>]*className=\{styles\.historyPoint\}/,
      "overlapping plotted marks became separate pointer targets again");
  });
});

describe("the snapshot arithmetic stays on the contract's fixed-point grid", () => {
  it("derives spread and the visible price window from centicents", () => {
    assert.match(instrument, /fromCenticents\(ask - bid\)/);
    assert.match(instrument, /priceWindow\(parsed\.flatMap\(\(point\) => \[point\.bid, point\.ask\]\)\)/);
    assert.match(instrument, /verticalPosition\(values\.bid, low, high\)/);
    assert.match(instrument, /verticalPosition\(values\.ask, low, high\)/);
    assert.doesNotMatch(stripNonCode(instrument), /\.toFixed\(|<Plot|linearScale|priceExtent/);
  });
});
