/**
 * The Developer console after the duplicate controls came out.
 *
 * Four controls were deleted, and a deletion is the claim that decays fastest:
 * a control comes back the moment someone reads the surface as missing an
 * affordance rather than as having one control for one capability. The
 * next-status button offered one of the five transitions the select beside it
 * already offered; the three composer buttons were one action with a three-way
 * parameter that the composer's own Type select carries; the reset rebuilt a
 * fixture a reload rebuilds; and the refresh called the shared 30s health poll
 * a second time.
 *
 * Deleting controls can also strip a panel to nothing. `scripts/desk-sweep.mjs`
 * fails a panel with zero data points AND zero controls, so the work queue has
 * to still be usable after losing two buttons per row and one in the footer.
 *
 * The two claims about how a control LOOKS are here for the same reason: three
 * identical cross-tab links must keep one treatment between them, and a
 * component that only moved during the pane split must still do everything it
 * did before the move.
 *
 * Source-level assertions throughout — there is no DOM here, and the files
 * being read are in `tests/helpers/developer-sources`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { catalog, health, overview_, queue, tab } from "./helpers/developer-sources";
import { stripCode } from "./helpers/source-files";

describe("one control per capability in the engineering queue", () => {
  it("moves a row through its status select alone", () => {
    /**
     * The deleted button called `move(item, nextStatus(item.status))` — one of
     * the five transitions the select forty pixels to its left already offers,
     * and the only one it could reach. Two controls for one field is two things
     * to keep in agreement, and the reader who picked the wrong one had to come
     * back to the select regardless.
     */
    const source = stripCode(queue);
    assert.doesNotMatch(source, /nextStatus\(/, "the next-status button is back");
    assert.doesNotMatch(source, /nextActionLabel/, "the next-status button's label ladder is back");
    // And the select still offers every status, which is what made the button
    // redundant rather than merely convenient.
    assert.match(source, /DEVELOPER_WORK_STATUSES\.map/);
    assert.match(source, /aria-label=\{`Status for \$\{item\.id\}:/);

    // The column the button occupied is gone with it: an empty header cell is a
    // promise of a control that is no longer there.
    const head = source.slice(source.indexOf("<thead>"), source.indexOf("</thead>"));
    assert.equal((head.match(/<th>/g) ?? []).length, 3, "the header still declares a column for the deleted button");
  });

  it("opens the composer once, and lets the composer carry the kind", () => {
    /**
     * `+ Add feature`, `Report bug` and `New ticket` all called
     * `openComposer(kind)`: one action with a three-way parameter, on a form
     * whose Type select the reader passes on the way to the title field anyway.
     */
    const source = stripCode(queue);
    const actions = source.slice(source.indexOf('className="developer-work__actions"'), source.indexOf("{composerOpen &&"));
    assert.equal((actions.match(/<button/g) ?? []).length, 1, "the composer has more than one opener again");
    for (const label of ["Add feature", "Report bug", "New ticket"]) {
      assert.ok(!source.includes(label), `"${label}" is back as its own button`);
    }
    // The select that now carries the kind, and the heading that reflects it.
    assert.match(source, /DEVELOPER_WORK_KINDS\.map\(\(workKind\)/);
    assert.match(source, /New \{KIND_LABEL\[draft\.kind\]\.toLocaleLowerCase\(\)\}/);
  });

  it("drops the demo reset without dropping the fixture", () => {
    // The developer panel is this browser's storage; the items are
    // built by `createInitialDeveloperWorkItems` in page.tsx on mount, so a
    // reload is the reset. A button that re-seeds a fixture is demo furniture.
    const source = stripCode(queue);
    assert.doesNotMatch(source, /createInitialDeveloperWorkItems/);
    assert.ok(!source.includes("Reset sample queue"));
    // The live region it shared a footer with stays: it is the only thing that
    // reports a move to a screen reader.
    assert.match(source, /aria-live="polite"/);
  });

  it("leaves the panel with data and controls, which the desk sweep requires", () => {
    /**
     * `scripts/desk-sweep.mjs` fails a panel with zero data points AND zero
     * controls, and separately fails a table that renders no rows. Three
     * controls came out of this panel in one pass, so what is left is worth
     * measuring rather than assuming.
     */
    const source = stripCode(queue);
    assert.match(source, /type="search"/, "the queue lost its search field");
    assert.ok((source.match(/<select/g) ?? []).length >= 5, "the queue lost its filters or its per-row status control");
    assert.match(source, /className="seg developer-work__kinds"/, "the kind filter is gone");
    assert.match(source, /visibleItems\.map/, "the table no longer renders rows");
    // An empty filter result still says so rather than rendering an empty table.
    assert.match(source, /No matching work/);
  });
});

describe("the Developer head does not offer a second copy of the shared poll", () => {
  it("deletes the console's own refresh", () => {
    // Read across the tab, not just the shell: the head is still in
    // `DeveloperConsole`, but the sections take the same `view` and any of
    // them could grow the button the head lost.
    const source = stripCode(tab);
    assert.ok(!source.includes("Refresh health"));
    assert.doesNotMatch(source, /view\.refresh\(/, "the console calls the shared refresh again");
  });

  it("because the hook it called polls on its own", () => {
    // The justification, asserted rather than remembered: if the shared poll
    // ever stops, a manual refresh stops being a duplicate and this test should
    // be the thing that says so.
    assert.match(health, /DEFAULT_POLL_MS = 30_000/);
    // The hand-rolled `setInterval` moved onto the shared controller. What
    // this test needs is unchanged: the hook still owns a poll of its own, so
    // a Refresh button on the console head would be a second copy of it.
    assert.match(health, /usePolling\(\{[\s\S]*?intervalMs: pollMs/);
  });
});

describe("the three cross-tab links keep one treatment between them", () => {
  it("renders three plain buttons, none of them wearing the accent fill", () => {
    /**
     * These are doors to other tabs, not commits. One of the three used to wear
     * `primary-action` — the Send-order fill — which made an identical
     * navigation read as the most important action on the section. They are not
     * to be deleted: another pass gives them target sections. What must stay
     * true is that they look like each other.
     *
     * The shared-context card is the tail of the topology half of
     * `DeveloperOverview` since the console was split.
     */
    const source = stripCode(overview_);
    const start = source.indexOf('className="developer-cp-context__actions"');
    assert.ok(start > 0, "the cross-tab links are gone from the shared-context card");
    const block = source.slice(start, source.indexOf("</div>", start));
    const buttons = block.match(/<button[^>]*>/g) ?? [];
    assert.equal(buttons.length, 3, "the shared-context card no longer offers three cross-tab links");
    for (const button of buttons) {
      assert.ok(!button.includes("className"), `a cross-tab link carries its own treatment: ${button}`);
    }
  });
});

describe("the catalog the Routes pane now owns is unchanged", () => {
  it("still filters, still copies a curl, and still reports an empty result", () => {
    // The pane split moved this component; it did not edit it. Pinned because a
    // move is the cheapest moment to lose a behaviour nobody re-checked.
    const source = stripCode(catalog);
    assert.match(source, /className="seg developer-api-catalog__groups"/);
    assert.match(source, /Copy curl/);
    assert.match(source, /No matching operations/);
  });
});
