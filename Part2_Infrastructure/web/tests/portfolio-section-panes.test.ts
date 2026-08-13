/**
 * The Overview and Performance splits, and the cross-link tile that now knows
 * where it is going.
 *
 * Three properties are worth measuring rather than trusting, because all three
 * fail silently — the page renders, nothing throws, and the defect is a reader
 * drawing the wrong conclusion:
 *
 *  1. OVERVIEW'S STANDING PANE CANNOT BE EMPTY. Both cards it was given are
 *     conditional: no alert fires until a symbol has spent 75% of its cap, and
 *     the drift banner needs both a covariance and 5% of drift. On the quiet
 *     book that is the normal case, the pane would have rendered as a blank
 *     plane — which `no-dead-ends.test.ts` bans for provenance states and the
 *     desk sweep flags at 60 characters of innerText, for the same reason:
 *     nothing on screen is indistinguishable from a section that failed to
 *     mount.
 *
 *  2. PERFORMANCE IS SPLIT ALONG A TIME BASE, AND THE LABELS SAY SO. The flow
 *     tables and the execution-quality tiles come from `execution_stats()`,
 *     which is `FROM orders` with no session filter — lifetime. The drawdown
 *     and rolling-Sharpe plots are measured from the equity track, which starts
 *     empty on every load. The card in the first pane already warned in prose
 *     that mixing the two subtracts a lifetime fee bill from one day's P&L; a
 *     split that put a lifetime card and a session card in the same pane would
 *     have left the boundary the warning is about inside a pane, and the
 *     warning still a paragraph nobody reads.
 *
 *  3. THE CROSS-LINK TILE NAMES ITS DESTINATION. `onNavigate` was a bare thunk,
 *     so both tiles could name the destination TAB but not the panel — the
 *     reader landed on whichever section they last visited, which for a tile
 *     quoting VaR and headroom could be the Monte Carlo panel. The argument is
 *     optional in both directions, so a caller that cannot route to a section
 *     still compiles and still works.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here,
 * and the properties worth pinning are structural enough that a future edit has
 * to break them deliberately.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

/**
 * Comments describe the traps by name, so a scan that cannot tell prose from
 * code reads the explanation as the offence.
 *
 * The JSX form is stripped FIRST and deliberately. Removing `/*…*\/` before
 * `{/*…*\/}` leaves the braces behind as a bare `{}`, which is invisible in a
 * keyword search but not to the position checks below — one of which asserts
 * that a card is preceded by a closed conditional.
 */
const code = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const workspaceSource = read("components/PortfolioWorkspace.tsx");
const workspace = code(workspaceSource);
const riskSource = read("components/RiskWorkspace.tsx");
const risk = code(riskSource);
const bookChromeSource = read("components/portfolio/BookChrome.tsx");
const bookChrome = code(bookChromeSource);

/** The body of one pane, from its own guard to the next thing at panel level. */
function pane(source: string, guard: string, until: string): string {
  const start = source.indexOf(guard);
  assert.ok(start >= 0, `no pane guarded by ${guard}`);
  const end = source.indexOf(until, start);
  assert.ok(end > start, `${guard} is not followed by ${until}`);
  return source.slice(start, end);
}

// --------------------------------------------------------------------------
// The two new splits
// --------------------------------------------------------------------------

describe("Overview and Performance split the house way", () => {
  it("declares both pane states above the book bail-out", () => {
    // The crash this prevents is "rendered more hooks than during the previous
    // render", on the first snapshot that gets past `if (!book)`.
    const bailout = workspace.indexOf("if (!book) return fallback");
    assert.ok(bailout > 0, "the book bail-out has moved or been renamed");
    for (const hook of ["useState<OverviewPane>", "useState<PerformancePane>"]) {
      const at = workspace.indexOf(hook);
      // Found, THEN placed. `indexOf` returns -1 for a hook that is not there
      // at all, which is less than every offset — so an ordering check on its
      // own passes most loudly when the thing it is checking does not exist.
      assert.ok(at >= 0, `${hook} is gone`);
      assert.ok(at < bailout, `${hook} is declared after the bail-out`);
    }
  });

  it("opens each split on the pane that answers the arriving question", () => {
    // Standing, not Book: a reader landing on Portfolio is asking whether
    // anything is wrong before they are asking what is in it. Flow, not Trend:
    // the equity track is empty on the first render of every session.
    assert.match(workspace, /useState<OverviewPane>\("standing"\)/);
    assert.match(workspace, /useState<PerformancePane>\("flow"\)/);
  });

  it("keeps every split inside the two-or-three the seg can carry", () => {
    // `.seg button` is `flex: 1`, so a fourth button forces abbreviated labels;
    // globals.css records this at the rule itself.
    for (const name of ["OVERVIEW_PANES", "POSITIONS_PANES", "ALLOCATION_PANES", "PERFORMANCE_PANES"]) {
      const block = workspace.slice(workspace.indexOf(`const ${name}`));
      const list = block.slice(0, block.indexOf("];"));
      const ids = [...list.matchAll(/\{ id: "/g)].length;
      assert.ok(ids === 2 || ids === 3, `${name} has ${ids} panes; the seg carries two or three`);
    }
  });

  it("renders every new pane conditionally, never behind a hidden attribute", () => {
    // A pane left mounted keeps its charts' ResizeObservers running behind the
    // pane on screen, which is what `hidden` would do.
    for (const id of ["standing", "book"]) {
      assert.match(workspace, new RegExp(`overviewPane === "${id}" &&`), `${id} is not a conditional render`);
    }
    for (const id of ["flow", "trend"]) {
      assert.match(workspace, new RegExp(`performancePane === "${id}" &&`), `${id} is not a conditional render`);
    }
    assert.doesNotMatch(workspace, /hidden=\{(overviewPane|performancePane)/);
  });

  it("puts each card in exactly one pane", () => {
    assert.match(workspace, /overviewPane === "standing" && \(\s*<>\s*\{alerts\.length > 0 && \(/);
    assert.match(workspace, /overviewPane === "book" && \(\s*<>\s*<div className="card portfolio-glance">/);
    assert.match(workspace, /performancePane === "flow" && \(\s*<>\s*<div className="card portfolio-attribution-card">/);
    assert.match(workspace, /performancePane === "trend" && \(\s*<RiskAdjustedTrend/);
  });

  it("leaves the largest-exposures table and the risk tile on the Book side", () => {
    const book = pane(workspace, 'overviewPane === "book"', "</WorkspaceSubtabPanel>");
    assert.match(book, /<h2>Largest exposures<\/h2>/);
    assert.match(book, /<CrossLinkTile<RiskSection>/);
  });
});

// --------------------------------------------------------------------------
// The summary strip is the frame, not a pane
// --------------------------------------------------------------------------

describe("the Overview summary stays above the switcher", () => {
  it("renders the metric strip once, before the seg", () => {
    /**
     * `DataTrustOverview` settled this arrangement first. Equity, day P&L and
     * the binding constraint are the frame both questions are asked inside, so
     * a strip that moved — or vanished into one pane — would make switching
     * panes read as though the book itself had changed.
     */
    const strips = [...workspace.matchAll(/className="portfolio-metrics"/g)].length;
    assert.equal(strips, 1, "the summary strip has been duplicated into a pane");
    assert.ok(
      workspace.indexOf('className="portfolio-metrics"')
        < workspace.indexOf('aria-label="Overview view"'),
      "the summary strip has moved below the switcher",
    );
  });

  it("keeps it outside both panes", () => {
    assert.ok(
      workspace.indexOf('className="portfolio-metrics"') < workspace.indexOf('overviewPane === "standing"'),
      "the summary strip is inside a pane and will disappear when the reader switches",
    );
  });
});

// --------------------------------------------------------------------------
// Standing answers its question even when the answer is "nothing"
// --------------------------------------------------------------------------

describe("the Standing pane cannot render as a blank plane", () => {
  const standing = () => pane(workspace, 'overviewPane === "standing"', 'overviewPane === "book"');

  it("closes both conditionals before the summary card it always renders", () => {
    /**
     * The structural half of the claim. The alerts card and the drift banner
     * are each `{… && (…)}`; the summary that follows them is a sibling, so the
     * character before it is the `)}` of the last conditional rather than the
     * conditional still being open.
     */
    const body = standing();
    const at = body.indexOf('<div className="card">');
    assert.ok(at > 0, "the Standing summary card is gone");
    const before = body.slice(0, at).trimEnd();
    assert.ok(
      before.endsWith(")}"),
      "the Standing summary is inside a conditional, so a quiet book renders an empty pane",
    );
  });

  it("branches its copy on the alert count rather than being gated by it", () => {
    // A ternary produces words on both sides; `&&` produces words on one.
    const body = standing();
    assert.match(body, /alerts\.length \? /);
    assert.match(body, /Nothing is asking for attention/);
  });

  it("reports a drift under the prompt instead of hiding it", () => {
    // The banner only fires at the prompt threshold, so under it the figure was
    // measured and never shown. "Empty results are reported, not hidden."
    const body = standing();
    assert.match(body, /bookDrift >= DRIFT_PROMPT/);
    assert.match(body, /at which this page raises the rebalancing prompt/);
  });

  it("distinguishes an unmeasurable drift from a drift of zero", () => {
    /**
     * The house defect, in its exact shape. `bookDrift` is null when there is
     * too little shared history to build a covariance; printing that as 0%
     * turns "we cannot tell" into "nothing to do", and it type-checks.
     */
    const body = standing();
    assert.match(body, /bookDrift == null/);
    assert.match(body, /which is not the same as being on target/);
    assert.doesNotMatch(workspace, /bookDrift \?\? 0/);
  });
});

// --------------------------------------------------------------------------
// One number, one place
// --------------------------------------------------------------------------

describe("the bands the Standing summary quotes are the bands it tests", () => {
  it("leaves no threshold literal behind in the code", () => {
    /**
     * The summary now says "no position has spent 75% of its symbol cap" in
     * prose. Prose that repeats a number living in a condition goes wrong the
     * first time the condition is retuned, and nothing fails — the page renders
     * a confident sentence about a band it no longer uses.
     */
    assert.doesNotMatch(
      workspace,
      />=\s*0\.\d/,
      "a utilisation threshold is written as a literal again; it belongs in ALERT_BANDS or DRIFT_PROMPT",
    );
    assert.match(workspace, /const ALERT_BANDS = \{/);
    assert.match(workspace, /const DRIFT_PROMPT = 0\.05/);
  });

  it("reads every band off the shared record, in the tests and in the copy", () => {
    for (const band of ["symbolNear", "symbolAtCap", "gross", "drawdown"]) {
      assert.match(workspace, new RegExp(`ALERT_BANDS\\.${band}\\b`), `ALERT_BANDS.${band} is unused`);
    }
    // Both sides of the drift threshold: the banner's condition and the
    // sentence the Standing summary prints under it.
    assert.ok(
      (workspace.match(/DRIFT_PROMPT/g) ?? []).length >= 3,
      "the drift threshold is not shared between the banner, the summary and its copy",
    );
  });
});

// --------------------------------------------------------------------------
// The Performance boundary is a time base
// --------------------------------------------------------------------------

describe("Performance is split along its time base, and says so", () => {
  it("names the time base in the visible label, not only in the hint", () => {
    const block = workspace.slice(workspace.indexOf("const PERFORMANCE_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    assert.match(list, /label: "Flow · lifetime"/);
    assert.match(list, /label: "Trend · this session"/);
  });

  it("keeps the lifetime cards together and the session card alone", () => {
    /**
     * `execution_stats()` on the gateway is `FROM orders` with no session
     * filter, so the execution-quality tiles are measured over the same window
     * as the flow tables — they are those tables' totals row. Putting them with
     * the session chart would have reproduced, inside one pane, exactly the mix
     * the attribution card warns against.
     */
    const flow = pane(workspace, 'performancePane === "flow"', 'performancePane === "trend"');
    assert.match(flow, /<h2>Strategy flow<\/h2>/);
    assert.match(flow, /<h2>Flow by instrument<\/h2>/);
    assert.match(flow, /<h2>Execution quality<\/h2>/);
    assert.doesNotMatch(flow, /<RiskAdjustedTrend/);
  });

  it("says on the quality card itself that its tiles are lifetime", () => {
    // The fee tile said so; the other three did not, and the kicker said
    // "desk-wide", which is a scope rather than a window.
    assert.match(workspace, /page-kicker">Desk-wide and lifetime, computed by the gateway</);
  });

  it("keeps the warning prose that the switcher now makes visible", () => {
    // It explains the boundary rather than substituting for it, so splitting
    // the panel is not licence to delete it.
    assert.match(
      workspaceSource,
      /mixing the two would subtract a lifetime fee bill from one day&apos;s P&amp;L/,
    );
  });
});

// --------------------------------------------------------------------------
// The cross-link tile knows where it is going
// --------------------------------------------------------------------------

describe("a cross-link tile lands on the panel that explains its numbers", () => {
  it("hands the target section to the caller's handler", () => {
    assert.match(bookChrome, /onClick=\{\(\) => onNavigate\(targetSection\)\}/);
  });

  it("keeps both halves optional, so a tab-only caller still works", () => {
    /**
     * The compatibility that makes this safe to land before `page.tsx` catches
     * up: a `() => void` handler is assignable to `(section?: Section) => void`,
     * so the existing wiring keeps compiling and keeps behaving exactly as it
     * did — it simply ignores the argument.
     */
    assert.match(bookChrome, /onNavigate: \(section\?: Section\) => void/);
    assert.match(bookChrome, /targetSection\?: Section/);
  });

  it("types the target against the destination workspace's own section ids", () => {
    // A loose `string` would let a typo compile and fall back to whatever
    // section the reader last had open — the defect this prop exists to end,
    // wearing a different cause.
    assert.match(workspace, /<CrossLinkTile<RiskSection>/);
    assert.match(risk, /<CrossLinkTile<PortfolioSection>/);
  });

  it("sends the Portfolio tile to Limits and the Risk tile to Positions", () => {
    /**
     * Three of the Portfolio tile's four metrics — gross headroom, the drawdown
     * cushion and the binding constraint — are rows of the limit table on
     * `risk/limits`; VaR 95 is the fourth and lives on `risk/model`. The Risk
     * tile's own comment has always said the full positions table is "one click
     * away", which was only true of the tab.
     */
    const portfolioTile = workspace.slice(workspace.indexOf("<CrossLinkTile<RiskSection>"));
    assert.match(portfolioTile.slice(0, 400), /targetSection="limits"/);
    const riskTile = risk.slice(risk.indexOf("<CrossLinkTile<PortfolioSection>"));
    assert.match(riskTile.slice(0, 400), /targetSection="positions"/);
  });

  it("says on the button where the click lands", () => {
    // "Open Risk" named a tab. A destination the reader cannot predict before
    // clicking is the same navigation problem one step earlier.
    assert.match(workspace, /actionLabel="Open Risk limits"/);
    assert.match(risk, /actionLabel="Open Portfolio positions"/);
  });
});

// --------------------------------------------------------------------------
// The fourth copy
// --------------------------------------------------------------------------

describe("the hand-rolled copies of the tile do not multiply", () => {
  /**
   * globals.css says at `.cross-link-tile:hover` that a fourth copy is what
   * this consolidation exists to prevent. `DataConsole` still reimplements the
   * heading, the `.cross-link-metrics` grid and the `.text-action` by hand, and
   * folding it in needs its wrapper geometry moved too — a stylesheet change.
   * Until then this is a ratchet, not a pass: the count may fall, not rise.
   *
   * It measures the shared class, so it sees the copies that reuse the grid.
   * `ReliabilityOverview` is a third copy with its OWN class
   * (`.reliability-data-handoff__metrics`) and is therefore invisible here —
   * naming it in the list would be asserting something this scan does not
   * measure.
   */
  const sourceFiles = (dir: string): string[] => {
    let out: string[] = [];
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) out = out.concat(sourceFiles(full));
      else if (full.endsWith(".tsx")) out.push(full);
    }
    return out;
  };

  it("stays at the two that predate the shared component", () => {
    const handRolled: string[] = [];
    for (const file of sourceFiles(join(root, "components"))) {
      const source = code(readFileSync(file, "utf8"));
      if (!source.includes("cross-link-metrics")) continue;
      if (source.includes("CrossLinkTile")) continue;
      handRolled.push(file.slice(root.length));
    }
    assert.deepEqual(
      handRolled.sort(),
      ["components/DataConsole.tsx"],
      "a surface is reimplementing CrossLinkTile by hand; it has a targetSection now, so use it",
    );
  });
});
