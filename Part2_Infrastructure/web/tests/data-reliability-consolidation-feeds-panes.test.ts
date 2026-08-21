/**
 * Feeds & Contracts became two panes, and the button that leaves them names a
 * destination the reader can actually find.
 *
 * Two of the five edits in one consolidation pass over Data and Reliability,
 * both on the Data Trust surface, neither visible to a type checker:
 *
 *  1. Feeds & Contracts became two panes. The hazards are the ones the
 *     portfolio and remediation splits already record — a nested
 *     `<WorkspaceSubtabs>` puts a second ResizeObserver on `--rail-h`, and
 *     `hidden` instead of a conditional render leaves the switched-away table
 *     mounted — plus one of its own: the operator path is a response to the
 *     contract evidence, so it has to travel with it rather than sit under
 *     whichever pane happens to be open.
 *
 *  2. A next-action button printed `action.destination`, which is a section id.
 *     The rail shows "Lineage & Payloads", not "lineage", so the button named
 *     a destination the reader could not find. The union and the section table
 *     are separate declarations, so the lookup is only honest for as long as
 *     every destination has a section.
 *
 * The Reliability half of the same pass is in
 * `data-reliability-consolidation-reliability.test.ts`, and the mocked work
 * queue in `data-reliability-consolidation-work-queue.test.ts`.
 *
 * Source-level assertions, like the workspace and remediation suites: there is
 * no DOM here, and the properties worth pinning are structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readSource, stripCode as code } from "./helpers/source-files";

/**
 * `DataTrustOverview` kept the pane state, both segmented controls and the
 * Verdict pane; the four other panes are sibling files mounted by the same
 * conditionals. The switcher assertions below still read the switcher's file —
 * that is where their subject is — and the ones about what a pane DRAWS read
 * the pane. `trustSurface` is for the assertions that forbid something
 * anywhere on the surface: scoped to the shell alone they would pass by
 * scanning a file that no longer contains what they guard.
 */
const trustOverview = readSource("components/data/DataTrustOverview.tsx");
const freshnessPane = readSource("components/data/FeedsFreshnessPane.tsx");
const contractsPane = readSource("components/data/FeedsContractsPane.tsx");
const trustSurface = [
  trustOverview,
  freshnessPane,
  contractsPane,
  readSource("components/data/TrustResponsePane.tsx"),
  readSource("components/data/TrustCompositionPane.tsx"),
].join("\n");
const sections = readSource("lib/sections.ts");
// `lib/data-trust.ts` became `lib/data-trust/` in the 786-line split.
// `DataTrustDestination` is declared in `model.ts` and re-exported by the
// barrel; the barrel would satisfy neither regex below, so the read is
// anchored at the declaration and `assert.ok(union, ...)` keeps a missing
// file or a moved union loud instead of matching nothing.
const dataTrust = readSource("lib/data-trust/model.ts");

// --------------------------------------------------------------------------
// 1 — Feeds & Contracts, in the two halves its own rail label names
// --------------------------------------------------------------------------

describe("Feeds & Contracts splits into the two halves its label already named", () => {
  const paneList = () => {
    const start = trustOverview.indexOf("const FEEDS_PANES");
    assert.ok(start > 0, "the feeds pane list is no longer a module-level constant");
    return trustOverview.slice(start, trustOverview.indexOf("];", start));
  };

  it("offers exactly two panes", () => {
    const ids = [...paneList().matchAll(/\{\s*id:\s*"(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, ["freshness", "contracts"]);
  });

  it("carries a hint on every pane, as the other two switchers do", () => {
    // `title={option.hint}` is why the pane list is objects rather than
    // strings: a one-word label cannot say what a pane answers.
    const hints = [...paneList().matchAll(/hint:\s*"([^"]*)"/g)].map((match) => match[1]);
    assert.equal(hints.length, 2);
    for (const hint of hints) assert.ok(hint.length > 24, `a hint that says nothing: "${hint}"`);
    assert.match(trustOverview, /title=\{option\.hint\}/);
  });

  it("switches with `.seg role=\"group\"`, never a second rail", () => {
    /**
     * `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver and its own
     * header asserts exactly one rail is mounted at a time. A second instance is
     * two observers writing one variable, and every sticky offset in the app
     * reads it.
     */
    const groups = [...trustOverview.matchAll(/<div className="seg" role="group" aria-label="([^"]+)"/g)]
      .map((match) => match[1]);
    assert.deepEqual(groups, ["Trust evidence view", "Feeds and contracts view"]);
    assert.ok(!code(trustSurface).includes("WorkspaceSubtabs"), "a nested rail would contend for --rail-h");
    assert.match(trustOverview, /aria-pressed=\{feedsPane === option\.id\}/);
  });

  it("renders each pane conditionally, never behind `hidden`", () => {
    const stripped = code(trustOverview);
    for (const pane of ["freshness", "contracts"]) {
      assert.match(
        stripped,
        new RegExp(`feedsView && feedsPane === "${pane}" && \\(`),
        `the ${pane} pane is not a conditional render`,
      );
    }
    assert.doesNotMatch(stripped, /hidden=\{[^}]*feedsPane/, "a hidden pane is still mounted and still drawing");
  });

  it("declares the pane state beside the one that was already there", () => {
    // Every `useState` above every early return: `workspace-routing-hook-order.test.ts`
    // runs a hook-order check, and a hook that drifts below a bail-out throws
    // "rendered more hooks than during the previous render" on the first render
    // that gets past it.
    assert.match(
      code(trustOverview),
      /useState<TrustPane>\("verdict"\);\s*const \[feedsPane, setFeedsPane\] = useState<FeedsPane>\("freshness"\);/,
    );
  });

  it("opens on Freshness, which needs only the gateway snapshot", () => {
    assert.match(trustOverview, /useState<FeedsPane>\("freshness"\)/);
  });

  it("keeps the operator path with the contract evidence it responds to", () => {
    /**
     * "Next evidence to inspect" is composed from the same contract and quota
     * risk the second monitor prints. On the freshness pane it would be three
     * recommendations with none of their reasoning on screen.
     */
    const stripped = code(trustOverview);
    const contractsAt = stripped.indexOf('feedsPane === "contracts"');
    const freshnessAt = stripped.indexOf('feedsPane === "freshness"');
    assert.ok(freshnessAt > 0 && contractsAt > freshnessAt, "the feeds panes are gone or out of order");
    /**
     * This used to slice the shell between the two conditionals. Once the pane
     * bodies became files that slice held only the two mount lines, and both
     * halves of the check would have passed on an empty window — the operator
     * path could have moved to Freshness with nothing going red. Named files
     * instead of a window into one.
     */
    assert.ok(
      code(contractsPane).includes('className="data-trust-actions"'),
      "the operator path left the pane that carries its evidence",
    );
    assert.ok(
      !code(freshnessPane).includes('className="data-trust-actions"'),
      "the operator path is drawn on both panes",
    );
  });
});

// --------------------------------------------------------------------------
// 2 — a button names a destination the reader can find
// --------------------------------------------------------------------------

describe("a next-action button names the section the rail shows", () => {
  it("looks the label up rather than printing the raw id", () => {
    // The buttons, the lookup and the DATA_SECTIONS import all travelled with
    // the operator path into the contracts pane. The forbidding half reads the
    // whole surface, so the raw id cannot reappear in a sibling unseen.
    assert.match(code(contractsPane), /Open \{destinationLabel\(action\.destination\)\}/);
    assert.doesNotMatch(
      code(trustSurface),
      /Open \{action\.destination\}/,
      'the button reads "Open quality" again, and no tab on the rail is called that',
    );
    assert.match(contractsPane, /import \{ DATA_SECTIONS \} from "@\/lib\/sections"/);
  });

  it("every destination the model can emit has a label to look up", () => {
    /**
     * `DataTrustDestination` and `DATA_SECTIONS` are separate declarations. A
     * destination with no section falls back to printing its own id, which is
     * precisely the defect the lookup was added to end — silently, and only on
     * whichever risk state produces that action.
     */
    const union = /export type DataTrustDestination =([^;]+);/.exec(dataTrust);
    assert.ok(union, "DataTrustDestination is gone");
    const destinations = union[1].split("|").map((part) => part.trim().replace(/"/g, "")).filter(Boolean);
    assert.deepEqual(destinations.sort(), ["lineage", "providers", "quality"]);

    const start = sections.indexOf("export const DATA_SECTIONS");
    const block = sections.slice(start, sections.indexOf("] as const", start));
    const labels = Object.fromEntries(
      [...block.matchAll(/\{ id: "([a-z]+)", label: "([^"]+)"/g)].map((match) => [match[1], match[2]]),
    );
    for (const destination of destinations) {
      assert.ok(labels[destination], `DATA_SECTIONS has no entry for "${destination}"`);
      assert.notEqual(
        labels[destination],
        destination,
        `"${destination}" is its own rail label, so the lookup has stopped doing anything`,
      );
    }
  });
});
