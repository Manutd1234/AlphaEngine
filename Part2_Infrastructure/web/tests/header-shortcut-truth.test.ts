/**
 * Digit shortcuts cover ten positions, while the header now has eleven tabs.
 * The eleventh remains a normal tab and command; it must never wear an Alt+11
 * label, because no keyboard event can produce that chord.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NAV_ITEMS } from "../lib/workspace-nav";
import { readSource } from "./helpers/source-files";

const commands = readSource("lib/workspace-commands.ts");
const shortcuts = readSource("lib/use-tab-shortcuts.ts");
const commandBar = readSource("components/header/CommandBar.tsx");
const overlay = readSource("components/header/ShortcutsOverlay.tsx");
const tour = readSource("lib/workspace-tour.ts");
const account = readSource("components/header/AccountChip.tsx");

describe("header shortcut copy never advertises a dead eleventh digit", () => {
  it("records the geometry: eleven tabs but only ten digit chords", () => {
    assert.equal(NAV_ITEMS.length, 11);
    assert.match(shortcuts, /digit === 0 \? 9 : digit - 1/);
    assert.match(shortcuts, /There is no digit chord for[\s\S]*eleventh workspace/);
  });

  it("omits the hotkey only where no real chord exists", () => {
    assert.match(commands, /hotkey: index < 10 \? `Alt\+\$\{index === 9 \? 0 : index \+ 1\}` : undefined/);
    assert.doesNotMatch(commands, /hotkey: `Alt\+\$\{index === 9 \? 0 : index \+ 1\}`/);
  });

  it("states the ten-key limit and the Diffusion alternative on screen", () => {
    assert.match(commandBar, /Alt\+1–9, then Alt\+0 opens the first ten; Diffusion is here in the palette/);
    assert.match(overlay, /Jump to the first ten workspaces; open Diffusion from the palette/);
    assert.match(overlay, /The eleven-stop reviewer tour/);
    assert.match(tour, /The eleven-stop reviewer tour/);
    assert.doesNotMatch(overlay, /eight-stop reviewer tour|eight workspaces/);
  });
});

describe("header geometry prose follows the shipped utility floor", () => {
  it("describes the Account placeholder as 40px wherever it states the norm", () => {
    assert.match(account, /min-h-\[40px\]/);
    assert.match(account, /40px of height is the row's norm/);
    assert.doesNotMatch(account, /min-h-\[32px\]|32px of height is the row's norm/);
  });
});
