/**
 * The two dense Developer sections after they were split into panes.
 *
 * Two claims are made by that split, and each can quietly stop being true:
 *
 *  1. A pane switcher that switches with `hidden` leaves both panes mounted.
 *     Nothing under CI / CD polls today, but Numerics owns a Blob worker, and
 *     `ReliabilityConsole` already records what a mounted-but-unread pane costs.
 *  2. A `.seg` is `flex: 1` per button. Four options force abbreviated labels,
 *     which is why the stylesheet's own note beside the rule sends four-way
 *     choices to a grouped `<select>` instead.
 *
 * Source-level assertions, like the workspace and remediation suites this
 * extends: there is no DOM here, and the properties worth pinning are
 * structural. The files being read, and the difference between reading one
 * component and reading the whole tab, are in `tests/helpers/developer-sources`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { functionBody, interfaces_, pipelines_, status_, tab } from "./helpers/developer-sources";
import { stripCode } from "./helpers/source-files";

/** A pane list literal, as {id, label, hint} triples, from the file that owns it. */
function panes(source: string, name: string): Array<{ id: string; label: string; hint: string }> {
  const start = source.indexOf(`const ${name}`);
  assert.ok(start > 0, `${name} is no longer a module-level constant`);
  const block = source.slice(start, source.indexOf("];", start));
  return [...block.matchAll(/\{\s*id:\s*"(\w+)",\s*label:\s*"([^"]*)",\s*hint:\s*"([^"]*)"/g)]
    .map((match) => ({ id: match[1], label: match[2], hint: match[3] }));
}

/** The pane lists and the components that render them, paired with their file. */
const PANE_SECTIONS = [
  { component: "DeveloperPipelines", constant: "QUALITY_PANES", source: pipelines_ },
  { component: "DeveloperInterfaces", constant: "INTERFACE_PANES", source: interfaces_ },
] as const;

describe("the two dense Developer sections split into panes, not a second rail", () => {
  it("keeps exactly one WorkspaceSubtabs on the tab", () => {
    /**
     * `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver and its own
     * comment asserts that exactly one rail is mounted at a time. Two rails are
     * two observers writing one variable that every sticky offset in the app
     * reads, so a split section switches with `.seg` as Remediation does.
     *
     * Counted across every file the tab renders from, not just the shell: the
     * sections are their own files now, and a rail added inside one of them
     * would be the same two observers.
     */
    assert.equal(stripCode(tab).match(/<WorkspaceSubtabs\b/g)?.length, 1);
    for (const { component, source } of PANE_SECTIONS) {
      assert.match(functionBody(source, component), /className="seg" role="group"/);
    }
  });

  it("puts the switcher in the panel's block flow, not inside the card stack", () => {
    /**
     * `.developer-cp-stack` is `display: grid` with no explicit columns, and
     * `.developer-cp-schema-card` / `.developer-cp-artifact-card` carry
     * `grid-column: span 6` for the Readiness grid. A six-column span in a
     * container with no explicit columns creates six implicit columns, so a
     * switcher placed inside the stack becomes a grid item in column 1 with the
     * first card beside it rather than below it — measured at 244px against a
     * 1400px panel. Outside the stack it is a block in the subtab panel, which
     * is where the Positions and Remediation switchers sit too.
     */
    for (const { component, source } of PANE_SECTIONS) {
      const body = stripCode(functionBody(source, component));
      const seg = body.indexOf('className="seg"');
      const stack = body.indexOf('className="developer-cp-stack"');
      assert.ok(seg > 0 && stack > 0, `${component} lost its switcher or its stack`);
      assert.ok(seg < stack, `${component} renders its switcher inside the six-column stack`);
    }
  });

  it("offers two CI / CD panes and three API panes, and never four", () => {
    // `.seg button { flex: 1 }`: a fourth option abbreviates every label. The
    // stylesheet records the rule at `.allocation-controls`, where four methods
    // became a grouped select for exactly this reason.
    assert.deepEqual(panes(pipelines_, "QUALITY_PANES").map((pane) => pane.id), ["pipeline", "verification"]);
    assert.deepEqual(panes(interfaces_, "INTERFACE_PANES").map((pane) => pane.id), ["contracts", "routes", "numerics"]);
    for (const { constant, source } of PANE_SECTIONS) {
      const count = panes(source, constant).length;
      assert.ok(count >= 2 && count <= 3, `${constant} holds ${count} options; a .seg holds two or three`);
    }
  });

  it("carries a hint on every pane, as Remediation and Dependencies do", () => {
    // The pane lists are objects rather than strings for this: a one-word label
    // cannot say what a pane answers, and the hint is what the title attribute
    // shows before the reader has clicked anything.
    for (const { component, constant, source } of PANE_SECTIONS) {
      for (const pane of panes(source, constant)) {
        assert.ok(pane.hint.length > 24, `${constant}.${pane.id} has a hint that says nothing`);
      }
      const body = functionBody(source, component);
      assert.match(body, /title=\{option\.hint\}/, `${component}'s switcher drops the hints`);
      assert.match(body, /aria-pressed=\{pane === option\.id\}/, `${component} loses the pressed state`);
    }
  });

  it("opens on the pane that answers the question the section is named for", () => {
    // CI / CD is reached from "Open CI / CD" on the topology card, which is a
    // reader asking what this commit is doing; API & Schema opens on the gates
    // rather than on the route list, because the gates are the verdict.
    assert.match(pipelines_, /useState<QualityPane>\("pipeline"\)/);
    assert.match(interfaces_, /useState<InterfacePane>\("contracts"\)/);
  });
});

describe("a switched-away pane is unmounted, not hidden", () => {
  const pipelines = stripCode(functionBody(pipelines_, "DeveloperPipelines"));
  const interfaces = stripCode(functionBody(interfaces_, "DeveloperInterfaces"));

  it("renders every pane conditionally", () => {
    for (const pane of ["pipeline", "verification"]) {
      assert.match(pipelines, new RegExp(`pane === "${pane}" && \\(`), `the ${pane} pane is not a conditional render`);
    }
    for (const pane of ["contracts", "routes", "numerics"]) {
      assert.match(interfaces, new RegExp(`pane === "${pane}" &&`), `the ${pane} pane is not a conditional render`);
    }
  });

  it("never switches a pane with `hidden`", () => {
    // `hidden` keeps the subtree mounted. That is right for the section rail —
    // a typed search term survives a switch — and wrong here: the Numerics pane
    // owns a Blob worker, and a simulation nobody can see is a thread nobody
    // can stop.
    assert.doesNotMatch(pipelines, /hidden=/);
    assert.doesNotMatch(interfaces, /hidden=/);
  });

  it("puts each card in exactly one pane", () => {
    /**
     * The failure mode of a split is a card that ends up in both panes, or in
     * neither. Both are invisible to a type checker and to every other test in
     * this suite.
     */
    const pipelinePane = pipelines.slice(pipelines.indexOf('pane === "pipeline"'), pipelines.indexOf('pane === "verification"'));
    const verificationPane = pipelines.slice(pipelines.indexOf('pane === "verification"'));
    assert.match(pipelinePane, /developer-cp-section-hero/);
    assert.match(pipelinePane, /<PipelineStrip \/>/);
    assert.match(verificationPane, /developer-cp-jobs/);
    assert.match(verificationPane, /<CiCountBars/);
    assert.match(verificationPane, /<ArtifactLineage/);
    assert.doesNotMatch(pipelinePane, /<CiCountBars|<ArtifactLineage/);
    assert.doesNotMatch(verificationPane, /<PipelineStrip/);

    assert.equal(interfaces.match(/<SchemaGateTable/g)?.length, 1);
    assert.equal(interfaces.match(/<DeveloperApiCatalog \/>/g)?.length, 1);
    // Counted over the whole tab, as it was when the tab was one file: the
    // parity card is mounted in exactly one pane, in one section.
    assert.equal(stripCode(tab).match(/<McBrowserParityCheck \/>/g)?.length, 1);
  });

  it("keeps the browser parity run beside the row it corroborates", () => {
    /**
     * The alternative was Readiness, beside artifact custody. It reads as a
     * custody question, but the run is one third of a three-way comparison
     * whose other two thirds — the committed reference and this deployment's
     * Node runtime — are the "Monte Carlo numerics" row of the schema table.
     * Splitting them would leave a reader who finds a mismatch holding two
     * sections in their head to say which runtime disagreed.
     *
     * The row and the table are in `DeveloperStatus` now — the shared
     * vocabulary every Developer section reports in — and the run is in
     * `DeveloperInterfaces` beside the pane that shows the table.
     */
    const numerics = interfaces.slice(interfaces.indexOf('pane === "numerics"'));
    assert.match(numerics, /<McBrowserParityCheck \/>/);
    assert.match(status_, /object: "Monte Carlo numerics"/);
    assert.match(functionBody(status_, "SchemaGateTable"), /Monte Carlo numerics/);
  });
});
