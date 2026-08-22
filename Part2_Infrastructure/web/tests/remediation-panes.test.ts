/**
 * Remediation as five panes, and the four ways splitting a section goes wrong.
 *
 * The section was three stacked cards in one scroll — controls, the state
 * machine that explains recovery, and the ledger of what has been done; the
 * controls card later split again along its blast-radius seam, into guarded
 * server mutations and browser-only session controls (Session). The fifth pane
 * finished that split: the five server writes kept the pane a reader lands on,
 * and the REFERENCE half they were sharing it with — the ring of provider
 * routing states and the three counts under it — moved to Scope. Both are
 * `OperatorPanel`, rendered from one `part` prop and one mount, so a chosen
 * purge scope and a previewed confirmation survive a switch between them.
 * Cutting a section into panes is cheap; the failure modes are not, and none of
 * them is visible to a type checker:
 *
 *  1. A second `<WorkspaceSubtabs>` publishes `--rail-h` from a ResizeObserver
 *     and its own comment asserts exactly one rail is mounted, so a nested one
 *     fights the first over every sticky offset in the app.
 *  2. Switching with `hidden` rather than a conditional render leaves the
 *     ledger's 15s poll running behind a pane nobody is reading — the exact
 *     defect `active` was threaded through it to prevent, reintroduced one
 *     level lower.
 *  3. Landing on a reference pane puts the only surface with buttons on it
 *     behind a click, in the section a reader opens mid-incident.
 *  4. An action confirmed on Act and then read from History reports nowhere:
 *     `OperatorPanel` renders its own result inline, and the console-level
 *     banner used to suppress itself for the whole section.
 *
 * Source-level assertions, like the workspace suite this extends: there is no
 * DOM here, and the properties worth pinning are structural.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const console_ = read("../components/ReliabilityConsole.tsx");
/**
 * `OperatorPanel` passed the length ceiling after the pane split and was cut
 * again along the same seam: the five guarded server mutations to
 * `OperatorControls`, the browser-only session controls to `SessionControls`.
 * Authorisation, the confirmation state and the dispatch stayed in the panel,
 * which is why the gate is still read from it below and the controls are not.
 */
const operator = read("../components/systems/OperatorPanel.tsx");
const operatorControls = read("../components/systems/OperatorControls.tsx");
const guard = read("../components/systems/OperatorGuard.tsx");
/**
 * The Dependencies switcher this one is held against. `ReliabilityOverview` is
 * now a seam over `ReliabilityAttention` and `ReliabilityPlanes`; the switcher
 * went with `planes`, and the seam file would satisfy no regex here — it would
 * pass by matching nothing.
 */
const planes = read("../components/systems/ReliabilityPlanes.tsx");

/** Comments name the constructs they are explaining the absence of. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");

/** The body of the `controls` subtab panel, which is what the panes live in. */
function controlsPanel(source: string): string {
  const start = source.indexOf('tabId="controls"');
  assert.ok(start > 0, "ReliabilityConsole no longer renders a controls panel");
  const end = source.indexOf("</WorkspaceSubtabPanel>", start);
  assert.ok(end > start, "the controls panel is unterminated");
  return source.slice(start, end);
}

describe("Remediation splits into five panes, not a second rail", () => {
  it("switches with `.seg role=\"group\"`, never a nested WorkspaceSubtabs", () => {
    /**
     * `WorkspaceSubtabs` sets `--rail-h` on the document element from a
     * ResizeObserver and documents that exactly one rail is mounted at a time.
     * A second instance is not a layout preference — it is two observers
     * writing one variable, and every sticky offset and `scroll-margin-top` in
     * the app reads it.
     */
    assert.equal(
      code(console_).match(/<WorkspaceSubtabs\b/g)?.length,
      1,
      "a second rail would fight the first over --rail-h",
    );
    assert.match(controlsPanel(console_), /className="seg [^"]*" role="group"/);
  });

  it("offers exactly five panes and no more", () => {
    const start = console_.indexOf("const REMEDIATION_PANES");
    assert.ok(start > 0, "the pane list is no longer a module-level constant");
    const block = console_.slice(start, console_.indexOf("];", start));
    const ids = [...block.matchAll(/\{\s*id:\s*"(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, ["mutations", "scope", "session", "recovery", "history"]);
    // The pane the reader lands on leads the switcher. A default that is not
    // first reads as a selection someone made rather than as the way in.
    assert.equal(ids[0], "mutations");
  });

  it("carries a hint on every pane, as the Dependencies switcher does", () => {
    // `title={option.hint}` is the whole reason the pane list is objects rather
    // than strings: a three-word label cannot say what a pane answers.
    const start = console_.indexOf("const REMEDIATION_PANES");
    const block = console_.slice(start, console_.indexOf("];", start));
    const hints = [...block.matchAll(/hint:\s*"([^"]*)"/g)].map((match) => match[1]);
    assert.equal(hints.length, 5);
    for (const hint of hints) assert.ok(hint.length > 24, `a hint that says nothing: "${hint}"`);
    assert.match(controlsPanel(console_), /title=\{option\.hint\}/);
    assert.match(controlsPanel(console_), /aria-pressed=\{remediationPane === option\.id\}/);
    // Same shape as the shipped one, so the two cannot drift into two patterns.
    assert.match(planes, /title=\{option\.hint\}/);
  });

  it("opens on Mutations, the only pane with controls on it", () => {
    /**
     * A reader reaches Remediation mid-incident, from "Recover safely" on the
     * triage path. Landing them on a state-machine diagram — or on the scope
     * ring, which answers a question asked before deciding rather than while
     * pressing — puts every button behind a click they did not know they had to
     * make. Scope is the pane that moved when the fifth was added, precisely so
     * this stayed true.
     */
    assert.match(console_, /useState<RemediationPane>\("mutations"\)/);
  });
});

describe("a switched-away pane stops doing work", () => {
  it("renders conditionally, never behind `hidden`", () => {
    const panel = code(controlsPanel(console_));
    for (const pane of ["session", "recovery", "history"]) {
      assert.match(
        panel,
        new RegExp(`remediationPane === "${pane}" && \\(`),
        `the ${pane} pane is not a conditional render`,
      );
    }
    /**
     * Mutations and Scope are the two `part`s of one component, so they are one
     * conditional render rather than two — and that is a property worth pinning
     * rather than a shortcut to tolerate. Two renders would remount
     * `OperatorPanel` on every switch between them, discarding the chosen purge
     * scope, the chosen quota target and a confirmation already previewed. The
     * pane is still CONDITIONAL: switch to Session and the whole subtree goes.
     */
    assert.match(
      panel,
      /\(remediationPane === "mutations" \|\| remediationPane === "scope"\) && \(/,
      "the two OperatorPanel parts are no longer one conditional render",
    );
    assert.equal(
      (panel.match(/<OperatorPanel\b/g) ?? []).length,
      1,
      "a second OperatorPanel mount is a second copy of the purge scope and the pending confirmation",
    );
    assert.match(panel, /part=\{remediationPane\}/, "the shared mount no longer says which part it is");
    // `hidden` keeps the subtree mounted, which is right for the section rail
    // (a typed token and a chosen purge scope survive a switch) and wrong here.
    assert.doesNotMatch(panel, /hidden=/);
  });

  it("gates the ledger's poll on the pane as well as the section", () => {
    /**
     * Both clauses, exactly as `BlotterViews` gates `WorkingOrders`. The section
     * clause is load-bearing today because `WorkspaceSubtabPanel` hides rather
     * than unmounts. The pane clause is redundant only for as long as the panes
     * stay conditional renders — and the day someone switches them to `hidden`
     * to preserve scroll position, a 15s poll must not quietly come back.
     */
    assert.match(
      controlsPanel(console_),
      /active=\{active && section === "controls" && remediationPane === "history"\}/,
    );
  });

  it("leaves the correlated event stream's own gate alone", () => {
    // TraceConsole is pinned to one instance on this tab and gated on its own
    // section; the pane split must not have touched either.
    assert.equal(console_.match(/<TraceConsole/g)?.length, 1);
    assert.ok(console_.includes('active={active && section === "events"}'));
  });
});

describe("an action outcome is reported from wherever the reader is", () => {
  it("shows the console banner whenever the panel that renders it inline is gone", () => {
    /**
     * `OperatorPanel` renders `lastResult` beside the button that caused it, so
     * the console-level banner is the fallback for every other position. Once
     * the writes became a pane, "not the controls section" stopped covering the
     * case — Recovery and History are the controls section with no result on
     * screen. Scope is the subtler one: the panel IS mounted there, sharing a
     * mount with Mutations, and `part="scope"` renders no result — so the gate
     * has to name the part rather than the component.
     */
    assert.match(
      console_,
      /\(section !== "controls" \|\| remediationPane !== "mutations"\) && actionResult/,
    );
    assert.match(code(operator), /\{lastResult && <OperatorActionResult result=\{lastResult\} \/>\}/);
  });
});

describe("the extraction moved authorisation and left every cost behind", () => {
  it("keeps the guard's refusal readable before anything is clicked", () => {
    // Showing enabled buttons that 503 is worse than disabled ones with the
    // reason attached, so the reason has to survive the move.
    assert.match(guard, /Actions are disabled on this deployment/);
    assert.match(guard, /operator actions are open to anyone with this URL/);
    assert.match(code(operator), /<OperatorGuard/);
    // And it is one authorisation state, not a per-control fact: nothing about
    // spend travelled with it. Comments stripped — this file's header names the
    // very sentences it is explaining the absence of.
    assert.doesNotMatch(code(guard), /spends a real call|Destroys this instance|vendor/);
  });

  it("leaves the gate in the panel, and the three confirmed actions behind it", () => {
    /**
     * The second extraction moved rendering, not authorisation. `disabled` is
     * still derived in the panel from the guard and threaded down, so a control
     * file cannot decide for itself that it is enabled; the three actions that
     * require a preview are still the same three, and they are read from the
     * file that now renders them rather than from the shell that dispatches.
     */
    const panel = code(operator);
    assert.match(panel, /const locked = guard === "locked"/);
    assert.match(panel, /const disabled = locked \|\| missingToken/);
    const controls = code(operatorControls);
    assert.match(controls, /action: "purge_cache"/);
    assert.match(controls, /action: "reset_quota"/);
    assert.match(controls, /action: "clear_telemetry"/);
  });
});
