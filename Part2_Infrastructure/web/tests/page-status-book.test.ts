/**
 * Which book is on screen is said in the page heading, once, in every state.
 *
 * WHAT MOVED, AND WHY IT HAD TO MOVE WHOLE
 * ---------------------------------------------------------------------------
 * The live-book line — a dot, "Live book", then "Authoritative risk gateway
 * live; last refresh 23:05:09, live-pushed" — rendered as its own
 * full-width row BELOW the four summary chips on Portfolio and Risk. That put
 * the least conditional fact on the page furthest from the title it qualifies,
 * under the chips it captions, and it cost a row of vertical space on two tabs
 * while `.page-heading__actions` — the heading's row-1 right slot, beside the
 * title and above the chips — rendered empty on both, because neither tab
 * passed `status` or `actions`.
 *
 * It had three readings, not one: live, stale and sandbox. Moving only the
 * live one would have put one state in the heading and the other two in a row
 * below it, so the desk would contradict itself on the toggle. All three moved
 * together, into one component (`BookStatus`), and this suite is what keeps
 * them together.
 *
 * WHY `actions` AND NOT `status`
 * ---------------------------------------------------------------------------
 * `PageHead`'s own docblock nominates `status` for a status word, and that is
 * the slot this would have used. `PageStatus.label` is a `string` and
 * `.page-status` is a `white-space: nowrap` pill, so the sandbox reading — a
 * full sentence with a bolded lead, which globals.css says may never be made
 * subtle — would have had to be truncated into it, or `PageStatus` widened to
 * take a node. Widening the shared type to fit one caller is the worse of the
 * two, so the strip went into `actions`, which already takes a node. The last
 * test below pins `PageStatus` at its unwidened shape so that stays a choice
 * rather than a thing that quietly happened later.
 *
 * Read against source, in the house style: `npm test` has no DOM and no layout
 * engine, so every geometric claim here is derived from the stylesheet rather
 * than observed in a browser.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { read } from "./helpers/cockpit-sources";

/** Comment bodies out, so prose that names the old wording is not read as it. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const chrome = code(read("components/portfolio/BookChrome.tsx"));
const panels = code(read("components/workspace/WorkspacePanels.tsx"));

/** The three readings, in the order the component renders them. */
const STRIP_LABELS = ["Sandbox book (generated)", "Last known book", "Live book"];

// --------------------------------------------------------------------------
// 1. All three readings are in the heading, and nowhere else
// --------------------------------------------------------------------------

describe("the book's status line lives in the page heading", () => {
  const statusAt = chrome.indexOf("export function BookStatus");
  const banners = chrome.slice(chrome.indexOf("export function BookChrome"), statusAt);
  const status = chrome.slice(statusAt, chrome.indexOf("export function BookSourceControl"));

  it("both components actually loaded", () => {
    assert.ok(statusAt > 0, "BookStatus went — the heading has nothing to render");
    assert.ok(banners.length > 300 && status.length > 500, "the slice anchors moved");
  });

  it("the standalone row below the summary chips is gone", () => {
    // The defect this suite exists for. `BookChrome` is mounted above the
    // section rail on both tabs and keeps the two banners that must interrupt;
    // a `.portfolio-statusbar` back in it means the status line is being drawn
    // in the old place as well as the new one, and the desk states the same
    // fact twice a scroll apart.
    assert.doesNotMatch(banners, /portfolio-statusbar/,
      "the status strip is back in BookChrome, so it renders below the chips as well as in the heading");
    assert.match(banners, /className="banner error"/, "the halt banner left with it");
    assert.match(banners, /className="banner warn"/, "the stale banner left with it");
  });

  it("live, stale and sandbox all render, so the toggle changes words and not height", () => {
    // Three strips, one slot. The live path used to render nothing at all,
    // and pressing Sandbox inserted a block that shifted everything under it.
    const strips = status.match(/className="portfolio-statusbar/g) ?? [];
    assert.equal(strips.length, 3, "one of the three readings lost its strip");
    assert.match(status, /\{sandbox && \(/);
    assert.match(status, /\{!sandbox && isStale && \(/);
    assert.match(status, /\{!sandbox && !isStale && \(/);
  });

  it("each reading names itself in words, not by the dot alone", () => {
    const labels = [...status.matchAll(/<i aria-hidden \/>\s*([^<\n]+?)\s*\n/g)].map((m) => m[1]);
    assert.deepEqual(labels, STRIP_LABELS);
  });

  it("the live reading still names the gateway and the refresh time", () => {
    assert.match(status, /\{gatewayLabel\}; last refresh \{lastRefreshLabel\}/);
    assert.match(status, /transportLabel\(streamState\)/,
      "the live strip stopped saying how the last change arrived");
  });

  it("neither book workspace renders it a second time", () => {
    for (const file of ["components/PortfolioWorkspace.tsx", "components/RiskWorkspace.tsx"]) {
      assert.doesNotMatch(code(read(file)), /BookStatus/,
        `${file} renders the status line in the page body as well as the heading`);
    }
  });
});

// --------------------------------------------------------------------------
// 2. Both tabs get it, from the one call site that owns the heading
// --------------------------------------------------------------------------

describe("Portfolio and Risk say it in the same place", () => {
  /** One panel's JSX: from its `<section id=…>` to the next one. */
  const panel = (id: string) => {
    const from = panels.indexOf(`id="panel-${id}"`);
    assert.ok(from > 0, `the ${id} panel went`);
    const rest = panels.slice(from + 10);
    const to = rest.indexOf('id="panel-');
    return to < 0 ? rest : rest.slice(0, to);
  };

  for (const [id, tab] of [["portfolio", "<PortfolioTab"], ["risk", "<RiskTab"]] as const) {
    it(`${id} hands the status line to its heading, not to its body`, () => {
      const block = panel(id);
      const passed = block.indexOf("actions={<BookStatus view={book} />}");
      const workspace = block.indexOf(tab);
      assert.ok(passed > 0, `the ${id} heading is not passed the book's status line`);
      assert.ok(workspace > 0, `the ${id} panel lost its workspace`);
      assert.ok(passed < workspace,
        `the ${id} status line moved out of <WorkspaceIntro> and into the workspace below it`);
    });
  }

  it("both tabs pass the identical node, because they are one snapshot", () => {
    // Portfolio and Risk read the same book asked a different question. A
    // reader who saw "Live book" on one tab and an empty band on the other
    // would have to guess which of the two was current.
    const uses = panels.match(/actions=\{<BookStatus view=\{book\} \/>\}/g) ?? [];
    assert.equal(uses.length, 2, "exactly one of the two book tabs carries the status line");
  });
});

// --------------------------------------------------------------------------
// 3. The three words are decided once
// --------------------------------------------------------------------------

describe("the caption and the status line cannot drift apart again", () => {
  /*
   * They already had. The strip's stale reading was "Stale portfolio
   * snapshot" while `PortfolioWorkspace`'s card caption, built from the same
   * two booleans, said "Last known book" — so one snapshot carried two names
   * a scroll apart, and neither file knew about the other. The caption's
   * wording won: it says what the reader HAS, where the strip's said only
   * what went wrong, and the stale BANNER above already carries the fault.
   */
  const helper = chrome.slice(chrome.indexOf("export function bookStateLabel"));
  const body = helper.slice(0, helper.indexOf("}"));

  it("the helper returns the three words in sandbox, stale, live order", () => {
    const words = [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(words, STRIP_LABELS);
  });

  it("the workspace caption calls it instead of restating it", () => {
    const workspace = code(read("components/PortfolioWorkspace.tsx"));
    assert.match(workspace, /const bookLabel = bookStateLabel\(Boolean\(book\.sandbox\), isStale\)/);
    assert.doesNotMatch(workspace, /"Stale portfolio snapshot"|"Last known book"/,
      "the three words are spelled out again in the workspace, which is how they drifted last time");
  });

  it("the retired stale wording is gone from the desk", () => {
    assert.doesNotMatch(chrome, /Stale portfolio snapshot/,
      "the strip went back to naming the fault rather than what the reader has");
  });
});

// --------------------------------------------------------------------------
// 4. The honesty declaration survives the move
// --------------------------------------------------------------------------

describe("the sandbox declaration is still unmissable in its new slot", () => {
  it("it is on screen at rest, not folded behind a disclosure", () => {
    const at = chrome.indexOf("These positions do not exist.");
    assert.ok(at > 0, "the sandbox declaration was deleted by the move");
    const before = chrome.slice(0, at);
    const opened = (before.match(/<details/g) ?? []).length;
    const closed = (before.match(/<\/details>/g) ?? []).length;
    assert.equal(opened, closed, "the sandbox declaration is inside a <details>");
  });

  it("it keeps the warn rail and the tint that stop it reading as chrome", () => {
    assert.match(chrome, /portfolio-statusbar is-sandbox/);
    assert.match(globalsCss, /\.portfolio-statusbar\.is-sandbox \{[\s\S]*?border-left: 3px solid/);
  });

  it("the heading slot wraps it rather than clipping it", () => {
    // A `text-overflow: ellipsis` or a `nowrap` on this box would truncate the
    // one marker globals.css says must never be subtle. The strip is allowed
    // to grow a line instead; that is what `width` rather than `height` buys.
    const rule = globalsCss.match(/\.page-heading__actions \.portfolio-statusbar \{([\s\S]*?)\}/);
    assert.ok(rule, "the heading's status-strip rule went, so the strip is unsized in its new slot");
    assert.doesNotMatch(rule[1], /white-space: nowrap|text-overflow: ellipsis|overflow: hidden/);
  });
});

// --------------------------------------------------------------------------
// 5. A ticking clock does not move the heading
// --------------------------------------------------------------------------

describe("the refresh time cannot reflow the row it now sits in", () => {
  it("the box is a fixed width, not one sized to its content", () => {
    /*
     * The reservation, and the reason it is `width` and not `max-width`. The
     * timestamp re-renders about once a second on a live desk. Tabular figures
     * hold the SECONDS still — every digit is one advance — but the string
     * itself changes length when the hour rolls from 9 to 10, and a box sized
     * to its content would breathe once an hour beside the title. A fixed
     * width cannot: the glyphs change inside edges that do not move.
     */
    const rule = globalsCss.match(/\.page-heading__actions \.portfolio-statusbar \{([\s\S]*?)\}/);
    assert.ok(rule, "the heading's status-strip rule went");
    assert.match(rule[1], /width: \d+ch;/,
      "the strip lost its width reservation, so the clock resizes it");
    assert.match(rule[1], /max-width: 100%;/,
      "without this the reserved width overflows the heading once the layout goes to one column");
    assert.match(rule[1], /margin-bottom: 0;/,
      "the strip kept the bottom margin it needed as a standalone row");
  });

  it("the timestamp is set in tabular figures", () => {
    // `.num` is the mechanism the claim above rests on: mono family AND
    // `font-variant-numeric: tabular-nums`. If either leaves, a changing digit
    // changes width and the seconds start jittering inside the reserved box.
    assert.match(globalsCss, /\.num \{[\s\S]*?font-variant-numeric: tabular-nums;/);
    const status = chrome.slice(chrome.indexOf("export function BookStatus"));
    assert.match(status, /<span className="num">\{gatewayLabel\}/);
    assert.match(status, /<span className="num">Last successful refresh/);
  });
});

// --------------------------------------------------------------------------
// 6. The shared header type was not widened to fit this caller
// --------------------------------------------------------------------------

describe("PageStatus stayed the shape it was", () => {
  it("its label is still a plain string", () => {
    const head = code(read("components/workspace/PageHead.tsx"));
    const shape = head.match(/export interface PageStatus \{([\s\S]*?)\}/);
    assert.ok(shape, "PageStatus went");
    assert.match(shape[1], /label: string;/,
      "PageStatus.label was widened to a node to fit the book's status line — "
        + "the strip goes in `actions` precisely so this stays a string");
  });
});
