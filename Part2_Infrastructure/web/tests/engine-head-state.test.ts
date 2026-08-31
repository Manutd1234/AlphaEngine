/**
 * The engine's read-state panel, and the two rules that keep it in the head.
 *
 * "format the recorded so far, polling, real budget and coherence solver in a
 *  table and move it to the top right corner where there is a lot of space"
 * "Move the Exchange reachable / Fixed-point schema / Recorder running / no
 *  order path row above to the top right corner"
 *
 * Both rows moved out of `StatusPane`'s foot and into `EngineStatePanel`. The
 * chips and the bounded Engine detail disclosure render together through
 * `PageHead`'s `actions` slot. Three things
 * about that are load-bearing and none of them is visible in any one file,
 * which is what this suite is for.
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
    // THE PANEL WENT BACK INTO ONE SLOT on 2026-08-26, and the reason is a
    // reader looking at the result of the last move: "move the entire stuff in
    // the attachment to the empty space at the top right which i have circled".
    //
    // The 2026-08-25 shape split it — chips in `PageHead`'s `actions`, the facts
    // table in its `children`, which render after `</header>` and therefore at
    // the head's full width. That is what left the head's right half empty, and
    // it is what this reunites: both halves ride `actions` now, and the head's
    // right slot is a COLUMN rather than a full-width row.
    //
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.match(source, /<div className="coh-topbar">\s*<PageHead/,
        `${file} does not wrap its head in the top-bar box`);
      if (file.endsWith("MarketsConsole.tsx")) {
        assert.match(source, /actions=\{\s*<MarketsEngineStatus/,
          `${file} does not open its head's right slot on the Markets two-row status`);
      } else {
        assert.match(source, /actions=\{\s*<EngineTopbarStatus/,
          `${file} does not use the shared two-row engine status`);
        assert.doesNotMatch(source, /<EngineChips\b/,
          `${file} still uses the retired Proofs-only chip grouping`);
      }
      assert.match(source, /detail=\{\s*<EngineStatePanel\b/,
        `${file} does not place Engine detail in the page head's status row`);

      // `PageHead` takes no children on either engine tab, which is the other
      // half of the same claim: nothing renders after `</header>` by accident.
      assert.doesNotMatch(source, /<\/PageHead>/,
        `${file} still passes PageHead children, which render at the head's full width`);
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

  it("an absence in that slot is reported once, not twice", () => {
    // BOTH HALVES SHARE ONE COLUMN NOW, twenty pixels apart, so both printing
    // "Asking the engine how it is…" reads as a stutter rather than as a state.
    // It was survivable while the chips were in the head and the table was
    // under it; it is not now. Seen at a viewport, not in a diff.
    //
    // The chips keep the sentence — they are first in the slot and they are
    // what a reader looks at for engine state. The panel renders nothing until
    // it has a table to render, which is NOT a hidden empty result: the
    // absence is reported, by the sibling, in the same words, once. Same
    // argument the head's metric tiles retired under.
    const panel = strip(read("../components/coherence/EngineStatePanel.tsx"));
    const topbar = panel.slice(
      panel.indexOf("export function EngineTopbarStatus"),
      panel.indexOf("export default function"),
    );
    const table = panel.slice(panel.indexOf("export default function"));
    assert.match(topbar, /word: "Reading exchange", value: "awaiting"/,
      "the shared top bar no longer says what it is waiting for");
    assert.match(topbar, /word: "Exchange unavailable", value: error/,
      "the shared top bar no longer reports a failed status read");
    assert.doesNotMatch(table, /Asking the engine how it is/,
      "the facts table prints the sentence its slot-mate already prints");
    assert.doesNotMatch(table, /could not report its own state/,
      "the facts table prints the failure its slot-mate already prints");
    assert.match(table, /if \(!status\) return null;/,
      "the facts table has no early return, so it renders a frame with nothing in it");
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

  it("both tabs derive reachability from the shared status once", () => {
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.doesNotMatch(source, /hosts\[0\]\?\.host/,
        `${file} re-derives host status outside the shared top bar`);
    }
    const panel = strip(read("../components/coherence/EngineStatePanel.tsx"));
    const topbar = panel.slice(
      panel.indexOf("export function EngineTopbarStatus"),
      panel.indexOf("export default function"),
    );
    assert.match(topbar, /status\?\.hosts\.some\(\(host\) => host\.reachable\)/,
      "the shared top bar no longer derives exchange reachability");
    assert.match(topbar, /word=\{status \? \(reachable \? "Exchange reachable" : "Exchange unreachable"\) : "Exchange pending"\}/,
      "reachable, unreachable and pending exchange states are no longer distinct");
  });

  it("StatusPane keeps a live halt visible without restoring either removed disclosure", () => {
    const pane = read("../components/coherence/StatusPane.tsx");
    const source = strip(pane);
    assert.match(source, /Trading is paused on \{halted\.length\}/,
      "a real halt has no concise status evidence");
    assert.doesNotMatch(source, /return null|<details|<table|status\.notes/,
      "a removed shard or gateway-note disclosure returned");
    assert.doesNotMatch(strip(pane), /coh-status__chips/,
      "the chip row is supposed to be in the head now");
  });

  it("keeps routine engine detail on demand while surfacing only a live halt", () => {
    const panel = strip(read("../components/coherence/EngineStatePanel.tsx"));
    assert.match(panel, /from "@\/components\/ui\/sheet"/,
      "routine engine detail has no bounded disclosure");
    assert.match(panel, /<StatusPane status=\{status\}/,
      "the on-demand engine detail dropped the compact live-halt notice");
    assert.match(panel, /<SheetTrigger asChild>/,
      "routine status is still permanently appended to every Markets and Proofs route");

    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.match(source, /status\.data\?\.state === "ok" && status\.data\.shards\.some\(\s*\(shard\) => !shard\.exchange_active \|\| !shard\.trading_active,?\s*\)/,
        `${file} can mistake fallback shard data for an actionable live halt`);
      assert.doesNotMatch(source, /\{\s*(?:live && )?status\.data && \(\s*<div className="coh-console__status">/,
        `${file} still appends routine status beneath every analytical view`);
    }
  });
});

describe("the shared live rows cannot reflow or escape the heading", () => {
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

  const topbar = rules.find((rule) =>
    rule.selector.trim() === ".coherence-plane .engine-topbar-status");
  const changingValues = rules.find((rule) =>
    rule.selector.includes("engine-topbar-status :is(.coh-live__updated, .coh-live__next) .coh-chip__value"));

  it("the two ticking values reserve the same tabular width", () => {
    assert.ok(changingValues, "Updated and Next read have no stable value reservation");
    assert.match(changingValues.body, /inline-size:\s*\d+ch/,
      "the ticking clock/countdown needs a text-relative reservation");
    assert.match(changingValues.body, /text-align:\s*end/,
      "shorter live values no longer align inside their reservation");
  });

  it("authors two wrapping rows inside one shrinkable status grid", () => {
    assert.ok(topbar, "the shared engine top bar declares no grid");
    assert.match(topbar.body, /display:\s*grid/);
    assert.match(topbar.body, /min-inline-size:\s*0/,
      "the shared status grid can enlarge the page-heading track");
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
    const row = rules.find((rule) =>
      rule.selector.trim() === ".coherence-plane .engine-topbar-status__row");
    assert.ok(row, "the two shared status rows declare no rule");
    assert.match(row.body, /min-inline-size:\s*0/);
    assert.match(row.body, /flex-wrap:\s*wrap/,
      "a row that cannot wrap inside itself pushes past the card at a narrow width");
  });

  it("the head's right slot carries the detail control without creating a strip", () => {
    // WHAT IAN CIRCLED. `.page-heading__copy` is capped at 58ch above 1121px, so
    // the head has roughly a thousand pixels of free width to the right of the
    // title — and `flex: 1 1 100%` on this slot was what stopped anything ever
    // reaching it. A basis of 100% is a full-width ROW by definition, whatever
    // is in it, so the check is on the basis rather than on the contents.
    //
    // The floor is a real number and not a round one: the chips' two declared
    // groups measure about 620px (venue) and 826px (desk, including a 49ch
    // stamp), so a slot that can be squeezed under ~30rem puts a chip on a line
    // of its own and the arithmetic in `14v`'s comment stops holding.
    const slots = rules.filter((rule) =>
      rule.selector.trim() === ".coherence-plane .page-heading__actions");
    assert.equal(slots.length, 1, "the actions slot is declared more than once");
    const basis = slots[0].body.match(/flex:\s*([^;]+)/);
    assert.ok(basis, "the actions slot declares no flex, so it is sized by the base sheet");
    assert.doesNotMatch(basis[1], /100%/,
      "a 100% basis is a full-width row; the head's right half stays empty behind it");
    assert.match(basis[1], /\d+rem/,
      "the slot needs a basis in rem so it steps with the reader's Text-size preference");

    const inSlot = rules.filter((rule) =>
      rule.selector.split(",").some((part) => part.includes("page-heading__actions") && part.includes("coh-headstate")));
    assert.equal(inSlot.length, 1,
      "Engine detail must have one shared placement rule inside the head actions");
    assert.match(inSlot[0].body, /flex:\s*0 0 auto/);
    assert.match(inSlot[0].body, /margin-inline-start:\s*auto/,
      "Engine detail no longer holds the venue row's top-right edge");
    const strip = rules.filter((rule) =>
      rule.selector.trim() === ".coherence-plane .coh-topbar .coh-headstate");
    assert.equal(strip.length, 0, "Engine detail regressed to a dedicated strip below the head");
  });

  it("the facts table is a grid about its shape, not about five", () => {
    // `grid-auto-flow: column` was right while the table spanned the whole head:
    // five metrics across ~1,450px is 290px a cell. In a ~1,000px column it is
    // 200px, and "63,930 snapshots across 4,126 markets" wraps four lines deep.
    //
    // `auto-fit` over a `minmax` floor keeps the property the flow rule was
    // chosen for — the rule is about the SHAPE, so a sixth metric joins it
    // rather than silently starting a second row under a rule that says five —
    // while letting the column decide how many fit.
    const grid = rules.find((rule) =>
      rule.selector.trim() === ".coherence-plane .coh-facts--tabled");
    assert.ok(grid, "the facts table declares no grid");
    assert.doesNotMatch(grid.body, /grid-auto-flow:\s*column/,
      "five in a row does not fit the head's right column; it fitted the head's full width");
    assert.match(grid.body, /repeat\(auto-fit,\s*minmax\(/,
      "the table needs a shape rule, not a count: auto-fit over a floor");
    // 14rem, since the strip: the box's inner width is 1,526px at 1600, so five
    // tiles hold in one row down to a ~1,124px strip; at 16rem the fifth
    // wrapped under four at 1440. Still a floor over auto-fit — never a count.
    assert.match(grid.body, /minmax\(14rem,/, "five tiles hold in one row only at a 14rem floor");
  });

  it("the panel wraps rather than clipping", () => {
    assert.ok(topbar);
    for (const banned of [/white-space:\s*nowrap/, /text-overflow:\s*ellipsis/, /overflow:\s*hidden/]) {
      assert.doesNotMatch(topbar.body, banned,
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

describe("below 1120 the slot's basis is auto, because in a column a rem basis is a height", () => {
  // SEEN IN A BROWSER, 2026-08-26, on both engine tabs: at 1120 the head was
  // 580px tall and at 900 it was 602, with the two chip rows spread through
  // 480px of white. `12` stacks `.page-heading` into a column at that width,
  // and the slot's `flex: 1 1 30rem` — right beside the title, where the main
  // axis is horizontal — becomes a HEIGHT of 30rem once the main axis turns
  // vertical. The 30rem stays where it is measured for; the column gets its
  // own basis.
  const desk = read("../app/globals/12-workspace-standardisation.css");
  const engine = read("../app/globals/14v-engine-head-state.css");

  it("the desk really does stack the head into a column there", () => {
    const at = desk.indexOf("@media (max-width: 1120px)");
    assert.ok(at !== -1, "12 no longer has a 1120 block — re-derive this");
    const block = desk.slice(at, desk.indexOf("\n}\n", at));
    assert.match(block, /\.page-heading \{[^}]*flex-direction: column/,
      "the head no longer stacks at 1120, so the basis is a width again and this override is dead");
  });

  it("the engine override gives the stacked slot a content-sized basis", () => {
    const at = engine.indexOf("@media (max-width: 1120px)");
    assert.ok(at !== -1, "14v no longer has a 1120 block");
    const block = engine.slice(at);
    const rule = block.match(/\.coherence-plane \.page-heading \.page-heading__actions \{([^}]*)\}/);
    assert.ok(rule, "the 1120 override for the slot is gone");
    assert.match(rule[1], /width:\s*100%/, "the stacked slot no longer takes the row");
    assert.match(rule[1], /flex:\s*0 0 auto/,
      "the stacked slot keeps its 30rem basis, which is a 480px height once the head is a column");
  });
});
