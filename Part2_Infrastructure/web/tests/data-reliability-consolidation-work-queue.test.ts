/**
 * The sample work queue stops demonstrating that it is mocked.
 *
 * The fifth edit in one consolidation pass over Data and Reliability, and the
 * only one whose hazard was invisible:
 *
 *  5. The mocked work queue lost its reset button, which reseeded the sample
 *     rather than exercising the workflow. Its hazard was invisible: the handler
 *     held the only clear of the arrival-animation flag other than the card's
 *     own `animationend`, and a card the filter removes never fires one.
 *
 * So this file is two halves that have to be read together. Half of it asserts
 * what the removal took away — the reseed, the session-only claim — and half
 * asserts the escape hatch that had been quietly resting on it, both the
 * reconciling effect and the property of the filter that keeps that effect from
 * firing on the very move it exists to protect. The second half is exercised
 * against `lib/data-work-queue` rather than read from source, because it is a
 * property of the filter and not of the component.
 *
 * The Data Trust half of the same pass is in
 * `data-reliability-consolidation-feeds-panes.test.ts`, and the Reliability
 * deletions in `data-reliability-consolidation-reliability.test.ts`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createInitialDataWorkItems,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
} from "../lib/data-work-queue";

import { readSources, stripCode as code } from "./helpers/source-files";

const NOW = Date.UTC(2026, 7, 5, 12);

/**
 * The board is four files. Reading them through `readSources` rather than a
 * `try { … } catch { return "" }` is deliberate: a swallowed read turns every
 * `doesNotMatch` below into a pass over an empty string, so a renamed component
 * would retire these guards silently instead of failing loudly.
 */
const workBoard = readSources(
  "components/data/DataWorkBoard.tsx",
  "components/data/DataWorkCard.tsx",
  "components/data/WorkComposer.tsx",
  "components/data/work-board-model.ts",
);

// --------------------------------------------------------------------------
// 5 — the mocked queue stops demonstrating that it is mocked
// --------------------------------------------------------------------------

describe("the sample work queue no longer reseeds itself from a button", () => {
  it("offers no reset", () => {
    const stripped = code(workBoard);
    assert.doesNotMatch(stripped, /Reset sample queue/);
    assert.doesNotMatch(
      stripped,
      /createInitialDataWorkItems/,
      "the board reseeds itself again — that demonstrates the mock, not the workflow",
    );
  });

  it("says where the list came from — persisted on the gateway, or held locally, never silently either", () => {
    // The queue moved to the gateway (versioned rows, audit-logged); the pill
    // and the scope paragraph name the source, and the offline hold is a
    // disclosed degradation rather than a quiet one.
    assert.match(workBoard, /Persisted on the gateway/);
    assert.match(workBoard, /Gateway unreachable — edits held locally/);
    assert.match(workBoard, /a stale edit is refused rather than overwritten/);
    assert.match(workBoard, /Nothing here is lost silently, and nothing here is confirmed either/);
    assert.doesNotMatch(workBoard, /session-only/, "the session-only claim is no longer true");
  });

  it("does not leave the arrival highlight without a way to be cleared", () => {
    /**
     * `setJustMoved(null)` had exactly one call site, and it was inside the
     * reset handler removed above. The flag's other clear is the card's own
     * `animationend`, which a card the filter removes never fires: it unmounts
     * mid-animation, the id survives in state, and the card animates in again
     * the moment the filter brings it back — an arrival announced for a move
     * that happened several keystrokes ago. So the reset had been quietly
     * standing in as the escape hatch for a filtered-out card, and taking it out
     * left the flag with no exit.
     */
    const stripped = code(workBoard);
    const effect = /useEffect\(\(\) => \{([\s\S]*?)\}, \[justMoved, visible\]\);/.exec(stripped);
    assert.ok(effect, "nothing reconciles the arrival flag against the cards actually on screen");
    assert.match(effect[1], /!visible\.some\(\(item\) => item\.id === justMoved\)/);
    assert.match(effect[1], /setJustMoved\(null\)/);
  });

  it("does not fire on the move it exists to protect", () => {
    /**
     * The reconciliation rests on status not being a filter dimension. If it
     * became one, moving a card would drop it out of `visible` in the same
     * commit that flagged it, the effect would clear the flag before paint, and
     * the arrival animation would never play at all — a silent regression in the
     * feature the flag exists for. Exercised rather than read, because this half
     * is a property of the filter, not of the component.
     */
    const [first] = createInitialDataWorkItems(NOW);
    const moved = moveDataWorkItem([first], first.id, first.status === "resolved" ? "intake" : "resolved");
    const visible = filterAndSortDataWorkItems(moved, { query: "", kind: "all", sort: "priority" });
    assert.deepEqual(visible.map((item) => item.id), [first.id], "a move now changes which cards are shown");
  });

  it("leaves the panel with controls and data, which the desk sweep measures", () => {
    /**
     * `scripts/desk-sweep.mjs` fails a panel that reaches zero data points AND
     * zero controls — nothing to read and nothing to do. Removing a control from
     * a panel is the edit that can cause it, so the survivors are named.
     */
    const stripped = code(workBoard);
    for (const control of [
      'type="search"',
      'className="seg data-workboard__kinds"',
      "data-workboard__sort",
      "+ Add item",
      "data-work-card__status",
    ]) {
      assert.ok(stripped.includes(control), `the queue lost ${control}`);
    }
    assert.match(stripped, /aria-label=\{`Status for \$\{item\.id\}`\}/);
  });
});
