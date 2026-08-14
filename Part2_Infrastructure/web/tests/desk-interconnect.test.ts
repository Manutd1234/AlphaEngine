/**
 * A cross-link that names a workspace and not a section is a coin toss.
 *
 * `navigate(view)` writes `${view}/${sectionByViewRef.current[view]}` — the
 * section the reader last had open in that workspace. That is right for a tab
 * click and wrong for every contextual link: a tile headed "VaR 95 · Gross
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
 *
 * Four further properties from the same pass are pinned below: the decision
 * loop's stages are real buttons (the reviewer tour has claimed they were
 * clickable for longer than they have been), the next-step footer follows the
 * section rather than a fixed ring, Attribution's four cards are split across
 * two panes, and exactly one visible control starts the research sweep.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DATA_SECTION_IDS,
  DEVELOPER_SECTION_IDS,
  EXECUTION_SECTION_IDS,
  OVERVIEW_SECTION_IDS,
  PORTFOLIO_SECTION_IDS,
  RELIABILITY_SECTION_IDS,
  RESEARCH_SECTION_IDS,
  RISK_SECTION_IDS,
} from "../lib/sections";

function read(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Comments blanked before anything is scanned.
 *
 * Every assertion below is about a call or a literal, and the code it polices
 * carries comments that quote the very form being banned — "a bare
 * `navigate(\"live\")` handed a promoted candidate…" sits directly above the
 * call that replaced it. Reading prose as code has produced false greens and
 * false reds in this suite before.
 */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const page = read("../app/dashboard/page.tsx");
const pageCode = strip(page);
const overview = strip(read("../components/WorkspaceOverview.tsx"));
const pipeline = strip(read("../components/overview/DecisionLoopPipeline.tsx"));
const footer = read("../components/common/NextStepFooter.tsx");
const footerCode = strip(footer);
const roleCards = strip(read("../components/overview/RoleCards.tsx"));
const controls = strip(read("../components/Controls.tsx"));

/** Every section id the desk ships, by workspace — the rails themselves. */
const RAILS: Record<string, readonly string[]> = {
  overview: OVERVIEW_SECTION_IDS,
  research: RESEARCH_SECTION_IDS,
  live: EXECUTION_SECTION_IDS,
  portfolio: PORTFOLIO_SECTION_IDS,
  risk: RISK_SECTION_IDS,
  data: DATA_SECTION_IDS,
  reliability: RELIABILITY_SECTION_IDS,
  developer: DEVELOPER_SECTION_IDS,
};

function isRealLocation(view: string, section: string): boolean {
  return RAILS[view]?.includes(section) ?? false;
}

// --------------------------------------------------------------------------
// 1 — every contextual cross-link names the panel it lands on
// --------------------------------------------------------------------------

describe("cross-links name a section, not just a workspace", () => {
  /**
   * Both call shapes. A tile that names its own `targetSection` hands it to the
   * shell, which routes to it and keeps a literal only as the fallback for a
   * link that names none — `openSection("risk", section ?? "limits")`. That
   * fallback is still a destination, and still has to be a real one.
   */
  const calls = [...pageCode.matchAll(/openSection\(\s*"([a-z]+)"\s*,\s*(?:section \?\? )?"([a-z]+)"\s*\)/g)]
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
    assert.match(pageCode, /function railSection<T extends string>/);
    assert.match(
      pageCode,
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
    const offenders = [...pageCode.matchAll(/on(?:Open|HandOff)\w*=\{\(\) => navigate\("([a-z]+)"\)\}/g)]
      .map((match) => match[0]);
    assert.deepEqual(
      offenders,
      [],
      `these cross-links still land on whichever section that workspace was last `
        + `read at:\n  ${offenders.join("\n  ")}`,
    );
    assert.doesNotMatch(
      pageCode,
      /setExecutionStrategy\(data\.request\.strategy\);\s*\n\s*navigate\("live"\);/,
      "the promotion hand-off stages a sleeve and then opens whatever execution section "
        + "was last read — it means live/trade",
    );
  });

  it("the header health chips keep their own two destinations", () => {
    // Pinned in workspace-routing.test.ts as well; repeated here because this
    // pass rewired openReliabilitySection through the shared helper and these
    // are the two links that must not have moved with it.
    assert.ok(
      pageCode.includes('openReliabilitySection("services", "reliability-latency-guide")')
        && pageCode.includes('openReliabilitySection("services", "reliability-provider-health")'),
    );
  });
});

// --------------------------------------------------------------------------
// 2 — the decision loop is clickable, as the tour has been claiming
// --------------------------------------------------------------------------

describe("every pipeline stage links into its tab", () => {
  it("the reviewer tour still makes the claim this section pins", () => {
    // If the sentence goes, these assertions are policing nothing in
    // particular; if it stays, it has to be true.
    assert.match(pageCode, /every pipeline stage links into its tab/);
  });

  it("each stage is a real button, not a click handler on a div", () => {
    assert.match(pipeline, /<button\s/, "the stages render no button at all");
    assert.match(pipeline, /onClick=\{\(\) => onOpenStage\(stage\.id\)\}/);
    assert.doesNotMatch(
      pipeline,
      /<(?:div|li|span)[^>]*onClick=/,
      "a stage is clickable but not focusable, and is announced as text",
    );
  });

  it("the button carries an accessible name from the stage itself", () => {
    // The visible label IS the name: stage, state word and detail line all sit
    // inside the button, so voice control and a screen reader agree with what
    // is on screen. An aria-label here would be a second, drifting copy.
    const button = pipeline.slice(pipeline.indexOf("<button"), pipeline.indexOf("</button>"));
    assert.match(button, /\{stage\.label\}/);
    assert.doesNotMatch(button, /aria-label=/);
  });

  it("the shell decides where a stage lands, and covers all four", () => {
    assert.match(overview, /<DecisionLoopPipeline stages=\{stages\} onOpenStage=\{onOpenStage\} \/>/);
    const start = pageCode.indexOf("const openLoopStage = useCallback");
    assert.notEqual(start, -1, "page.tsx no longer maps a stage to a destination");
    const body = pageCode.slice(start, pageCode.indexOf("}, [openSection]);", start));
    for (const stage of ["data", "research", "risk", "execution"]) {
      assert.match(
        body,
        new RegExp(`case "${stage}":`),
        `the ${stage} stage has no destination, so clicking it does nothing`,
      );
    }
    // And what it opens is real. StageId "execution" is the `live` workspace —
    // the one place on the desk where the two names differ.
    for (const [view, section] of [
      ["data", "overview"], ["research", "summary"], ["risk", "limits"], ["live", "trade"],
    ]) {
      assert.ok(
        body.includes(`openSection("${view}", "${section}")`) && isRealLocation(view, section),
        `the pipeline opens ${view}/${section}, which is not a section`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// 3 — the next-step footer follows the section, not a fixed ring
// --------------------------------------------------------------------------

describe("the next step follows what was just read", () => {
  const steps = [...footerCode.matchAll(
    /"([a-z]+)\/([a-z]+)":\s*\{\s*view:\s*"([a-z]+)",\s*section:\s*"([a-z]+)"/g,
  )].map(([, fromView, fromSection, view, section]) => ({ fromView, fromSection, view, section }));

  it("covers the sections measured as having no outbound link of their own", () => {
    assert.ok(steps.length >= 23, `only ${steps.length} sections have a measured next step`);
  });

  it("every source and every destination is a real section", () => {
    const dead: string[] = [];
    for (const step of steps) {
      if (!isRealLocation(step.fromView, step.fromSection)) {
        dead.push(`from ${step.fromView}/${step.fromSection}`);
      }
      if (!isRealLocation(step.view, step.section)) {
        dead.push(`to ${step.view}/${step.section}`);
      }
    }
    assert.deepEqual(
      dead,
      [],
      "the footer is keyed on, or points at, a section lib/sections does not define — "
        + `this is the drift a component with no test accumulates:\n  ${dead.join("\n  ")}`,
    );
  });

  it("no step offers the section the reader is already on", () => {
    const circular = steps
      .filter((step) => step.fromView === step.view && step.fromSection === step.section)
      .map((step) => `${step.fromView}/${step.fromSection}`);
    assert.deepEqual(circular, [], `a next step that goes nowhere:\n  ${circular.join("\n  ")}`);
  });

  it("keeps the role ring as the fallback so no section loses its footer", () => {
    const start = footerCode.indexOf("const FLOW_MAP");
    assert.notEqual(start, -1, "the fallback ring is gone");
    const block = footerCode.slice(start, footerCode.indexOf("\n};", start));
    const ring = [...block.matchAll(/^ {2}([a-z]+):\s*\{\s*\n\s*nextId:\s*"([a-z]+)"/gm)];
    assert.equal(ring.length, 8, "the ring no longer covers all eight workspaces");
    for (const [, from, to] of ring) {
      assert.ok(RAILS[from], `the ring starts from "${from}", which is not a workspace`);
      assert.ok(RAILS[to], `the ring points at "${to}", which is not a workspace`);
    }
  });

  it("reads the destination's name from the rail rather than mirroring it", () => {
    assert.match(footerCode, /from "@\/lib\/sections"/);
    assert.match(footerCode, /SECTIONS_BY_VIEW\[contextual\.view\]\.find/);
  });

  it("is told which section it is standing on, on all eight views", () => {
    const mounts = [...pageCode.matchAll(
      /<NextStepFooter currentView="([a-z]+)" currentSection=\{(\w+)\} onNavigate=\{openSection\} \/>/g,
    )];
    assert.equal(
      mounts.length,
      8,
      "a view mounts the footer without telling it where the reader is, so that whole "
        + "workspace falls back to the ring",
    );
    assert.equal(new Set(mounts.map((match) => match[1])).size, 8);
  });
});

// --------------------------------------------------------------------------
// 4 — Attribution is two questions, so it is two panes
// --------------------------------------------------------------------------

describe("Research ▸ Attribution splits into Explain and Robustness", () => {
  it("keeps the section id a literal, because it is a public deep link", () => {
    assert.match(pageCode, /tabId="attribution"/);
  });

  it("is a two-option seg, never four", () => {
    // `.seg button { flex: 1 }`: a fourth option forces abbreviated labels.
    const start = pageCode.indexOf("const ATTRIBUTION_PANES");
    assert.notEqual(start, -1, "the panes are gone");
    const block = pageCode.slice(start, pageCode.indexOf("];", start));
    const ids = [...block.matchAll(/id:\s*"(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(ids, ["explain", "robustness"]);
    assert.match(pageCode, /<div className="seg" role="group" aria-label="Attribution view">/);
    assert.match(pageCode, /aria-pressed=\{attributionPane === option\.id\}/);
    assert.match(pageCode, /title=\{option\.hint\}/, "a pane switcher with no hint on either option");
  });

  it("renders the hidden pane not at all, rather than hiding it", () => {
    assert.match(pageCode, /\{attributionPane === "explain" && \(/);
    assert.match(pageCode, /\{attributionPane === "robustness" && \(/);
    assert.doesNotMatch(pageCode, /attributionPane[^\n]*hidden=/);
  });

  it("declares the pane state above the render", () => {
    // page.tsx is not on workspace-routing's hard-coded component list, so its
    // hook order is nobody else's business but this one's.
    const component = pageCode.indexOf("export default function Page()");
    assert.notEqual(component, -1, "the page component is gone");
    const declared = pageCode.indexOf("useState<AttributionPane>", component);
    const renders = pageCode.indexOf("\n  return (", component);
    assert.ok(declared > component, "the pane state is declared outside the component");
    assert.ok(declared < renders, "the pane state is declared below a return");
  });

  it("puts the two panels that answer the same question together", () => {
    const start = pageCode.indexOf('{attributionPane === "explain" && (');
    const explain = pageCode.slice(start, pageCode.indexOf('{attributionPane === "robustness"', start));
    assert.match(explain, /<FactorPanel/);
    assert.match(explain, /<BenchmarkPanel/);
    const robustness = pageCode.slice(pageCode.indexOf('{attributionPane === "robustness" && ('));
    assert.match(robustness.slice(0, 800), /<RegimePanel/);
    assert.match(robustness.slice(0, 800), /<TearSheet/);
  });
});

// --------------------------------------------------------------------------
// 5 — one visible control starts the sweep
// --------------------------------------------------------------------------

describe("the research sweep has one button, not three", () => {
  it("the setup panel no longer closes with its own run button", () => {
    assert.doesNotMatch(controls, /Run sweep now/);
    assert.doesNotMatch(controls, /onClick=\{onRun\}/);
  });

  it("the sticky rail keeps the one that survives scrolling", () => {
    assert.match(pageCode, /\{running \? "Running…" : "Run now"\}/);
    assert.match(pageCode, /onClick=\{pinRun\}/, "the rail lost its Pin control with the Run one");
  });

  it("commit and run stay two different signals", () => {
    // The distinction is the mechanism, not the button: `onCommit` is the DOM's
    // native `change`, and a component that collapsed the two would put a
    // request on every tick of a slider drag.
    assert.match(controls, /onCommit:\s*\(\)\s*=>\s*void/);
    assert.match(controls, /onRun:\s*\(\)\s*=>\s*void/);
  });
});

// --------------------------------------------------------------------------
// 6 — the launcher declares only what it reads
// --------------------------------------------------------------------------

describe("the role launcher takes no prop it never reads", () => {
  const dead = ["onRun", "running", "researchStale", "onRefreshBook", "bookRefreshing", "onRefreshHealth"];

  it("declares neither the run handler nor the two refresh callbacks", () => {
    // Two of these were wired to no control at all: the launcher has one
    // button per card and always has.
    for (const prop of dead) {
      assert.ok(!roleCards.includes(prop), `RoleCards still declares ${prop}`);
    }
  });

  it("and the overview stops passing them", () => {
    const start = overview.indexOf("<RoleCards");
    assert.notEqual(start, -1, "the launcher is not rendered");
    const element = overview.slice(start, overview.indexOf("/>", start));
    for (const prop of dead) {
      assert.ok(!element.includes(`${prop}=`), `WorkspaceOverview still passes ${prop}`);
    }
  });

  it("keeps the seven navigation buttons untouched", () => {
    assert.match(roleCards, /className="role-card__actions"/);
    assert.match(roleCards, /onClick=\{\(\) => onNavigate\(card\.view\)\}/);
    assert.equal(
      [...roleCards.matchAll(/view:\s*"[a-z]+",\s*\n\s*code:/g)].length,
      7,
      "the overview no longer launches seven desk roles",
    );
  });
});
