/**
 * Two things that make a tab switch cost more than it should.
 *
 * Neither is visible from a rendered page, and neither fails anything today.
 * They are the kind of cost that arrives as "the desk got slower this month"
 * with no commit to point at — so they are pinned where they can be read.
 *
 * WHY NOW. The declutter pass ahead of this adds figures to five tabs that stay
 * MOUNTED behind `hidden` once visited. Every one of them then re-renders on
 * any page-level state change, so the floor has to be defended before the DOM
 * grows rather than measured after it.
 *
 * DERIVED, NOT OBSERVED, for the usual reason — `npm test` has no DOM. What a
 * source assertion CAN hold is that the two lists agree and that the store
 * notifies by key. `scripts/tab-switch-measure.mjs` is the other half and
 * reports click→paint, click→idle and blocking per tab at 4× CPU throttle.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

const lazy = read("../components/workspace/lazy-panels.tsx");
const prefetch = read("../lib/use-console-prefetch.ts");
const series = read("../lib/coherence/use-live-series.ts");

describe("the sources these assertions read were actually loaded", () => {
  for (const [name, source] of [["lazy-panels", lazy], ["use-console-prefetch", prefetch], ["use-live-series", series]] as const) {
    it(`${name} is non-empty`, () => assert.ok(source.trim().length > 300, `${name} read as empty`));
  }
});

describe("every chunk-split console is warmed before it is clicked", () => {
  it("warms exactly the consoles that are loaded lazily", () => {
    // A console loaded with `next/dynamic` and absent from the warm map pays
    // its download on the reader's first click, behind a panel-sized skeleton.
    // That is the whole cost the prefetch exists to remove, and it is invisible
    // to anyone whose chunk is already cached — which is everyone who built it.
    //
    // Diffusion was in exactly that state: the eleventh tab arrived lazy and
    // was never added to the map, so it was the one console on the desk that
    // still paid.
    const loaded = [...lazy.matchAll(/const (\w+) = dynamic\(\(\) => import\("@\/components\/(\w+)"\)/g)]
      .map((match) => match[2]);
    const warmed = [...prefetch.matchAll(/import\("@\/components\/(\w+)"\)/g)].map((match) => match[1]);
    assert.ok(loaded.length >= 6, `only ${loaded.length} lazy consoles found — has the split moved?`);
    assert.deepEqual(
      loaded.filter((name) => !warmed.includes(name)), [],
      "these consoles are chunk-split and never warmed, so the first click on each pays the download",
    );
  });
});

describe("a tape wakes the readers of its own series, and no others", () => {
  it("keeps a version per key rather than one for the store", () => {
    // One counter for the whole store means every append re-renders EVERY
    // mounted tape — including tapes on tabs the reader is not looking at,
    // because a visited panel stays mounted behind `hidden`. At five tapes
    // that is tolerable; the eight this tab now carries make it a poll's worth
    // of wasted render on every poll of every section.
    assert.match(series, /versions\s*=\s*new Map/,
      "the series store still keeps a single global version, so one key's append wakes them all");
    assert.doesNotMatch(series, /^let version = 0;/m,
      "the global version counter is back");
  });

  it("keeps a listener set per key", () => {
    assert.match(series, /listeners\s*=\s*new Map/,
      "the store still holds one listener set, so a subscriber cannot be woken selectively");
  });

  it("subscribes on the key the caller asked for", () => {
    // The subscribe function has to be stable per key or `useSyncExternalStore`
    // resubscribes on every render, which trades one wasted render for another.
    assert.match(series, /useCallback\(/, "the subscription is rebuilt on every render");
  });
});
