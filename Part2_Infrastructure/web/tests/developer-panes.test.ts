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
 *
 * The console is no longer one file. `DeveloperConsole.tsx` passed the length
 * ceiling and each section moved to `components/developer/` along the seams the
 * section rail already drew — `DeveloperOverview` (topology and readiness),
 * `DeveloperPipelines` (CI / CD), `DeveloperInterfaces` (API & Schema) and the
 * shared vocabulary in `DeveloperStatus`. Nothing below changed its claim: an
 * assertion about ONE component reads that component's file, and an assertion
 * about what the whole TAB mounts reads `tab`, the group of files that make it.
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
const overview_ = read("../components/developer/DeveloperOverview.tsx");
const pipelines_ = read("../components/developer/DeveloperPipelines.tsx");
const interfaces_ = read("../components/developer/DeveloperInterfaces.tsx");
const status_ = read("../components/developer/DeveloperStatus.tsx");
const explorer = read("../components/developer/CodebaseExplorer.tsx");
const queue = read("../components/developer/DeveloperWorkQueue.tsx");
const catalog = read("../components/developer/DeveloperApiCatalog.tsx");
const health = read("../lib/use-system-health.ts");

/**
 * Every file the Developer tab renders from, as one string.
 *
 * Only for the claims that are about the TAB rather than about a component:
 * how many rails it mounts, how many times one card appears on it, whether it
 * offers a refresh anywhere. Those used to be a scan of the single console
 * file; reading the group is what keeps them meaning the same thing after the
 * split, and keeps a second rail from arriving inside a section file unseen.
 */
const tab = [console_, overview_, pipelines_, interfaces_, status_, explorer, queue, catalog].join("\n");

/** The body of a top-level function, up to the next one. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start > 0, `${name} is no longer declared in the file this test reads it from`);
  const next = source.indexOf("\nfunction ", start + 1);
  const exported = source.indexOf("\nexport ", start + 1);
  const ends = [next, exported].filter((index) => index > start);
  return source.slice(start, ends.length ? Math.min(...ends) : source.length);
}

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
    assert.equal(code(tab).match(/<WorkspaceSubtabs\b/g)?.length, 1);
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
      const body = code(functionBody(source, component));
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
  const pipelines = code(functionBody(pipelines_, "DeveloperPipelines"));
  const interfaces = code(functionBody(interfaces_, "DeveloperInterfaces"));

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
    // Counted over the whole tab, as it was when the tab was one file: the
    // parity card is mounted in exactly one pane, in one section.
    assert.equal(code(tab).match(/<McBrowserParityCheck \/>/g)?.length, 1);
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
    // Read across the tab, not just the shell: the head is still in
    // `DeveloperConsole`, but the sections take the same `view` and any of
    // them could grow the button the head lost.
    const source = code(tab);
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
    const source = code(overview_);
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

/**
 * The launch-readiness ladder, and the two states it used to merge.
 *
 * The panel reported "3/5 PASS — BLOCKED" with the gateway unreachable
 * (ECONNREFUSED) and the schema gate reading "Drift detected — the live
 * gateway OpenAPI contract differs from the committed contract". Nothing had
 * read that contract: `lib/delivery-readiness.ts` holds a comparison for five
 * minutes, so for five minutes after the port stops answering the payload
 * still carries the verdict of the last document anything read. A stale
 * "Drift detected" is a finding with no live document behind it, and the same
 * cache would have replayed "Exact match" just as happily — a promotion-grade
 * pass invented from a dead gateway, which is the worse half of the defect.
 *
 * The second half is the ladder itself. A gate that ran and failed and a gate
 * that could not run are different states, and one summary line called both
 * "blocking launch", so the reader could not tell a defect to chase from
 * evidence to restore.
 */
describe("a readiness gate that could not run is not a gate that failed", () => {
  // The derivations are `DeveloperStatus` — the one place the ladder is
  // spelled — and the panel that counts them is `DeveloperOverview`. Two files
  // now, one claim: a state that carries no reading is `unmeasured`, and the
  // ladder reports it as neither a pass nor a failure.
  const schema = code(functionBody(status_, "schemaCompatibilityState"));
  const overview = code(functionBody(overview_, "DeveloperOverview"));

  it("refuses a live-contract verdict when the gateway did not answer this poll", () => {
    // `platform` is set only from a gateway snapshot this poll returned, so its
    // absence is the one fact that says no live document could have been read.
    assert.match(schema, /!view\.health\.platform && evidence\.state !== "unavailable"/);
    assert.match(schema, /Nothing read the live contract this poll/);
    // The refusal keeps the earlier reading as history rather than deleting it,
    // and marks itself unmeasured so the ladder cannot score it either way.
    assert.match(schema, /an earlier reading found \$\{earlier\}/);
    assert.match(schema, /label: "Unverified", detail, tone: "warn", unmeasured: true/);
  });

  it("still separates a verified difference from an unverifiable one", () => {
    // Drift stays a hard finding when the gateway did answer: the point is not
    // to soften the word, it is to earn it.
    assert.match(schema, /evidence\.state === "mismatch"\) return \{ label: "Drift detected"/);
    assert.match(schema, /evidence\.state === "match"\) return \{ label: "Exact match"/);
  });

  it("counts three verdicts, and calls only the failures blocking", () => {
    assert.match(overview, /const failedChecks = readinessChecks\.filter\(\(check\) => check\.state === "failed"\)/);
    assert.match(overview, /const unverifiedChecks = readinessChecks\.filter\(\(check\) => check\.state === "unverified"\)/);
    assert.doesNotMatch(overview, /blockedChecks/, "the old two-state split is back");
    assert.doesNotMatch(overview, /passed:/, "a readiness check still carries a boolean pass");
    // READY needs every gate; BLOCKED needs a failure; anything else is neither.
    assert.match(overview, /failedChecks\.length \? "BLOCKED" : "UNVERIFIED"/);
    assert.match(overview, /are"\} blocking launch/);
    assert.match(overview, /could not be checked at all/);
    assert.match(overview, /neither a pass nor a failure/);
  });

  it("tells the three states apart with marks, not with one colour", () => {
    // `.developer-cp-readiness__checks i` styles `is-good` and `is-warn` only,
    // so a failure and an unrun check share a dot; the glyph is what separates
    // them, and forced-colors strips the fill before it strips the glyph.
    assert.match(overview, /check\.state === "pass" \? "✓" : check\.state === "failed" \? "✕" : "◌"/);
    assert.doesNotMatch(overview, /\? "✓" : "!"/, "the exclamation mark is back in the status vocabulary");
    assert.match(overview, /readiness checks pass, \$\{failedChecks\.length\} failed, \$\{unverifiedChecks\.length\} could not be checked/);
  });

  it("reports a gate with nothing behind it as unmeasured, per source", () => {
    /**
     * Which states are measurements and which are absences, stated once here so
     * a later edit has to argue with it: a refused connection is a measurement
     * (the gate ran, the gateway is not healthy); an unconfigured gateway, an
     * unpinned signing key and a build that is not a deployment are absences.
     */
    const gateway = code(functionBody(status_, "gatewayState"));
    const artifact = code(functionBody(status_, "artifactCustodyState"));
    assert.match(gateway, /tone: off \? "off" : "warn", unmeasured: off/);
    assert.match(artifact, /"untrusted"\) return \{ label: "No trust root", detail: evidence\.detail, tone: "warn", unmeasured: true/);
    assert.match(artifact, /"invalid"\) return \{ label: "Invalid", detail: evidence\.detail, tone: "bad" \}/);
    assert.match(overview, /IS_VERCEL_DEPLOYMENT \? gateVerdict\(currentWorkspace\) : "unverified"/);
    assert.match(overview, /there is no promotion candidate to check/);
  });
});
