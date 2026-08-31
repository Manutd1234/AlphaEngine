/**
 * One canonical loop drives every cross-workspace navigator.
 *
 * The header already owns the complete eleven-tab order, but the phone rail
 * used to freeze the first four entries into a second list while the footer
 * copied all eleven `nextId` edges by hand. Both copies were correct only until
 * the next tab landed. These checks make the registry's order executable and
 * require the compact and contextual navigators to consume that same cycle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NAV_ITEMS,
  nextWorkspaceView,
  previousWorkspaceView,
} from "../lib/workspace-nav";

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string) => readFileSync(join(here, "..", path), "utf8");

const bottomNav = read("components/WorkspaceBottomNav.tsx");
const footer = read("components/common/NextStepFooter.tsx");

describe("the canonical workspace cycle", () => {
  it("walks all eleven tabs once, wraps, and reverses without drift", () => {
    assert.equal(NAV_ITEMS.length, 11);

    const start = NAV_ITEMS[0].id;
    const walked: string[] = [];
    let view = start;
    for (let index = 0; index < NAV_ITEMS.length; index += 1) {
      walked.push(view);
      const next = nextWorkspaceView(view);
      assert.equal(previousWorkspaceView(next), view);
      view = next;
    }

    assert.deepEqual(walked, NAV_ITEMS.map((item) => item.id));
    assert.equal(view, start, "the decision loop does not close at Overview");
  });

  it("gives the phone navigator previous, current and next context for every tab", () => {
    assert.doesNotMatch(bottomNav, /THUMB_REACH/);
    assert.match(bottomNav, /previousWorkspaceView\(view\)/);
    assert.match(bottomNav, /nextWorkspaceView\(view\)/);
    assert.match(bottomNav, /aria-current="page"/);
    assert.match(bottomNav, /aria-haspopup="dialog"/);
  });

  it("derives the footer fallback from the same cycle instead of copied next ids", () => {
    assert.match(footer, /nextWorkspaceView\(currentView\)/);
    const start = footer.indexOf("const FLOW_MAP");
    const block = footer.slice(start, footer.indexOf("\n};", start));
    assert.doesNotMatch(block, /nextId:/);
  });
});
