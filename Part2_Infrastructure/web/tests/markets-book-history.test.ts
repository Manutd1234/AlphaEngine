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
 *  3. THE IMPLIED ASK IS NAMED AS DERIVED wherever it is drawn. A dashed line
 *     and a `<title>` saying which side it was read off is the difference
 *     between a chart of two quotes and a chart of one quote and an inference.
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
  it("the ask is dashed and named as derived, and the bid is not", () => {
    assert.match(figure, /coh-book-tape__ask/);
    // The two titles this replaced named the LINES, and a `<title>` is a
    // native tooltip — mouse-only. Since 2026-08-26 the figure declares
    // `sharedX`, so the names are the crosshair's row labels, read beside the
    // numbers they belong to and reachable from a keyboard; a title left
    // beside a shared axis would make both readouts interactive
    // (`engine-crosshair.test.ts`). RAW source, because these are string
    // literals and `stripNonCode` blanks them.
    assert.doesNotMatch(stripNonCode(figure), /<title>/,
      "a line carries a title again, so the figure has two readouts");
    assert.match(figure, /label: "Implied YES ask"/);
    assert.match(figure, /label: "Best YES bid"/);
    // And HOW the offer is derived is a fact about the series, not about any
    // one read, so it moved to the notes rather than into a row that changes
    // with the cursor. Losing it entirely is what this assertion refuses.
    assert.match(figure, /a dollar less the best NO bid/,
      "nothing says the offer is derived, so a dashed line is the only clue");
  });

  it("and the dash is in the sheet rather than on the element", () => {
    const css = read("../app/globals/14x-markets-frame.css");
    assert.match(css, /\.coh-book-tape__ask \{[^}]*stroke-dasharray/,
      "the derived line is not dashed, so it reads as a quote the venue sent");
  });
});

describe("the figure claims only what it drew", () => {
  it("a market with no NO bid on any read is not described as having two lines", () => {
    // FOUND IN THE BROWSER, against this desk's own tape. Every recorded read
    // of the market Books opens on had an unquoted NO side, so the implied-ask
    // series was empty — and the reading still said "the gap between the two
    // lines is the spread a position crosses". One line was drawn.
    assert.match(figure, /noAsk === points\.length/,
      "the reading does not branch on whether the offer series exists");
    assert.match(figure, /no implied offer to draw/);
    assert.match(figure, /noBid === points\.length/,
      "the mirror case — no YES bid on any read — is not distinguished");
  });

  it("and it counts the two sides apart, because they fail apart", () => {
    // "11 of 11 reads had one side unquoted" beside an unbroken bid line is a
    // footnote contradicting the drawing it qualifies.
    assert.match(figure, /const noBid = bids\.filter/);
    assert.match(figure, /const noAsk = asks\.filter/);
  });
});

describe("the axis draws prices a contract can carry", () => {
  it("a flat series is padded by a tick, not by half a dollar", () => {
    // `chart-kit`'s `extent` pads a degenerate range by ±0.5, which is right in
    // general and wrong here: a bid flat at 1.0000 came out on an axis running
    // 0.6000 to 1.4000, and 1.4000 is not a price this venue can quote. The
    // axis was drawing values that cannot exist beside values that do.
    assert.match(figure, /function priceExtent/);
    assert.doesNotMatch(figure, /\bextent\(/,
      "the general extent is back, so a flat price series gets a half-dollar axis again");
    // The VALUE, not just the function. Naming the helper and then padding by
    // half a dollar inside it passes a check that only asks whether the helper
    // exists — which is what the first version of this assertion did.
    const pad = /const pad = Math\.max\(\(hi - lo\) \* ([\d.]+), ([\d.]+)\);/.exec(figure);
    assert.ok(pad, "the pad is no longer a proportion of the range with a floor");
    assert.ok(Number(pad[2]) <= 0.05,
      `the flat-series pad is ${pad[2]} of a dollar; a tick is 0.01 and anything near half draws impossible prices`);
    assert.ok(Number(pad[1]) <= 0.25, `the proportional pad is ${pad[1]} of the range, which swamps the series`);
  });

  it("and the range never leaves the dollar a contract lives in", () => {
    assert.match(figure, /Math\.max\(0, lo - pad\)/);
    assert.match(figure, /Math\.min\(1, hi \+ pad\)/);
  });
});
