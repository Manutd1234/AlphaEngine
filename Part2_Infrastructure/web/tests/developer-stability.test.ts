/**
 * The Developer tab's health badge may not flap on the poll cadence.
 *
 * The tab's headline pill, the topology edge, the pipeline commit card and
 * the readiness ladder's Deployment gate all derive from `workspaceState`,
 * which read `view.healthError` directly — a transient the shared 30s poll
 * sets on any failure and clears on any success. Demotion on the first
 * failure is the conservative direction and stays immediate. Promotion is
 * where the twitch lived: one good packet flipped the pill back to Healthy,
 * so a gateway reachable half the time alternated Healthy and Degraded every
 * poll, and on a Vercel build the launch verdict alternated READY and
 * BLOCKED with it, replaying its entrance animation at each flip.
 *
 * The cure is the house one, not a new one: `DeskSourceMachine` already
 * encodes "demotion immediate, promotion needs a streak"
 * (`PROMOTION_STREAK` consecutive successes). `WorkspaceHealthSettle` feeds
 * the machine the poll's observable transitions — `updatedAt` moved means a
 * success, `healthError` newly set means a failure — and the tab renders the
 * settled reading everywhere through one hook at the shell, so a section
 * cannot remount into a machine that has forgotten the demotion.
 *
 * These are state-sequence tests against the plain class, in the idiom
 * `desk-source.test.ts` records: arrange a pass/fail/pass sequence, assert
 * the rendered decision is stable. No DOM, no fake network.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ControlState } from "../components/developer/DeveloperStatus";
import {
  settledWorkspaceState,
  WorkspaceHealthSettle,
} from "../components/developer/workspace-health";
import { PROMOTION_STREAK } from "../lib/desk-source";
import { console_, overview_, pipelines_, status_ } from "./helpers/developer-sources";
import { readSource, stripCode } from "./helpers/source-files";

/** The immediate readings `workspaceState` produces, as the mapper sees them. */
const HEALTHY: ControlState = { label: "Healthy", detail: "Serving commit abc1234.", tone: "good" };
const DEGRADED: ControlState = { label: "Degraded", detail: "HTTP 503", tone: "bad" };

/** A fresh Date per success, exactly as `applySnapshot` stamps `updatedAt`. */
const at = (ms: number) => new Date(ms);

describe("one failed poll demotes the workspace pill immediately", () => {
  it("falls on the first failure after a success", () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(at(1_000), null);
    assert.equal(settle.demoted, false);
    settle.note(at(1_000), "HTTP 503");
    assert.equal(settle.demoted, true, "a failed poll must demote at once — that is the conservative direction");
  });
});

describe("an alternating gateway settles at Degraded instead of flapping", () => {
  it("one success after a failure does not promote", () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(at(1_000), null); // pass
    settle.note(at(1_000), "HTTP 503"); // fail
    settle.note(at(31_000), null); // pass
    assert.equal(
      settle.demoted, true,
      "one good packet re-promoted the pill; the badge is flapping on the poll cadence",
    );
  });

  it("a pass/fail/pass/fail sequence stays demoted throughout", () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(at(1_000), null);
    settle.note(at(1_000), "HTTP 503");
    settle.note(at(31_000), null);
    settle.note(at(31_000), "HTTP 503");
    settle.note(at(61_000), null);
    assert.equal(settle.demoted, true, "the honest description of a half-reachable gateway is Degraded, held");
  });

  it(`promotes after ${PROMOTION_STREAK} consecutive successes`, () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(at(1_000), null);
    settle.note(at(1_000), "HTTP 503");
    for (let i = 0; i < PROMOTION_STREAK; i += 1) settle.note(at(31_000 + i * 30_000), null);
    assert.equal(settle.demoted, false, "a genuinely recovered gateway must be able to read Healthy again");
  });
});

describe("a re-render is not a poll", () => {
  it("repeating the same view does not advance the promotion streak", () => {
    const settle = new WorkspaceHealthSettle();
    const recovered = at(31_000);
    settle.note(at(1_000), null);
    settle.note(at(1_000), "HTTP 503");
    settle.note(recovered, null);
    // React re-renders with the identical view object — a pane switch, a
    // ticker elsewhere — must not count as fresh successes, or the streak is
    // a render counter and the settle is theatre.
    settle.note(recovered, null);
    settle.note(recovered, null);
    assert.equal(settle.demoted, true, "renders were counted as polls; the streak must move on transitions only");
  });

  it("a repeated identical failure message still reads as the same outage", () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(at(1_000), null);
    settle.note(at(1_000), "HTTP 503");
    settle.note(at(1_000), "HTTP 503");
    assert.equal(settle.demoted, true);
    // And a fresh failure after a success is observed even when its message
    // matches the previous outage word for word, because the error cleared
    // to null in between.
    settle.note(at(31_000), null);
    settle.note(at(31_000), "HTTP 503");
    settle.note(at(61_000), null);
    assert.equal(settle.demoted, true, "a repeat of the same failure text was dropped as a duplicate");
  });
});

describe("a desk that has never read health has nothing to hold", () => {
  it("stays on the immediate reading before the first success", () => {
    const settle = new WorkspaceHealthSettle();
    settle.note(null, "HTTP 503");
    assert.equal(settle.demoted, false, "with no good reading behind it there is nothing to demote from");
    // The immediate state already says Degraded with the live reason; the
    // mapper must hand it through untouched rather than inventing a holding
    // state for a desk with no history.
    assert.equal(settledWorkspaceState(DEGRADED, false, "HTTP 503"), DEGRADED);
  });
});

describe("what the held reading says", () => {
  it("holds the Degraded word with the streak named, while the data is current", () => {
    const held = settledWorkspaceState(HEALTHY, true, null);
    assert.equal(held.label, "Degraded");
    assert.equal(held.tone, "bad", "an intermediate tone would flap the colour instead of the word");
    assert.equal(held.unmeasured, undefined, "the poll ran and failed recently; this is a measurement, not an absence");
    assert.match(held.detail, /last health read succeeded/);
    assert.match(held.detail, new RegExp(`${PROMOTION_STREAK} consecutive`));
  });

  it("lets the live failure reason win while the outage is current", () => {
    // A held recovery note must never outlive or replace the description of a
    // failure that is happening now — same rule as the machine's `failure`
    // field, which any success clears.
    assert.equal(settledWorkspaceState(DEGRADED, true, "HTTP 503"), DEGRADED);
  });

  it("hands a healthy, promoted desk its immediate reading unchanged", () => {
    assert.equal(settledWorkspaceState(HEALTHY, false, null), HEALTHY);
  });
});

describe("one settle at the shell, rendered by every section", () => {
  const health = readSource("components/developer/workspace-health.ts");
  const hook = readSource("components/developer/use-workspace-health.ts");

  it("delegates its hysteresis to DeskSourceMachine rather than growing a second one", () => {
    assert.match(health, /new DeskSourceMachine/);
    const code = stripCode(health);
    assert.doesNotMatch(code, /setTimeout|setInterval/, "the settle grew a clock; the machine already owns the streak");
    assert.match(health, /PROMOTION_STREAK/);
  });

  it("the shell derives the settled reading once and passes it down", () => {
    assert.match(stripCode(console_), /const workspaceHealth = useWorkspaceHealth\(view\)/);
    assert.match(stripCode(hook), /settle\.current\.note\(view\.updatedAt, view\.healthError\)/);
  });

  it("no section re-derives the immediate reading for itself", () => {
    // `workspaceState(view)` is the unsettled, per-packet reading. Its one
    // sanctioned caller is the hook; a section calling it directly is a panel
    // that flaps while its siblings hold.
    for (const [name, source] of [["DeveloperConsole", console_], ["DeveloperOverview", overview_], ["DeveloperPipelines", pipelines_]] as const) {
      assert.doesNotMatch(stripCode(source), /workspaceState\(/, `${name} reads the per-packet state beside the settled one`);
    }
    assert.match(stripCode(overview_), /stateForDeployable\(deployable\.id, view, workspaceHealth\)/);
    assert.match(stripCode(pipelines_), /state=\{workspaceHealth\}/);
  });

  it("the lineage table takes the settled workspace state instead of re-deriving it", () => {
    const status = stripCode(status_);
    assert.match(status, /if \(id === "workspace"\) return workspace;/);
    assert.doesNotMatch(
      stripCode(status_).replace(/export function workspaceState[\s\S]*?\n\}/, ""),
      /workspaceState\(view\)/,
      "a second surface inside DeveloperStatus derives the per-packet reading",
    );
  });

  it("the outage banner stays on the live error, so it cannot outlive its outage", () => {
    // Demotion is immediate and so is the banner; only promotion is held.
    assert.match(stripCode(overview_), /\{view\.healthError && \(/);
  });

  it("every section that renders the settled reading receives the shell's copy", () => {
    // Two Overview instances and Pipelines: three hand-offs, no fourth source.
    const handoffs = stripCode(console_).match(/workspaceHealth=\{workspaceHealth\}/g) ?? [];
    assert.equal(handoffs.length, 3, "a section stopped receiving the settled reading, or grew its own");
  });
});

describe("the three open-work counts are one predicate", () => {
  /**
   * The PageHead tile, the Overview context fact and the queue's stats strip
   * all count open work from the same lifted `workItems` array. The array is
   * the single source; what could still drift is the predicate — one surface
   * deciding "review" no longer counts as open would disagree with its
   * siblings by exactly the rows awaiting evidence. Pin the expression.
   */
  const queue = readSource("components/developer/DeveloperWorkQueue.tsx");

  it("derives open-ness identically in all three surfaces", () => {
    for (const [name, source] of [["DeveloperConsole", console_], ["DeveloperOverview", overview_], ["DeveloperWorkQueue", queue]] as const) {
      assert.match(
        stripCode(source), /filter\(\(item\) => item\.status !== "done"\)/,
        `${name} counts open work with a different predicate to its siblings`,
      );
    }
  });
});
