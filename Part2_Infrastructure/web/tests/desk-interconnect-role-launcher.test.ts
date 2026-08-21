/**
 * The Overview's role launcher: seven cards, and nothing they do not use.
 *
 * Each card opens one desk role, and that is all it does. Six props were
 * declared on it that no control on the surface reads — a run handler and two
 * refresh callbacks among them, two of which were wired to no button at all.
 * A declared prop is a claim about what a component can do, and the Overview
 * passing them was a second copy of that claim; both are pinned gone here,
 * because this is the shape that grows back the next time somebody wonders
 * whether the launcher should also refresh something.
 *
 * The second block is about the words on the button. A card's action names the
 * tab it opens, in the header's own vocabulary, and it is derived from
 * `NAV_ITEMS` rather than pinned to seven strings so a tab rename fails here
 * instead of quietly leaving a card pointing at a name the desk no longer uses.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NAV_ITEMS } from "../components/WorkspaceHeader";
import { overview, roleCards } from "./helpers/desk-shell-sources";

describe("the role launcher takes no prop it never reads", () => {
  const dead = ["onRun", "running", "researchStale", "onRefreshBook", "bookRefreshing", "onRefreshHealth"];

  it("declares neither the run handler nor the two refresh callbacks", () => {
    // Two of these were wired to no control at all: the launcher has one
    // button per card and always has.
    for (const prop of dead) {
      assert.ok(!roleCards.includes(prop), `RoleCards still declares ${prop}`);
    }
  });

  it("and the overview stops passing them", () => {
    const start = overview.indexOf("<RoleCards");
    assert.notEqual(start, -1, "the launcher is not rendered");
    const element = overview.slice(start, overview.indexOf("/>", start));
    for (const prop of dead) {
      assert.ok(!element.includes(`${prop}=`), `WorkspaceOverview still passes ${prop}`);
    }
  });

  it("keeps the seven navigation buttons untouched", () => {
    assert.match(roleCards, /className="role-card__actions"/);
    assert.match(roleCards, /onClick=\{\(\) => onNavigate\(card\.view\)\}/);
    assert.equal(
      [...roleCards.matchAll(/view:\s*"[a-z]+",\s*\n\s*code:/g)].length,
      7,
      "the overview no longer launches seven desk roles",
    );
  });
});

/**
 * A role card's button names the tab it opens, in the header's own words.
 *
 * "Open Data Ops →" pointed at a tab the header labels "Data" — six of the
 * seven cards matched their nav label exactly and one did not, so a reader
 * following it went looking for a tab that is not there. `NextStepFooter`
 * carries a comment warning against precisely this ("Next step in Data
 * operations would send them looking for a tab that reads Data") and nothing
 * enforced it on this surface.
 *
 * Derived from NAV_ITEMS rather than pinned to seven strings, so a tab rename
 * fails here instead of quietly leaving a card pointing at the old name.
 */
describe("a role card names the tab it opens", () => {
  const cards = [...roleCards.matchAll(/view:\s*"([a-z]+)",[\s\S]*?action:\s*"([^"]+)"/g)]
    .map(([, view, action]) => ({ view, action }));

  it("finds all seven cards", () => {
    assert.equal(cards.length, 7, "the card regex stopped matching RoleCards' shape");
  });

  for (const { view, action } of cards) {
    it(`${view} — the action reads as the header labels it`, () => {
      const nav = NAV_ITEMS.find((item) => item.id === view);
      assert.ok(nav, `no nav item for view "${view}"`);
      assert.equal(
        action,
        `Open ${nav.label} \u2192`,
        `the card says "${action}" but the header calls that tab "${nav.label}"`,
      );
    });
  }
});
