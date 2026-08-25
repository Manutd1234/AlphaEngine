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
  it("both engine consoles pass the panel through the actions slot", () => {
    for (const file of CONSOLES) {
      const source = strip(read(file));
      assert.match(source, /actions=\{\s*<EngineStatePanel/,
        `${file} does not put the panel in PageHead's right slot`);
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
  const rules = cssRules(globalsCss, locateInGlobals);

  const reservation = rules.find((rule) =>
    rule.selector.includes(".page-heading__actions .coh-headstate"));

  it("the panel reserves its width in ch", () => {
    // `FreshnessStamp` re-renders every second inside this box and its string
    // changes length. `.page-heading__actions` is `flex: 0 0 auto`, so a
    // content-sized panel would move its own left edge once a minute beside a
    // title that is not moving. Same rule shape `page-status-book.test.ts` pins
    // for the Portfolio strip, and for the same reason.
    assert.ok(reservation, "the panel declares no width, so it breathes with the clock");
    assert.match(reservation.body, /width:\s*\d+ch/,
      "a ch reservation steps with the reader's Text-size preference; px does not");
    assert.match(reservation.body, /max-width:\s*100%/,
      "without this the reservation overflows the moment the head goes to one column");
  });

  it("the panel wraps rather than clipping", () => {
    assert.ok(reservation);
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
