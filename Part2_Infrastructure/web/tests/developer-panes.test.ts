/**
 * The Developer console after the duplicate controls came out.
 *
 * Two sections were split into panes and four controls were deleted, and each
 * of those is a claim that can quietly stop being true:
 *
 *  1. A pane switcher that switches with `hidden` leaves both panes mounted.
 *     Nothing under CI / CD polls today, but Numerics owns a Blob worker, and
 *     `ReliabilityConsole` already records what a mounted-but-unread pane costs.
 *  2. A `.seg` is `flex: 1` per button. Four options force abbreviated labels,
 *     which is why the stylesheet's own note beside the rule sends four-way
 *     choices to a grouped `<select>` instead.
 *  3. A deleted control comes back the moment someone reads the surface as
 *     missing an affordance rather than as having one control for one
 *     capability. The next-status button offered one of the five transitions
 *     the select beside it already offered; the three composer buttons were one
 *     action with a three-way parameter that the composer's own Type select
 *     carries; the reset rebuilt a fixture a reload rebuilds; and the refresh
 *     called the shared 30s health poll a second time.
 *  4. Deleting controls can strip a panel to nothing. `scripts/desk-sweep.mjs`
 *     fails a panel with zero data points AND zero controls, so the work queue
 *     has to still be usable after losing two buttons per row and one in the
 *     footer.
 *
 * Source-level assertions, like the workspace and remediation suites this
 * extends: there is no DOM here, and the properties worth pinning are
 * structural.
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

const console_ = read("../components/DeveloperConsole.tsx");
const queue = read("../components/developer/DeveloperWorkQueue.tsx");
const catalog = read("../components/developer/DeveloperApiCatalog.tsx");
const health = read("../lib/use-system-health.ts");

/** The body of a top-level function, up to the next one. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `DeveloperConsole no longer declares ${name}`);
  const next = source.indexOf("\nfunction ", start + 1);
  const exported = source.indexOf("\nexport ", start + 1);
  const ends = [next, exported].filter((index) => index > start);
  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

/** A pane list literal, as {id, label, hint} triples. */
function panes(name: string): Array<{ id: string; label: string; hint: string }> {
  const start = console_.indexOf(`const ${name}`);
  assert.ok(start > 0, `${name} is no longer a module-level constant`);
  const block = console_.slice(start, console_.indexOf("];", start));
  return [...block.matchAll(/\{\s*id:\s*"(\w+)",\s*label:\s*"([^"]*)",\s*hint:\s*"([^"]*)"/g)]
    .map((match) => ({ id: match[1], label: match[2], hint: match[3] }));
}

describe("the two dense Developer sections split into panes, not a second rail", () => {
  it("keeps exactly one WorkspaceSubtabs on the tab", () => {
    /**
     * `WorkspaceSubtabs` publishes `--rail-h` from a ResizeObserver and its own
     * comment asserts that exactly one rail is mounted at a time. Two rails are
     * two observers writing one variable that every sticky offset in the app
     * reads, so a split section switches with `.seg` as Remediation does.
     */
    assert.equal(code(console_).match(/<WorkspaceSubtabs\b/g)?.length, 1);
    assert.match(functionBody(console_, "DeveloperPipelines"), /className="seg" role="group"/);
    assert.match(functionBody(console_, "DeveloperInterfaces"), /className="seg" role="group"/);
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
    for (const component of ["DeveloperPipelines", "DeveloperInterfaces"]) {
      const body = code(functionBody(console_, component));
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
    assert.deepEqual(panes("QUALITY_PANES").map((pane) => pane.id), ["pipeline", "verification"]);
    assert.deepEqual(panes("INTERFACE_PANES").map((pane) => pane.id), ["contracts", "routes", "numerics"]);
    for (const name of ["QUALITY_PANES", "INTERFACE_PANES"]) {
      const count = panes(name).length;
      assert.ok(count >= 2 && count <= 3, `${name} holds ${count} options; a .seg holds two or three`);
    }
  });

  it("carries a hint on every pane, as Remediation and Dependencies do", () => {
    // The pane lists are objects rather than strings for this: a one-word label
    // cannot say what a pane answers, and the hint is what the title attribute
    // shows before the reader has clicked anything.
    for (const name of ["QUALITY_PANES", "INTERFACE_PANES"]) {
      for (const pane of panes(name)) {
        assert.ok(pane.hint.length > 24, `${name}.${pane.id} has a hint that says nothing`);
      }
    }
    for (const component of ["DeveloperPipelines", "DeveloperInterfaces"]) {
      const body = functionBody(console_, component);
      assert.match(body, /title=\{option\.hint\}/, `${component}'s switcher drops the hints`);
      assert.match(body, /aria-pressed=\{pane === option\.id\}/, `${component} loses the pressed state`);
    }
  });

  it("opens on the pane that answers the question the section is named for", () => {
    // CI / CD is reached from "Open CI / CD" on the topology card, which is a
    // reader asking what this commit is doing; API & Schema opens on the gates
    // rather than on the route list, because the gates are the verdict.
    assert.match(console_, /useState<QualityPane>\("pipeline"\)/);
    assert.match(console_, /useState<InterfacePane>\("contracts"\)/);
  });
});

describe("a switched-away pane is unmounted, not hidden", () => {
  const pipelines = code(functionBody(console_, "DeveloperPipelines"));
  const interfaces = code(functionBody(console_, "DeveloperInterfaces"));

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
    assert.match(verificationPane, /<CategoryBars/);
    assert.match(verificationPane, /<ArtifactLineage/);
    assert.doesNotMatch(pipelinePane, /<CategoryBars|<ArtifactLineage/);
    assert.doesNotMatch(verificationPane, /<PipelineStrip/);

    assert.equal(interfaces.match(/<SchemaGateTable/g)?.length, 1);
    assert.equal(interfaces.match(/<DeveloperApiCatalog \/>/g)?.length, 1);
    assert.equal(code(console_).match(/<McBrowserParityCheck \/>/g)?.length, 1);
  });

  it("keeps the browser parity run beside the row it corroborates", () => {
    /**
     * The alternative was Readiness, beside artifact custody. It reads as a
     * custody question, but the run is one third of a three-way comparison
     * whose other two thirds — the committed reference and this deployment's
     * Node runtime — are the "Monte Carlo numerics" row of the schema table.
     * Splitting them would leave a reader who finds a mismatch holding two
     * sections in their head to say which runtime disagreed.
     */
    const numerics = interfaces.slice(interfaces.indexOf('pane === "numerics"'));
    assert.match(numerics, /<McBrowserParityCheck \/>/);
    assert.match(console_, /object: "Monte Carlo numerics"/);
    assert.match(functionBody(console_, "SchemaGateTable"), /Monte Carlo numerics/);
  });
});

describe("one control per capability in the engineering queue", () => {
  it("moves a row through its status select alone", () => {
    /**
     * The deleted button called `move(item, nextStatus(item.status))` — one of
     * the five transitions the select forty pixels to its left already offers,
     * and the only one it could reach. Two controls for one field is two things
     * to keep in agreement, and the reader who picked the wrong one had to come
     * back to the select regardless.
     */
    const source = code(queue);
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
    const source = code(queue);
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
    const source = code(queue);
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
    const source = code(queue);
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
    const source = code(console_);
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
     */
    const source = code(console_);
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
    const source = code(catalog);
    assert.match(source, /className="seg developer-api-catalog__groups"/);
    assert.match(source, /Copy curl/);
    assert.match(source, /No matching operations/);
  });
});
