/**
 * Order entry: who owns the credential, who owns the sleeve, and what a settled
 * order invalidates.
 *
 * Three questions about ownership, and they are one concern because the answer
 * to each is "exactly one place". The operator credential is held in shared
 * memory and nowhere else, so Reliability and Execution cannot disagree about
 * whether the desk is authorised. The execution strategy is an order intent the
 * shell owns — promotion seeds it, the ticket overrides it — rather than a
 * reflection of the Research tab, so it does not disappear when a run goes
 * stale. And every mutation goes through one invalidation path per surface,
 * because a per-handler copy is how a stale Portfolio tab after a kill switch
 * happens with nothing on screen saying it happened.
 *
 * Asserted against source. These are properties of the call graph — which file
 * declares the state and which file is handed the setter — and a render test
 * would only observe them indirectly, through the surface that was already
 * agreeing with itself.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/cockpit-sources";

const orderTicket = read("components/execution/OrderTicket.tsx");
/**
 * The ticket's controls became `OrderTicketForm.tsx` on 2026-08-21 and its
 * answer `OrderVerdict.tsx`; the submit, its undeadlined write and the
 * credential field stayed. Assertions about a control read the form, assertions
 * about the write read the ticket — the two are not interchangeable, and a scan
 * pointed at the wrong one would go quiet rather than red.
 */
const ticketForm = read("components/execution/OrderTicketForm.tsx");
const cockpit = read("components/execution/ExecutionCockpit.tsx");
/**
 * The cockpit's data layer, split out of the component it feeds.
 *
 * The component still owns the composition — which panel is in which subtab,
 * and which pane of it is open — so the wiring assertions below stay pointed
 * at `ExecutionCockpit`. The poll, the mode and the single invalidation path
 * moved here, and so did the assertions about them. Anything left reading the
 * component for a probe URL would be reading a file that no longer contains
 * one, and would agree with itself rather than with the codebase.
 */
const cockpitFeed = read("components/execution/use-cockpit-feed.ts");
const page = read("app/dashboard/page.tsx");
/**
 * The shell became three files on 2026-08-21. `page.tsx` still declares the
 * order draft and the execution sleeve — that is the ownership half of every
 * assertion below — but the eight panels that thread them into the cockpit are
 * `components/workspace/WorkspacePanels.tsx`, and the four-tile briefs that
 * quote the sleeve are `lib/workspace-insights.ts`. Each line reads the file
 * its subject actually lives in; `shell` is for the two that must hold across
 * the seam.
 */
const panels = read("components/workspace/WorkspacePanels.tsx");
const insights = read("lib/workspace-insights.ts");
const shell = `${page}\n${panels}`;
/**
 * Promotion's hand-off moved into the Research tab's own Decision section when
 * `page.tsx` was split. The shell still OWNS the execution sleeve — that is
 * why both book tabs and the ticket can quote it — and hands the setter down;
 * the research side calls it with the promoted run's strategy. Both halves are
 * asserted, because either one alone would let the other rot.
 */
const decisionSection = read("components/research/DecisionSection.tsx");

describe("token-guarded order entry has an in-context recovery path", () => {
  it("keeps the operator credential in shared memory and exposes no storage path", () => {
    assert.match(orderTicket, /type="password"/);
    assert.match(orderTicket, /onOperatorTokenChange/);
    assert.match(orderTicket, /Held in memory for this tab only/);
    assert.doesNotMatch(orderTicket, /localStorage|sessionStorage|document\.cookie/);
  });

  it("wires the same credential state used by Reliability into Execution", () => {
    assert.match(cockpit, /onOperatorTokenChange=\{onOperatorTokenChange\}/);
    assert.match(panels, /onOperatorTokenChange=\{systems\.setToken\}/);
    assert.match(panels, /operatorGuard=\{systems\.guard\}/);
  });

  it("uses the deployment credential by default and keeps pasted tokens strict overrides", () => {
    assert.match(panels, /paperOrderDefaultAvailable=\{systems\.paperOrderDefaultAvailable\}/);
    assert.match(cockpit, /paperOrderDefaultAvailable=\{paperOrderDefaultAvailable\}/);
    assert.match(orderTicket, /!paperOrderDefaultAvailable[\s\S]*?!operatorToken\?\.trim\(\)/);
    assert.match(orderTicket, /Credential override \(optional\)/);
    assert.match(orderTicket, /Using the deployment credential/);
    assert.match(orderTicket, /operatorHeaders\(operatorToken\)/);
  });
});

describe("the execution strategy is an editable order intent", () => {
  it("does not disappear when Research becomes stale", () => {
    assert.match(page, /useState<Strategy>\(DEFAULT_REQUEST\.strategy\)/);
    assert.match(panels, /strategy=\{executionStrategy\}/);
    assert.doesNotMatch(shell, /researchStrategy=\{activeResult/);
  });

  it("lets promotion seed the sleeve and the ticket override it", () => {
    assert.match(panels, /onStageSleeve=\{setExecutionStrategy\}/);
    assert.match(decisionSection, /onStageSleeve\(data\.request\.strategy\)/);
    assert.match(panels, /onStrategyChange=\{setExecutionStrategy\}/);
    assert.match(ticketForm, /value=\{strategy\}/);
    assert.match(ticketForm, /id="execution-strategy"/);
    assert.match(ticketForm, /aria-describedby="execution-strategy-help"/);
    assert.match(ticketForm, /onStrategyChange\(event\.target\.value as Strategy\)/);
  });

  it("always stamps the selected sleeve on the submitted order", () => {
    assert.match(orderTicket, /const order = \{[\s\S]*?strategy,[\s\S]*?\};/);
    assert.match(ticketForm, /STRATEGY_GROUPS\.map/);
  });
});

describe("a settled live order invalidates the shared Portfolio and Risk book", () => {
  it("starts with a fillable notional instead of tripping the per-order cap", () => {
    assert.match(page, /const \[notional, setNotional\] = useState\(25_000\)/);
    assert.doesNotMatch(page, /const \[notional, setNotional\] = useState\(100_000\)/);
  });

  it("reports every collected decision, including a fill before a later burst failure", () => {
    assert.match(orderTicket, /finally \{[\s\S]*?if \(collected\.length\)/);
    assert.doesNotMatch(orderTicket, /collected\.length && !failed/);
    assert.match(orderTicket, /hasFill: collected\.some\(\(decision\) => decision\.accepted && decision\.fill != null\)/);
  });

  it("keeps sandbox local and refreshes both live snapshot owners", () => {
    /**
     * One invalidation path per surface, which is the part that has to hold as
     * mutations are added. Every mutation in the cockpit calls `revalidate`,
     * every mutation on the page calls `revalidateDesk`, and the escalation
     * between them — local for a cancel, local-only for a sandbox submission,
     * both snapshots for a live one — is decided once rather than remembered
     * at each call site. A per-handler copy is how a stale Portfolio tab after
     * a kill switch happens, and nothing on screen says it happened.
     */
    assert.match(cockpitFeed, /if \(result && result\.source !== "live"\) return/);
    assert.match(cockpitFeed, /void refresh\(\);\s*\n\s*if \(result\) onOrderSettled\?\.\(result\)/);
    // And the component still routes every mutation through that one path.
    assert.match(cockpit, /onSubmitted=\{revalidate\}/);
    assert.match(page, /book\.refresh\(true\), systems\.refresh\(true\)/);
    assert.match(panels, /onOrderSettled=\{revalidateDesk\}/);
  });

  it("surfaces the selected sleeve's audited activity in both destination tabs", () => {
    assert.match(page, /row\.strategy === executionStrategy/);
    assert.match(insights, /STRATEGY_LABELS\[executionStrategy\]/);
    assert.equal((insights.match(/label: "Execution sleeve"/g) ?? []).length, 2);
    assert.match(insights, /aggregate book risk below/);
  });
});
