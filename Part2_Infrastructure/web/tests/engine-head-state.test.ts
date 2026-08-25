/**
 * The engine's read-state panel, and the two rules that keep it in the head.
 *
 * "format the recorded so far, polling, real budget and coherence solver in a
 *  table and move it to the top right corner where there is a lot of space"
 * "Move the Exchange reachable / Fixed-point schema / Recorder running / no
 *  order path row above to the top right corner"
 *
 * Both rows moved out of `StatusPane`'s foot and into `EngineStatePanel`, which
 * renders through `PageHead`'s existing `actions` slot. Three things about that
 * are load-bearing and none of them is visible in any one file, which is what
 * this suite is for.
 *
 * WHAT NO TEST HERE CAN DO: `npm test` is plain Node with no jsdom, no browser
 * and no layout engine, so every width below is read out of the sheet, never
 * observed. Whether 62ch is the right reservation, and whether the head grew
 * more than the strip's departure saved, are questions only a viewport answers.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { globalsCss, locateInGlobals } from "./globals-css";
import { cssRules } from "./globals-rules";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const strip = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

const CONSOLES = [
  "../components/CoherenceConsole.tsx",
  "../components/MarketsConsole.tsx",
] as const;

describe("the read-state sits in the head, once", () => {
  it("both engine consoles put the top bar in one box", () => {
    // THE PANEL SPLIT IN TWO on 2026-08-25, because the reader asked for the
    // table "below the header on the left side" and for the whole thing to read
    // as "one nice box for the top bar" — on both engine tabs.
    //
    // `PageHead` returns a FRAGMENT, its `<header>` then its `children`, so the
    // box has to wrap the ELEMENT: that is what puts the title, the chips and
    // the table inside one frame. The chips keep the head's right slot, where
    // the previous assertion wanted the whole panel, and the table goes in
    // `children`, which renders after `</header>` and before the section rail.
    //
    // The optional `.coh-headlive` wrapper survives and is still spelled out
    // rather than allowed as `<div[^>]*>`: Markets puts its poll controls under
    // the chips, and the point of naming it is that any OTHER component slipped
    // in front still fails.
    // BOTH consoles again. This loop was narrowed to Proofs for one commit
    // while `MarketsConsole.tsx` was being rewritten in another session, with a
    // note to widen it back the moment that file landed. It has.
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.match(source, /<div className="coh-topbar">\s*<PageHead/,
        `${file} does not wrap its head in the top-bar box`);
      // `\s*`, not `[\s\S]{0,400}?`. The wildcard was carried in while the two
      // consoles were being edited in parallel and it quietly gave up the
      // property the comment above claims: four hundred arbitrary characters
      // is room for a whole component, so "any OTHER component slipped in
      // front still fails" was no longer true of the regex asserting it.
      // Neither console needs it — Proofs opens `actions={` directly on the
      // chips and Markets on the named wrapper, and both are whitespace away.
      assert.match(source, /actions=\{\s*(?:<div className="coh-headlive">\s*)?<EngineChips/,
        `${file} does not put the chip row in PageHead's right slot`);
      assert.match(source, /<EngineStatePanel[\s\S]*?<\/PageHead>/,
        `${file} does not pass the facts table as PageHead children, so it cannot sit under the title`);
    }
  });

  it("and neither console draws the panel twice", () => {
    // The wrapper above makes room for a sibling, and the obvious wrong use of
    // that room is a second read-state. Pinned from the other side so the
    // relaxation cannot buy one.
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.equal((source.match(/<EngineStatePanel\b/g) ?? []).length, 1,
        `${file} renders more than one read-state panel`);
    }
  });

  it("neither console builds a metrics row beside the panel", () => {
    // The move was a MERGE. Three of the four head tiles said what three of the
    // chips say — Exchange/reachable, Solver, Order path — and moving the strip
    // up without retiring them would state six facts twice, twenty pixels
    // apart. `Families priced` is the one with no counterpart: it counts what
    // the universe read returned, which is a fact about the families rather
    // than about the engine reading them.
    for (const file of CONSOLES) {
      const source = strip(read(file));
      for (const retired of ["Exchange", "Solver", "Order path", "Books recorded", "Families priced"]) {
        assert.doesNotMatch(source, new RegExp(`label: "${retired}"`),
          `${file} still builds a "${retired}" tile beside the panel that carries it`);
      }
      assert.doesNotMatch(source, /metrics=\{/,
        `${file} still builds a metrics row for a single tile`);
    }
  });

  it("the hostname is printed once on each tab", () => {
    // The Proofs Exchange tile used to withhold the hostname BECAUSE the strip
    // at the foot carried it — "one figure printed twice on one screen is a
    // reader checking whether they are two measurements". Quotes printed it in
    // its tile note instead. Both tiles are gone; the chip is the one site.
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.doesNotMatch(source, /hosts\[0\]\?\.host/,
        `${file} prints the hostname the chip already carries`);
    }
    assert.match(strip(read("../components/coherence/EngineStatePanel.tsx")), /hosts\[0\]\?\.host/,
      "the chip is where the hostname lives now");
  });

  it("StatusPane keeps only what cannot fit in a header box", () => {
    const pane = read("../components/coherence/StatusPane.tsx");
    // The shard fold must still SELF-OPEN. A halted shard is a status, and a
    // status may never be hidden — this is the one fold on the desk that
    // decides for itself, and it is why the shard table did not move up.
    assert.match(pane, /open=\{halted\.length > 0\}/,
      "the shard fold no longer opens itself when a shard stops trading");
    assert.match(pane, /\$\{status\.notes\.length\}/,
      "the gateway notes fold lost the count in its summary");
    assert.doesNotMatch(strip(pane), /coh-status__chips/,
      "the chip row is supposed to be in the head now");
  });
});

describe("a ticking clock cannot reflow the heading row", () => {
  // COMMENT BODIES BLANKED BEFORE PARSING, and this is a trap rather than a
  // preference. `cssRules` takes everything between the previous `}` and the
  // `{` as the selector — comments included — so a rule preceded by a comment
  // that happens to MENTION another selector is found by a `.includes()` search
  // for it. That is not hypothetical: the head's own rules carry comments
  // naming the stamp pin and the actions slot, and both lookups below silently
  // matched the wrong rule and asserted against its body.
  //
  // Blanked to spaces rather than removed, newlines kept, so every index still
  // maps to the same file and line and `locateInGlobals` keeps telling the
  // truth about where a rule lives.
  const rules = cssRules(
    globalsCss.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")),
    locateInGlobals,
  );

  const reservation = rules.find((rule) =>
    rule.selector.includes(".page-heading__actions .coh-headchips"));
  // THE RESERVATION MOVED ONTO THE THING THAT TICKS on 2026-08-25, and this is
  // the selector that now carries it.
  const clock = rules.find((rule) =>
    rule.selector.includes(".coh-headchips .freshness-stamp"));

  it("the clock reserves its width in ch", () => {
    // `FreshnessStamp` re-renders every second and its string changes length,
    // and it sits in a `flex-end` row — so a content-sized stamp drags every
    // chip left of it once a second, beside a title that is not moving. Same
    // rule shape `page-status-book.test.ts` pins for the Portfolio strip.
    //
    // IT USED TO BE PINNED ON THE WHOLE CHIPS COLUMN, at 34ch, and that is why
    // this assertion moved rather than relaxed: a column narrow enough to be
    // stable was too narrow to hold the four chips and the clock on one line,
    // so they stacked five deep. Pinning the clock is the same guarantee at the
    // source — the chips are static, the only thing that changes width is
    // fixed, and nothing moves. Asserting it HERE rather than on the column is
    // what stops the fix being undone by dropping the width altogether.
    assert.ok(clock, "nothing reserves the clock's width, so it breathes and drags the chips with it");
    assert.match(clock.body, /min-width:\s*\d+ch/,
      "a ch reservation steps with the reader's Text-size preference; px does not");
  });

  it("and the rows it sits in wrap rather than overflowing", () => {
    // THE WRAPPERS ARE NOT BOXES ANY MORE. `PageHead` renders its own status
    // pill as a sibling of `actions`, so the chips can only share a line with
    // it if the wrappers between them are `display: contents` — and a box that
    // does not exist cannot carry a `max-width`. The constraint moved to the
    // things that are now the flex items: each declared row wraps inside
    // itself, and the slot holding them wraps too.
    assert.ok(reservation, "the chips wrapper declares no rule at all");
    assert.match(reservation.body, /display:\s*contents/,
      "the wrapper is a box again, so the status pill cannot share a line with the chips");
    // EXACTLY ONE rule for the slot, and that is half the assertion. Two rules
    // for one selector in two partials is how this sheet has drifted before,
    // and a `.includes()` lookup silently reads whichever comes first — which
    // is what sent this very check to the wrong rule while the declarations
    // were split across 14v and 14w.
    const slots = rules.filter((rule) =>
      rule.selector.trim() === ".coherence-plane .page-heading__actions");
    assert.equal(slots.length, 1,
      "the actions slot is declared more than once; merge them, or a later partial wins in silence");
    const slot = slots[0];
    assert.match(slot.body, /flex-wrap:\s*wrap/,
      "without this the declared rows run out of the card instead of taking a line");
    // DESCENDANT, not `>`. `display: contents` removes the wrappers' boxes but
    // reparents nothing, and a child combinator matches the DOM tree — so a `>`
    // here matches nothing at all and the rows wrap by luck. Asserted by shape
    // so the combinator cannot creep back.
    const row = rules.find((rule) =>
      rule.selector.includes(".page-heading__actions .coh-status__chips"));
    assert.ok(row, "the chip rows declare no rule");
    assert.match(row.body, /flex-wrap:\s*wrap/,
      "a row that cannot wrap inside itself pushes past the card at a narrow width");
    const breaks = rules.find((rule) => rule.selector.includes(".coh-headchips__desk"));
    assert.ok(breaks, "nothing forces the recorder row onto its own line");
    assert.doesNotMatch(breaks.selector, /page-heading__actions\s*>/,
      "a child combinator under `display: contents` matches nothing — the rows then wrap by luck");
  });

  it("the panel wraps rather than clipping", () => {
    assert.ok(reservation);
    // The CLOCK is exempt from `nowrap` and always was: `.freshness-stamp` sets
    // it in `13-warm-bright-pass.css` because a timestamp broken across two
    // lines is unreadable, and a reserved width means it never needs to wrap.
    // What may not clip is the row, which is where a chip would be lost.
    for (const banned of [/white-space:\s*nowrap/, /text-overflow:\s*ellipsis/, /overflow:\s*hidden/]) {
      assert.doesNotMatch(reservation.body, banned,
        "a fixed box that also clips hides the figure instead of wrapping it");
    }
  });

  it("the head gains no second height floor", () => {
    // `bookchrome-stability` holds `.page-heading` to no `min-height` but 0.
    // The floor belongs to the panel, so the head is still sized by its content.
    const heading = rules.filter((rule) =>
      rule.selector.split(",").some((part) => part.trim().endsWith(".page-heading")));
    for (const rule of heading) {
      const found = rule.body.match(/min-height:\s*([^;]+)/);
      assert.ok(found == null || found[1].trim() === "0",
        `${rule.where} gives .page-heading a height floor that rivals the chip's own arithmetic`);
    }
  });
});

describe("the panel's partial is scoped to both engine tabs", () => {
  const partial = read("../app/globals/14v-engine-head-state.css");

  it("names the shared plane and neither tab class", () => {
    // THE ONE THING TO GET RIGHT. `EngineStatePanel` renders in both consoles,
    // so a `.proofs-plane` scope would style Proofs and leave Quotes bare — and
    // `plane-scope.test.ts` would pass, because it asks whether a rule has a
    // render site reachable from that console and this one does. Green, and
    // half the desk unstyled.
    assert.match(partial, /\.coherence-plane/, "the panel's rules are unscoped");
    assert.doesNotMatch(strip(partial), /\.proofs-plane|\.markets-plane/,
      "a tab-scoped rule here styles one console and leaves the other bare");
  });

  it("declares no rung of its own", () => {
    // Every element in the panel already reads a size through 14q's prose and
    // furniture lists and 13's disclosure rule. A second declaration for a
    // selector that already has one is what `rung-single-declaration` refuses.
    assert.doesNotMatch(strip(partial), /font-size\s*:/,
      "14v declares a font-size; the ladder is 14q's to set");
  });
});
