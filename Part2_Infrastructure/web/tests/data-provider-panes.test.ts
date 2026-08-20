/**
 * Providers & Capacity, after the two-column squeeze came out.
 *
 * The failover chain and the quota ledger rendered side by side in a
 * `.compact-grid-2col`, which gave each half of the panel: a chain of
 * entry, cache and ranked provider nodes wrapped onto extra rows, and the
 * quota meters and four-column cache table drew at half the width their
 * columns were sized for. The section now switches between two `.seg`
 * panes — Routing and Budget, names the cards' own kickers already carried —
 * each at full width.
 *
 * The hazards are the ones the portfolio, remediation and developer splits
 * already record — a nested `<WorkspaceSubtabs>` puts a second ResizeObserver
 * on `--rail-h`, `hidden` leaves the switched-away pane mounted, a switcher
 * placed inside a grid stack becomes a grid item beside the first card rather
 * than above it — plus two of this section's own: the outage drill is a
 * functional control wired through the operator guard, and "Open Reliability"
 * is a measured destination in the desk-interconnect scan, so both must
 * survive the re-parenting intact.
 *
 * Source-level assertions, like the sibling pane suites: there is no DOM here,
 * and the properties worth pinning are structural.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments name the very constructs they explain the absence of. */
const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const console_ = read("../components/DataConsole.tsx");
const failover = read("../components/systems/FailoverGraph.tsx");
const css = read("../app/globals.css");

/** The providers panel only — the section rail's other panels are not ours. */
function panel(): string {
  const stripped = code(console_);
  const start = stripped.indexOf('tabId="providers"');
  const end = stripped.indexOf('tabId="queue"');
  assert.ok(start > 0 && end > start, "the providers panel is gone from DataConsole");
  return stripped.slice(start, end);
}

/** The pane list, as {id, label, hint} triples. */
function panes(): Array<{ id: string; label: string; hint: string }> {
  const start = console_.indexOf("const PROVIDERS_PANES");
  assert.ok(start > 0, "PROVIDERS_PANES is no longer a module-level constant");
  const block = console_.slice(start, console_.indexOf("];", start));
  return [...block.matchAll(/\{\s*id:\s*"(\w+)",\s*label:\s*"([^"]*)",\s*hint:\s*"([^"]*)"/g)]
    .map((match) => ({ id: match[1], label: match[2], hint: match[3] }));
}

describe("Providers & Capacity splits into panes, not a second rail", () => {
  it("keeps exactly one WorkspaceSubtabs on the tab", () => {
    /**
     * `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver and its own
     * comment asserts that exactly one rail is mounted at a time. Two rails are
     * two observers writing one variable that every sticky offset in the app
     * reads, so a split section switches with `.seg` as its siblings do.
     */
    assert.equal(code(console_).match(/<WorkspaceSubtabs\b/g)?.length, 1);
    assert.match(panel(), /className="seg" role="group" aria-label="Providers and capacity view"/);
    assert.match(panel(), /aria-pressed=\{providersPane === option\.id\}/);
  });

  it("offers exactly the two panes the cards' kickers already named", () => {
    // The failover card's kicker reads "Routing" and the quota card's reads
    // "Budget", so the reader met these names before the switcher existed.
    // Two options, well inside the two-or-three a `.seg` holds before its
    // `flex: 1` buttons start abbreviating labels.
    assert.deepEqual(panes().map((pane) => pane.id), ["routing", "budget"]);
    assert.deepEqual(panes().map((pane) => pane.label), ["Routing", "Budget"]);
  });

  it("carries a hint on every pane, as the sibling switchers do", () => {
    // The pane list is objects rather than strings for this: a one-word label
    // cannot say what a pane answers, and the hint is what the title attribute
    // shows before the reader has clicked anything.
    for (const pane of panes()) {
      assert.ok(pane.hint.length > 24, `PROVIDERS_PANES.${pane.id} has a hint that says nothing`);
    }
    assert.match(panel(), /title=\{option\.hint\}/);
  });

  it("opens on Routing, which is where the outage card's cross-link is aimed", () => {
    // "Open providers" on the incidents tab's outage card exists to show the
    // reader the failover graph an outage is bending. It calls
    // `onSectionChange("providers")` with no pane argument, so the default
    // pane IS that link's destination.
    assert.match(console_, /useState<ProvidersPane>\("routing"\)/);
  });

  it("puts the switcher in the panel's block flow, above the card stack", () => {
    /**
     * `.data-console-stack` is `display: grid`. The developer split records
     * what happens to a switcher placed inside a grid stack — it becomes a
     * grid item with the first card beside it rather than below it, measured
     * at 244px against a 1400px panel. The seg sits directly in the subtab
     * panel, before either pane's wrapper.
     */
    const source = panel();
    const seg = source.indexOf('className="seg"');
    const stack = source.indexOf('className="data-console-stack"');
    assert.ok(seg > 0 && stack > 0, "the providers panel lost its switcher or its stack");
    assert.ok(seg < stack, "the switcher renders inside the card stack");
  });
});

describe("a switched-away pane is unmounted, not hidden", () => {
  it("renders each pane conditionally, never behind `hidden`", () => {
    const source = panel();
    for (const pane of ["routing", "budget"]) {
      assert.match(
        source,
        new RegExp(`providersPane === "${pane}" && \\(`),
        `the ${pane} pane is not a conditional render`,
      );
    }
    assert.doesNotMatch(source, /hidden=\{[^}]*providersPane/, "a hidden pane is still mounted and still drawing");
  });

  it("gives each pane the full panel, with the half-width grid gone", () => {
    // The defect this split exists to end: two dense cards sharing one row.
    // `.compact-grid-2col` stays a live class — the live market and portfolio
    // pairs still render it — it just has no business in this panel.
    assert.ok(!panel().includes("compact-grid-2col"), "the providers panel is back to half-width columns");
    // The live-market half of the pair is `LiquidityBook` now — the depth
    // curve and the ladder went there together when LiveMarket was split.
    assert.match(code(read("../components/execution/LiquidityBook.tsx")), /compact-grid-2col/);
    assert.match(css, /\n\.compact-grid-2col \{/);
  });

  it("puts each card in exactly one pane", () => {
    /**
     * The failure mode of a split is a card that ends up in both panes, or in
     * neither. Both are invisible to a type checker and to every other test in
     * this suite.
     */
    const source = panel();
    const routingPane = source.slice(source.indexOf('providersPane === "routing"'), source.indexOf('providersPane === "budget"'));
    const budgetPane = source.slice(source.indexOf('providersPane === "budget"'));
    assert.match(routingPane, /<FailoverGraph/);
    assert.doesNotMatch(routingPane, /<QuotaMeters/);
    assert.match(budgetPane, /<QuotaMeters/);
    assert.doesNotMatch(budgetPane, /<FailoverGraph|data-console-handoff/);
    assert.equal(source.match(/<FailoverGraph/g)?.length, 1);
    assert.equal(source.match(/<QuotaMeters/g)?.length, 1);
  });
});

describe("the reliability hand-off travels with Routing and keeps its door", () => {
  it("sits in the Routing pane, whose story it continues", () => {
    // The card's own numbers — degraded routes and live sockets — are
    // transport state. The reader it serves has just watched a chain fail
    // over and wants the breaker and latency story behind it; beside the
    // quota meters it would answer a question nobody on that pane asked.
    const source = panel();
    const routingPane = source.slice(source.indexOf('providersPane === "routing"'), source.indexOf('providersPane === "budget"'));
    assert.match(routingPane, /data-console-handoff/);
    assert.match(routingPane, /onClick=\{onOpenReliability\}/, "the hand-off lost its route to Reliability");
    assert.match(routingPane, /Open Reliability/);
  });

  it("still reaches reliability/overview, which the interconnect scan measures", () => {
    // `desk-interconnect.test.ts` asserts something opens reliability/overview;
    // this is that something's wiring. page.tsx threads the prop, and the
    // measured `openSection("reliability", "overview")` behind it is
    // `openReliabilityOverview` in lib/use-workspace-routing.ts.
    assert.match(console_, /onOpenReliability: \(\) => void;/);
    assert.match(
      code(read("../app/dashboard/page.tsx")),
      /onOpenReliability=\{openReliabilityOverview\}/,
      "the page no longer wires DataConsole's hand-off to a named section",
    );
    assert.match(
      code(read("../lib/use-workspace-routing.ts")),
      /openSection\("reliability", "overview"\)/,
      "openReliabilityOverview no longer names the section it opens",
    );
  });

  it("answers operator actions above the switcher, where no pane can hide them", () => {
    // Actions fired from this panel must answer on this panel — and now also
    // on either pane: a Trip fired from Routing must still report its 401 if
    // the reader has already moved to Budget, so the result banner sits above
    // the seg rather than inside the pane that fired it.
    const source = panel();
    const result = source.indexOf("<OperatorActionResult");
    const seg = source.indexOf('className="seg"');
    assert.ok(result > 0, "the providers panel no longer reports operator action results");
    assert.ok(result < seg, "the action result renders inside a pane, so switching panes hides the answer");
  });
});

describe("the outage drill is untouched by the move", () => {
  it("still trips and restores providers through the operator guard", () => {
    // SIMULATE OUTAGE is the point of the routing panel — "does failover
    // work" is a question about behaviour. The pane split moved the card;
    // it must not have edited the wiring.
    const source = code(failover);
    assert.match(source, /onAction\("simulate_outage", \{ provider: node\.provider, ttlMs: UI_OUTAGE_MS \}\)/);
    assert.match(source, /onAction\("clear_outage", \{ provider: node\.provider \}\)/);
    assert.match(source, /guard === "locked" \|\| !operatorReady/);
  });

  it("receives the guard state and action channel from the console", () => {
    const routingPane = panel().slice(panel().indexOf('providersPane === "routing"'));
    for (const prop of ["guard={guard}", "operatorReady={operatorReady}", "busyAction={busyAction}", "onAction={runAction}"]) {
      assert.ok(routingPane.includes(prop), `FailoverGraph lost ${prop} in the move`);
    }
  });
});

describe("the full-width chain is a deliberate stylesheet decision", () => {
  it("widens and caps the chain nodes now that they own the panel", () => {
    /**
     * `.console-node`'s 168px flex basis was sized for the half-width column.
     * At panel width the same basis stretches a short chain into a row of
     * banners, so the stack-scoped rule widens the basis and caps the growth —
     * and it is scoped by `.data-console-stack`, which wraps nothing else. If
     * the stack ever gains a second tenant, this scope is the thing to revisit.
     */
    const at = css.indexOf(".data-console-stack .console-node {");
    assert.ok(at > 0, "the full-width chain lost its deliberate sizing rule");
    const block = css.slice(at, css.indexOf("}", at));
    assert.match(block, /flex-basis/);
    assert.match(block, /max-width/);
    assert.equal(code(console_).match(/className="data-console-stack"/g)?.length, 1, "the stack has a second tenant; its node-sizing scope needs revisiting");
  });
});
