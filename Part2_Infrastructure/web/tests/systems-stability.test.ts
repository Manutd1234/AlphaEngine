/**
 * The Systems tab against a flapping gateway.
 *
 * The desk's cured defect class: a panel that alternates between real and
 * generated content — or between content and an error card — on the poll
 * cadence, because a single failed probe was allowed to erase what a
 * successful one had established. The cure is one-directional asymmetry
 * (`DeskSourceMachine`, `VenueLiveness`): demotion is immediate and worded as
 * a condition, erasure never happens, and recovery is not a licence to forget
 * the failure mid-oscillation.
 *
 * Every surface on this tab that polls or streams is held to that shape here.
 * Most of these are pins — the tab already routes health through the one
 * shared `useSystemHealth` view, which retains the last good snapshot — and a
 * pin is kept precisely because the cockpit's twitch was once reintroduced by
 * a refactor nobody thought was about data provenance.
 *
 * Source-level assertions, like `remediation-panes.test.ts` and
 * `breaker-machine.test.ts`: there is no DOM in this suite, the machines
 * already have behavioural suites of their own (`desk-source.test.ts`,
 * `venue-liveness.test.ts`), and what is worth pinning about the components
 * is structural — which state a branch is allowed to depend on.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Comments name the constructs whose absence they explain. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\/.*$/gm, "");

const SYSTEMS_DIR = fileURLToPath(new URL("../components/systems", import.meta.url));
const systemsFiles = readdirSync(SYSTEMS_DIR).filter((f) => /\.(ts|tsx)$/.test(f));
const systemsSources = new Map(
  systemsFiles.map((f) => [f, read(`../components/systems/${f}`)]),
);

const ledger = read("../components/systems/RemediationLedger.tsx");
const trace = read("../components/systems/TraceConsole.tsx");
const inspector = read("../components/systems/PipelineInspector.tsx");
const matrix = read("../components/systems/HealthMatrix.tsx");
const breaker = read("../components/systems/BreakerStateMachine.tsx");
const planes = read("../components/systems/ReliabilityPlanes.tsx");
const platform = read("../components/systems/ReliabilityPlatform.tsx");
const socketTrace = read("../components/systems/PipelineSocketTrace.tsx");
const consoleShell = read("../components/ReliabilityConsole.tsx");

describe("a failed poll demotes what is on screen; it never erases it", () => {
  it("the remediation ledger's failed read records the failure and touches nothing else", () => {
    // The state half of the anti-twitch rule: `data` is the last successful
    // read and only a successful read may move it. A catch that nulled it
    // would re-create the cockpit's setBook(null).
    assert.match(code(ledger), /catch \(cause\) \{\s*setError/);
    assert.doesNotMatch(code(ledger), /setData\(null\)/);
  });

  it("the ledger keeps its history on screen through an outage, with the failure as a note", () => {
    /**
     * The render half. Forking the whole body on `error` swaps the charts for
     * an error card on every failed poll — at the 15s cadence against a route
     * refusing every other request, that is the panel alternating between a
     * full history and a one-line apology four times a minute. The error-only
     * card is legitimate exactly once: when the ring has never been read.
     */
    const source = code(ledger);
    assert.doesNotMatch(source, /\{error \? \(/,
      "the body must not fork on the failure flag; retained history outranks a transient error");
    assert.match(source, /\{data && !model\.trips && \(/,
      "the no-trips claim needs a settled read behind it");
    assert.match(source, /\{data && model\.trips > 0 && \(/);
    assert.match(ledger, /last successful read/,
      "a retained figure must say it is retained, as the console tile does");
  });

  it("the ledger does not claim a clean record before the first read settles", () => {
    // `deriveRemediation([])` reports zero trips, and zero trips renders as
    // "No circuit has tripped on this instance" — a finding, asserted before
    // any evidence existed. Same defect `settled` exists to prevent in
    // `desk-source.ts`.
    assert.match(ledger, /has not been read yet/);
  });

  it("the trace console's timeline is never cleared by the network", () => {
    // One `setLines([])`, and it belongs to the operator's Clear view button.
    // The catch path may only demote the connection badge.
    const wipes = code(trace).match(/setLines\(\[\]\)/g) ?? [];
    assert.equal(wipes.length, 1, "exactly one timeline wipe, the operator's own");
    assert.match(code(trace), /catch \{\s*setConnected\(false\);?\s*\}/);
  });

  it("a recovered trace poll cannot double-ingest the lines it already holds", () => {
    // Re-fetching after a flap replays events the timeline already has; the
    // key set is what keeps an oscillating route from duplicating the log.
    assert.match(trace, /const seen = new Set\(current\.map\(\(line\) => line\.key\)\)/);
    assert.match(trace, /filter\(\(line\) => !seen\.has\(line\.key\)\)/);
  });

  it("the pipeline inspector's quiet poll keeps the last good trace and raises no banner", () => {
    // A background tick that fails must age the timestamp, not flash an error
    // card over a trace that was real when it was captured.
    assert.match(code(inspector), /if \(current === sequence\.current && !quiet\)/);
    assert.doesNotMatch(code(inspector), /setResult\(null\)/);
  });

  it("the health matrix and the breaker diagram cannot flap because they cannot remember", () => {
    // Pure renders of the one retained snapshot: no state, no clock, no
    // effects. A failed poll changes nothing here because nothing here knows
    // a poll happened — the hook's snapshot retention does all the work.
    for (const [name, source] of [["HealthMatrix", matrix], ["BreakerStateMachine", breaker]] as const) {
      assert.doesNotMatch(code(source), /useState|useEffect|setInterval|Date\.now/,
        `${name} must stay a pure render of the retained snapshot`);
    }
  });

  it("breaker cooldown arithmetic never touches the browser clock", () => {
    // Both timestamps are the server's; mixing in Date.now() makes the ring
    // jump on clock skew. `observedAt` is the snapshot's own stamp.
    assert.match(breaker, /Date\.parse\(observedAt\)/);
    assert.doesNotMatch(code(breaker), /Date\.now/);
  });

  it("venue liveness reaches the wire tap only through the hook's hysteresis", () => {
    // The strip reads `venue.status`, which `useLiveBook` runs through
    // `VenueLiveness` — demotion immediate, promotion needs a streak. No
    // systems panel may instantiate the machine itself or re-derive staleness
    // from a threshold: a second hysteresis mechanism is how two panels come
    // to disagree about the same silence.
    assert.match(socketTrace, /venue\.status/);
    for (const [name, source] of systemsSources) {
      assert.doesNotMatch(code(source), /new VenueLiveness|STALE_AFTER_MS/,
        `${name} must not run its own liveness hysteresis`);
    }
  });
});

describe("one snapshot, one source", () => {
  it("no systems panel fetches the health snapshot for itself", () => {
    // `useSystemHealth` is the tab's single poll; a panel with its own fetch
    // of the same route would disagree with its siblings on every race. The
    // event ring (`/api/system/events`) is a different resource the snapshot
    // does not carry, so its two readers fetch it themselves by design.
    for (const [name, source] of systemsSources) {
      assert.doesNotMatch(code(source), /api\/system\/health/,
        `${name} must read the shared SystemHealthView, not poll health itself`);
    }
    assert.doesNotMatch(code(consoleShell), /fetch\(/);
  });

  it("provider readiness is printed from summary counts everywhere it appears", () => {
    /**
     * The chrome tile prints `summary.ready/summary.total`; the Dependencies
     * strip used to re-derive the same figures by filtering `providers`. Two
     * derivations of one fact agree only while the server's readiness rule
     * and the client's filter happen to coincide — the snapshot builder is
     * the one place that decides what "ready" means.
     */
    assert.match(consoleShell, /health\.summary\.ready/);
    assert.match(planes, /summary\.ready/);
    assert.match(planes, /summary\.total/);
    assert.match(planes, /summary\.configured/);
    assert.doesNotMatch(code(planes), /providers\.filter\(\(provider\) => provider\.ready\)/,
      "the routable count must come from the summary the tile already prints");
    assert.doesNotMatch(code(planes), /providers\.filter\(\(provider\) => provider\.configured\)/);
  });

  it("the tab's section selection is owned by the page, not by a local copy", () => {
    // A useState copy of `section` here would drift from the page's on
    // remount and the two would disagree about which panel is open.
    assert.match(consoleShell, /section: ReliabilitySection;/);
    assert.match(consoleShell, /onSectionChange: \(section: ReliabilitySection\) => void;/);
    assert.doesNotMatch(code(consoleShell), /useState<ReliabilitySection/);
  });
});

describe("absence is dashed, never zeroed", () => {
  it("the platform cross-link dashes its counts when there is no snapshot behind them", () => {
    /**
     * `?? 0` on `quarantine?.size` and `cache.entries` rendered "0 records
     * held out" and "0 payloads held" on a desk that had not received a
     * health snapshot — and `quarantine` is optional on the wire, so an older
     * instance's snapshot was also reported as a measured zero. Zero is a
     * measurement; these were not.
     */
    assert.doesNotMatch(code(platform), /quarantine\?\.size \?\? 0/);
    assert.doesNotMatch(code(platform), /cache\.entries \?\? 0/);
    assert.match(platform, /"—"/);
  });
});
