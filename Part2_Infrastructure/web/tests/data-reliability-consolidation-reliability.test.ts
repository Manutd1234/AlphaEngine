/**
 * Reliability after the repeats were removed: what went, and what had to
 * survive for the removal to have been free.
 *
 * Three of the five edits in one consolidation pass over Data and Reliability.
 * Every one of them is a DELETION, which is the dangerous kind — a removed
 * control leaves no evidence of itself, so the failure mode is not "the edit
 * broke something" but "the edit took the last route out with it and nobody
 * noticed":
 *
 *  3. Repeated controls were removed: one "Manage in Providers" per outage row
 *     that all called the same argument-less handler, and two console tiles
 *     that linked where the global header already links. The risk in both is
 *     removing the last route rather than the repeat, so what survives is
 *     asserted here as well as what went.
 *
 *     The incident path is the mirror image and sits with them: three buttons
 *     pointing at three sibling rail tabs, which looks like exactly the kind of
 *     duplication just deleted and is not. What guards it is the note saying
 *     why, so the note is asserted too.
 *
 *  4. `Logs` moved into a row menu. It is the only READ on that row; the other
 *     four spend a provider call, remove a live provider from routing, or
 *     mutate a breaker. This codebase's rule is that a control which changes
 *     trading state states its cost beside the button, so the menu must hold
 *     the read and nothing else.
 *
 * The Data Trust half of the same pass is in
 * `data-reliability-consolidation-feeds-panes.test.ts`, and the mocked work
 * queue in `data-reliability-consolidation-work-queue.test.ts`.
 *
 * Source-level assertions, like the workspace and remediation suites: there is
 * no DOM here, and the properties worth pinning are structural.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { globalsCss } from "./globals-css";
import { readSource, stripCode as code } from "./helpers/source-files";

const outages = readSource("components/systems/OutageIncidents.tsx");
const reliabilityConsole = readSource("components/ReliabilityConsole.tsx");
/**
 * `ReliabilityOverview` passed the ceiling a second time and became a seam over
 * two conditionally mounted halves: `ReliabilityAttention` is triage and the
 * incident path, `ReliabilityPlanes` is what the system depends on. The
 * numbered card is triage, so it is read from `attention`; the seam file holds
 * neither half's markup and would satisfy none of the regexes below — it would
 * pass by matching nothing.
 */
const reliabilityAttention = readSource("components/systems/ReliabilityAttention.tsx");
const healthMatrix = readSource("components/systems/HealthMatrix.tsx");
const page = readSource("app/dashboard/page.tsx");

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
