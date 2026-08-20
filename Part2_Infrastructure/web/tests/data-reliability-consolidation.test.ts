/**
 * One consolidation pass over Data and Reliability, and the ways each half of
 * it goes wrong afterwards.
 *
 * Five separate edits, each with its own failure mode, and none of them visible
 * to a type checker:
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
 *  3. Repeated controls were removed: one "Manage in Providers" per outage row
 *     that all called the same argument-less handler, and two console tiles
 *     that linked where the global header already links. The risk in both is
 *     removing the last route rather than the repeat, so what survives is
 *     asserted here as well as what went.
 *
 *  4. `Logs` moved into a row menu. It is the only READ on that row; the other
 *     four spend a provider call, remove a live provider from routing, or
 *     mutate a breaker. This codebase's rule is that a control which changes
 *     trading state states its cost beside the button, so the menu must hold
 *     the read and nothing else.
 *
 *  5. The mocked work queue lost its reset button, which reseeded the sample
 *     rather than exercising the workflow. Its hazard was invisible: the handler
 *     held the only clear of the arrival-animation flag other than the card's
 *     own `animationend`, and a card the filter removes never fires one.
 *
 * Source-level assertions, like the workspace and remediation suites: there is
 * no DOM here, and the properties worth pinning are structural.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createInitialDataWorkItems,
  filterAndSortDataWorkItems,
  moveDataWorkItem,
} from "../lib/data-work-queue";

import { globalsCss } from "./globals-css";

const NOW = Date.UTC(2026, 7, 5, 12);

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Comments in these files name the constructs they exist to explain the absence
 * of — "the row-level repeat", "Manage in Providers", "Explain p99". A scan that
 * cannot tell prose from code reads the explanation as the offence, which has
 * bitten this suite twice.
 */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * `DataTrustOverview` kept the pane state, both segmented controls and the
 * Verdict pane; the four other panes are sibling files mounted by the same
 * conditionals. The switcher assertions below still read the switcher's file —
 * that is where their subject is — and the ones about what a pane DRAWS read
 * the pane. `trustSurface` is for the assertions that forbid something
 * anywhere on the surface: scoped to the shell alone they would pass by
 * scanning a file that no longer contains what they guard.
 */
const trustOverview = read("../components/data/DataTrustOverview.tsx");
const freshnessPane = read("../components/data/FeedsFreshnessPane.tsx");
const contractsPane = read("../components/data/FeedsContractsPane.tsx");
const trustSurface = [
  trustOverview,
  freshnessPane,
  contractsPane,
  read("../components/data/TrustResponsePane.tsx"),
  read("../components/data/TrustCompositionPane.tsx"),
].join("\n");
const outages = read("../components/systems/OutageIncidents.tsx");
const reliabilityConsole = read("../components/ReliabilityConsole.tsx");
/**
 * `ReliabilityOverview` passed the ceiling a second time and became a seam over
 * two conditionally mounted halves: `ReliabilityAttention` is triage and the
 * incident path, `ReliabilityPlanes` is what the system depends on. The
 * numbered card is triage, so it is read from `attention`; the seam file holds
 * neither half's markup and would satisfy none of the regexes below — it would
 * pass by matching nothing.
 */
const reliabilityAttention = read("../components/systems/ReliabilityAttention.tsx");
const healthMatrix = read("../components/systems/HealthMatrix.tsx");
const workBoard = read("../components/data/DataWorkBoard.tsx");
const sections = read("../lib/sections.ts");
// `lib/data-trust.ts` became `lib/data-trust/` in the 786-line split.
// `DataTrustDestination` is declared in `model.ts` and re-exported by the
// barrel; the barrel would satisfy neither regex below, so the read is
// anchored at the declaration and `assert.ok(union, ...)` keeps a missing
// file or a moved union loud instead of matching nothing.
const dataTrust = read("../lib/data-trust/model.ts");
const page = read("../app/dashboard/page.tsx");

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
    // Every `useState` above every early return: `workspace-routing.test.ts`
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

// --------------------------------------------------------------------------
// 3 — a repeat is removed, the route is not
// --------------------------------------------------------------------------

describe("the outage card offers one route to Providers, not one per row", () => {
  it("carries no per-row repeat", () => {
    /**
     * Every copy called `onOpenProviders()` with no argument, so choosing the
     * third row landed on the same unfiltered failover graph as choosing the
     * first — a per-row control that cannot carry its row is a repeat wearing a
     * row's clothes, and it read as though each outage had its own destination.
     */
    const stripped = code(outages);
    const rows = stripped.slice(stripped.indexOf("<li key={outage.provider}"), stripped.indexOf("</ul>"));
    assert.ok(rows.length > 0, "the outage rows are gone");
    assert.doesNotMatch(rows, /onOpenProviders/, "the row-level repeat is back");
    assert.doesNotMatch(stripped, /Manage in Providers/);
  });

  it("still gives the populated card a way out", () => {
    // Deleting the repeat must not delete the route. The empty state has always
    // had exactly one of these; the populated card now matches it.
    const stripped = code(outages);
    const afterRows = stripped.slice(stripped.indexOf("</ul>"));
    assert.match(afterRows, /onClick=\{onOpenProviders\}/, "the populated card can no longer reach Providers");
    assert.match(afterRows, /Open providers/);
  });

  it("dresses the survivor in a class the stylesheet actually declares", () => {
    /**
     * The repeats wore `console-node__action`; the consolidated button first
     * went out wearing `small`, which is declared nowhere — `.small` has no rule
     * in globals.css and `small` only ever appears there as the HTML element in
     * a descendant selector. It type-checks, it renders, and it silently loses
     * the styling the buttons it replaced had. Both states of this card are the
     * same control, so both are checked.
     */
    const stripped = code(outages);
    assert.doesNotMatch(stripped, /className="small"/, "a class name that resolves to no rule");
    assert.equal(
      (stripped.match(/className="console-node__action"/g) ?? []).length,
      2,
      "the empty and populated states of one control are dressed differently",
    );
    assert.match(
      globalsCss,
      /\n\.console-node__action \{/,
      "the class the outage card now wears has lost its rule",
    );
  });
});

describe("a console tile is a number, not a second copy of a header control", () => {
  it("carries no tile action", () => {
    const stripped = code(reliabilityConsole);
    assert.doesNotMatch(
      stripped,
      /actionLabel:/,
      "a reliability tile links somewhere the global header already goes",
    );
    assert.doesNotMatch(stripped, /View every provider|Explain p99/);
  });

  it("leaves the header's two deep links, which are what make the removal free", () => {
    /**
     * The tiles duplicated the header exactly — same section, same anchor. The
     * header travels with the reader across every workspace, so nothing was
     * lost; if these two ever move, the removal above stops being free and this
     * fails rather than the reader finding out.
     */
    assert.match(page, /openReliabilitySection\("services", "reliability-provider-health"\)/);
    assert.match(page, /openReliabilitySection\("services", "reliability-latency-guide"\)/);
    assert.match(healthMatrix, /id="reliability-provider-health"/);
    assert.match(healthMatrix, /id="reliability-latency-guide"/);
  });
});

describe("the incident path is a procedure, and records that it is one", () => {
  it("keeps the numbered card", () => {
    // Three buttons pointing at three sibling rail tabs one row above. It looks
    // like pure duplication and is not: the rail is an index and does not say
    // which section to open first.
    assert.match(reliabilityAttention, /className="reliability-response-steps"/, "the incident path was deleted");
    assert.match(code(reliabilityAttention), /<ol className="reliability-response-steps">/, "the sequence is no longer ordered markup");
    for (const step of ["01", "02", "03"]) {
      assert.ok(reliabilityAttention.includes(`>${step}</span>`), `step ${step} lost its numeral`);
    }
  });

  it("says why immediately above the list, where the next reader will be standing", () => {
    const index = reliabilityAttention.indexOf('<ol className="reliability-response-steps">');
    const above = reliabilityAttention.slice(Math.max(0, index - 900), index);
    assert.match(
      above,
      /the ordering is the information/,
      "the note recording why this is not duplication is gone, so the next person to notice will delete the card",
    );
  });
});

// --------------------------------------------------------------------------
// 4 — the read moved behind a menu; the four costs did not
// --------------------------------------------------------------------------

describe("only the free read is behind the health-matrix row menu", () => {
  const stripped = code(healthMatrix);
  const menuAt = () => {
    const at = stripped.indexOf("<RowMenu");
    assert.ok(at > 0, "the Logs read is not behind a row menu");
    return at;
  };

  it("holds Logs and nothing else", () => {
    const menu = stripped.slice(menuAt(), stripped.indexOf("</RowMenu>"));
    assert.match(menu, /Logs/);
    for (const costly of ["Test", "Simulate 2m", "Reset"]) {
      assert.ok(
        !menu.includes(costly),
        `${costly} changes state — its cost belongs beside the button, not behind a menu`,
      );
    }
  });

  it("names the row on the trigger", () => {
    // Every row's trigger renders the same three dots; without the row in the
    // accessible name a screen reader hears six identical buttons.
    assert.match(healthMatrix, /<RowMenu label=\{`More actions for \$\{provider\.label\}`\}>/);
  });

  it("leaves all four state-changing controls in the row, each pricing itself", () => {
    const actions = stripped.slice(stripped.indexOf('className="console-row-actions"'), menuAt());
    for (const action of ["probe_provider", "simulate_outage", "clear_outage", "reset_breaker"]) {
      assert.ok(actions.includes(action), `${action} left the visible row`);
    }
    assert.equal(
      (actions.match(/aria-describedby="health-matrix-action-note"/g) ?? []).length,
      4,
      "every state-changing control points at the paragraph that states what it spends",
    );
    assert.match(healthMatrix, /Test spends one real provider call/);
  });
});

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
