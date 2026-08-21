/**
 * A cross-link that names a workspace and not a section is a coin toss.
 *
 * `navigate(view)` writes `${view}/${sectionByViewRef.current[view]}` — the
 * section the reader last had open in that workspace. That is right for a tab
 * click and wrong for every contextual link: a tile headed "VaR 95, Gross
 * headroom · Drawdown cushion · Binding constraint" whose button reads *Open
 * Risk* opened whichever risk panel had been read last, which on a second visit
 * is rarely the one explaining those four numbers. Twenty-two of the desk's
 * thirty-seven cross-links behaved that way.
 *
 * Nothing about a destination is visible to a type checker — the section id is
 * a string in a hash — and nothing about it is visible to a reviewer either,
 * because the wrong destination still navigates, still animates and still
 * renders a full panel. It is the house's own failure mode: green, plausible,
 * and wrong. So the pairs are measured here, against `lib/sections`, which is
 * the single source the rails, the palette and the hash whitelist all read.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isRealLocation } from "./helpers/desk-rails";
import { hashCode, pageCode, routingCode, shellCode } from "./helpers/desk-shell-sources";

describe("cross-links name a section, not just a workspace", () => {
  /**
   * Both call shapes. A tile that names its own `targetSection` hands it to the
   * shell, which routes to it and keeps a literal only as the fallback for a
   * link that names none — `openSection("risk", section ?? "limits")`. That
   * fallback is still a destination, and still has to be a real one.
   */
  // `onOpenSection` is the same helper, threaded into a child as a prop —
  // ResearchWorkspace and DecisionSection call it under that name.
  const calls = [...shellCode.matchAll(/\b(?:on)?[Oo]penSection\(\s*"([a-z]+)"\s*,\s*(?:section \?\? )?"([a-z]+)"\s*\)/g)]
    .map(([, view, section]) => ({ view, section }));

  it("routes a useful number of them through the section-aware helper", () => {
    // A ratchet, not a target: the count may rise freely. It falling means a
    // destination was dropped back to "wherever that tab was last left".
    // 14 → 13 was not a dropped destination: two tabs shared the identical
    // "reliability overview" arrow, and the memoised-panel pass folded both
    // into one stable useCallback — same destinations, one literal fewer.
    assert.ok(
      calls.length >= 13,
      `only ${calls.length} cross-links name their section — this pass wired 13`,
    );
  });

  it("every destination is a section the desk actually has", () => {
    const dead = calls
      .filter(({ view, section }) => !isRealLocation(view, section))
      .map(({ view, section }) => `${view}/${section}`);
    assert.deepEqual(
      dead,
      [],
      `these open a hash lib/sections does not define, so readLocation resets them to the `
        + `workspace default and the link silently lands somewhere else:\n  ${dead.join("\n  ")}`,
    );
  });

  it("the helper refuses an id that is not on that rail", () => {
    // The other half: a renamed section must degrade to the plain tab switch
    // rather than writing a location nothing accepts.
    assert.match(hashCode, /export function railSection<T extends string>/);
    assert.match(
      routingCode,
      /if \(!apply\) \{\s*\n\s*navigate\(next\);/,
      "openSection no longer falls back to the bare tab switch on an unknown section",
    );
  });

  it("the measured destinations are the ones that shipped", () => {
    /**
     * Each of these was a bare `navigate(view)` before this pass, and each is
     * quoting something specific at its call site. The promotion handoff is the
     * sharpest: it stages the sleeve into the execution strategy and then had
     * to hope the reader had last been on the ticket.
     */
    const expected: [string, string][] = [
      ["live", "trade"],        // PromotionPanel's hand-off, sleeve already staged
      ["risk", "limits"],       // Portfolio's "Limits and tail risk" tile
      ["portfolio", "overview"],// Risk's "Book under these limits" tile
      ["data", "overview"],     // "Trace market data", and the sweep's data warnings
      ["reliability", "overview"], // DataConsole's "Open Reliability"
      ["research", "summary"],  // every "review the evidence" link on the desk
      ["data", "feeds"],        // Execution's "Verify feed"
      ["live", "liquidity"],    // Developer's "Open live book"
    ];
    for (const [view, section] of expected) {
      assert.ok(
        calls.some((call) => call.view === view && call.section === section),
        `nothing opens ${view}/${section} any more`,
      );
    }
  });

  it("no handler prop is handed a bare workspace switch", () => {
    // The shape that shipped: `onOpenRisk={() => navigate("risk")}`. The prop
    // names the destination tab and nothing names the panel.
    const offenders = [...shellCode.matchAll(/on(?:Open|HandOff)\w*=\{\(\) => navigate\("([a-z]+)"\)\}/g)]
      .map((match) => match[0]);
    assert.deepEqual(
      offenders,
      [],
      `these cross-links still land on whichever section that workspace was last `
        + `read at:\n  ${offenders.join("\n  ")}`,
    );
    assert.doesNotMatch(
      shellCode,
      /on(?:StageSleeve|SetExecutionStrategy)\(data\.request\.strategy\);\s*\n\s*navigate\("live"\);/,
      "the promotion hand-off stages a sleeve and then opens whatever execution section "
        + "was last read — it means live/trade",
    );
  });

  it("the header health chips keep their own two destinations", () => {
    // Pinned in workspace-routing-page-head.test.ts as well; repeated here because this
    // pass rewired openReliabilitySection through the shared helper and these
    // are the two links that must not have moved with it.
    assert.ok(
      pageCode.includes('openReliabilitySection("services", "reliability-latency-guide")')
        && pageCode.includes('openReliabilitySection("services", "reliability-provider-health")'),
    );
  });
});
