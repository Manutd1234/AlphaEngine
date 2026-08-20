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
 *
 * ── Where these assertions now point ────────────────────────────────────────
 * `PortfolioWorkspace.tsx` was one 1,105-line file holding all five sections
 * and reached the point where the panel a reader wanted could only be found by
 * scrolling past the four they did not. It is now the wiring, and each section
 * is a component under `components/portfolio/`. Every assertion below was
 * re-pointed at the file that holds the code it names — none was relaxed, and
 * several are stricter than the versions that scanned one file, because a
 * property that used to be "this string appears somewhere in 1,105 lines" is
 * now "this string appears in the pane it belongs to and NOT in its sibling".
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
/** The Overview frame: the summary strip, the switcher, and nothing else. */
const overviewSection = code(read("components/portfolio/OverviewSection.tsx"));
/** Its two panes, each now a file, which is what lets a scan say "not there". */
const standing = code(read("components/portfolio/OverviewStanding.tsx"));
const overviewBook = code(read("components/portfolio/OverviewBook.tsx"));
const performanceSource = read("components/portfolio/PerformanceSection.tsx");
const performance = code(performanceSource);
const positionsSection = code(read("components/portfolio/PositionsSection.tsx"));
const allocationSection = code(read("components/portfolio/AllocationSection.tsx"));
/** The one place the bands and the drift prompt are written down. */
const alertBands = read("components/portfolio/alert-bands.ts");
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

/**
 * The four section components that carry an in-panel split, with the pane state
 * each one owns. The workspace mounts them and holds none of this itself.
 */
const SPLIT_SECTIONS: Array<{ name: string; source: string; hook: string }> = [
  { name: "OverviewSection.tsx", source: overviewSection, hook: "useState<OverviewPane>" },
  { name: "PositionsSection.tsx", source: positionsSection, hook: "useState<PositionsPane>" },
  { name: "AllocationSection.tsx", source: allocationSection, hook: "useState<AllocationPane>" },
  { name: "PerformanceSection.tsx", source: performance, hook: "useState<PerformancePane>" },
];

// --------------------------------------------------------------------------
// The two new splits
// --------------------------------------------------------------------------

describe("Overview and Performance split the house way", () => {
  it("declares every pane state above anything that could return early", () => {
    /**
     * The crash this prevents is "rendered more hooks than during the previous
     * render", on the first render that takes a different path from the last.
     *
     * It used to be checkable as "before `if (!book)`", because the pane states
     * and the book bail-out were in one function. The bail-out stayed in the
     * workspace — which is what lets every section be handed a non-null book
     * and carry no null branch of its own — so the states are now checked
     * against the first return of the component that owns them, which is the
     * same property one file along.
     */
    for (const { name, source, hook } of SPLIT_SECTIONS) {
      const start = source.indexOf("export default function");
      assert.ok(start > 0, `${name} has no default-exported component`);
      const body = source.slice(start);
      const at = body.indexOf(hook);
      // Found, THEN placed. `indexOf` returns -1 for a hook that is not there
      // at all, which is less than every offset — so an ordering check on its
      // own passes most loudly when the thing it is checking does not exist.
      assert.ok(at >= 0, `${hook} is gone from ${name}`);
      // The FIRST return keyword of any shape, not the render's own `return (`
      // at the left margin: `if (!x) return null;` is the bail-out this is
      // about, and it does not sit at the start of a line.
      const firstReturn = body.search(/\breturn\b/);
      assert.ok(firstReturn >= 0, `${name} has no return to measure against`);
      assert.ok(at < firstReturn, `${hook} is declared after ${name} can already have returned`);
    }
  });

  it("keeps the book bail-out in the workspace, so no section carries a null branch", () => {
    // The other half of the same arrangement: one bail-out, in the file that
    // owns the snapshot, and five sections whose props cannot be null.
    assert.match(workspace, /if \(!book\) return fallback/, "the book bail-out has moved or been renamed");
    for (const { name, source } of SPLIT_SECTIONS) {
      assert.match(
        source,
        /book: PortfolioPayload;/,
        `${name} does not take a non-null book, so the workspace's single bail-out no longer covers it`,
      );
    }
  });

  it("opens each split on the pane that answers the arriving question", () => {
    // Standing, not Book: a reader landing on Portfolio is asking whether
    // anything is wrong before they are asking what is in it. Flow, not Trend:
    // the equity track is empty on the first render of every session.
    assert.match(overviewSection, /useState<OverviewPane>\("standing"\)/);
    assert.match(performance, /useState<PerformancePane>\("flow"\)/);
  });

  it("keeps every split inside the two-or-three the seg can carry", () => {
    // `.seg button` is `flex: 1`, so a fourth button forces abbreviated labels;
    // globals.css records this at the rule itself.
    const lists: Array<[string, string, string]> = [
      ["OVERVIEW_PANES", overviewSection, "OverviewSection.tsx"],
      ["POSITIONS_PANES", positionsSection, "PositionsSection.tsx"],
      ["ALLOCATION_PANES", allocationSection, "AllocationSection.tsx"],
      ["PERFORMANCE_PANES", performance, "PerformanceSection.tsx"],
    ];
    for (const [name, source, file] of lists) {
      const start = source.indexOf(`const ${name}`);
      assert.ok(start >= 0, `${name} is not declared in ${file}`);
      const block = source.slice(start);
      const list = block.slice(0, block.indexOf("];"));
      const ids = [...list.matchAll(/\{ id: "/g)].length;
      assert.ok(ids === 2 || ids === 3, `${name} has ${ids} panes; the seg carries two or three`);
    }
  });

  it("renders every new pane conditionally, never behind a hidden attribute", () => {
    // A pane left mounted keeps its charts' ResizeObservers running behind the
    // pane on screen, which is what `hidden` would do.
    for (const id of ["standing", "book"]) {
      assert.match(overviewSection, new RegExp(`overviewPane === "${id}" &&`), `${id} is not a conditional render`);
    }
    for (const id of ["flow", "trend"]) {
      assert.match(performance, new RegExp(`performancePane === "${id}" &&`), `${id} is not a conditional render`);
    }
    assert.doesNotMatch(overviewSection, /hidden=\{overviewPane/);
    assert.doesNotMatch(performance, /hidden=\{performancePane/);
  });

  it("puts each card in exactly one pane", () => {
    /**
     * Two claims now, because Overview's panes are two files: the switcher
     * mounts the right component, and that component opens on the card the
     * pane is for. The Performance panes are still two branches in one file and
     * are checked exactly as they were.
     */
    assert.match(overviewSection, /overviewPane === "standing" && \(\s*<OverviewStanding/);
    assert.match(standing, /return \(\s*<>\s*\{alerts\.length > 0 && \(/);
    assert.match(overviewSection, /overviewPane === "book" && \(\s*<OverviewBook/);
    assert.match(overviewBook, /return \(\s*<>\s*<div className="card portfolio-glance">/);
    assert.match(performance, /performancePane === "flow" && \(\s*<>\s*<div className="card portfolio-attribution-card">/);
    assert.match(performance, /performancePane === "trend" && \(\s*<RiskAdjustedTrend/);
  });

  it("leaves the largest-exposures table and the risk tile on the Book side", () => {
    // Stricter than it could be when both panes shared a file: the Standing
    // pane must not merely lack them at the top, it must not contain them.
    assert.match(overviewBook, /<h2>Largest exposures<\/h2>/);
    assert.match(overviewBook, /<CrossLinkTile<RiskSection>/);
    assert.doesNotMatch(standing, /Largest exposures/);
    assert.doesNotMatch(standing, /CrossLinkTile/);
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
    const strips = [...overviewSection.matchAll(/className="portfolio-metrics"/g)].length;
    assert.equal(strips, 1, "the summary strip has been duplicated into a pane");
    assert.ok(
      overviewSection.indexOf('className="portfolio-metrics"')
        < overviewSection.indexOf('aria-label="Overview view"'),
      "the summary strip has moved below the switcher",
    );
  });

  it("keeps it outside both panes", () => {
    // The pane split made this measurable rather than positional: a strip
    // inside a pane is now a strip inside a pane's FILE.
    assert.doesNotMatch(standing, /portfolio-metrics/, "the summary strip has been pulled into the Standing pane");
    assert.doesNotMatch(overviewBook, /portfolio-metrics/, "the summary strip has been pulled into the Book pane");
    assert.ok(
      overviewSection.indexOf('className="portfolio-metrics"') < overviewSection.indexOf('overviewPane === "standing"'),
      "the summary strip is inside a pane and will disappear when the reader switches",
    );
  });
});

// --------------------------------------------------------------------------
// Standing answers its question even when the answer is "nothing"
// --------------------------------------------------------------------------

describe("the Standing pane cannot render as a blank plane", () => {
  it("closes both conditionals before the summary card it always renders", () => {
    /**
     * The structural half of the claim. The alerts card and the drift banner
     * are each `{… && (…)}`; the summary that follows them is a sibling, so the
     * character before it is the `)}` of the last conditional rather than the
     * conditional still being open.
     */
    const at = standing.indexOf('<div className="card">');
    assert.ok(at > 0, "the Standing summary card is gone");
    const before = standing.slice(0, at).trimEnd();
    assert.ok(
      before.endsWith(")}"),
      "the Standing summary is inside a conditional, so a quiet book renders an empty pane",
    );
  });

  it("branches its copy on the alert count rather than being gated by it", () => {
    // A ternary produces words on both sides; `&&` produces words on one.
    assert.match(standing, /alerts\.length \? /);
    assert.match(standing, /Nothing is asking for attention/);
  });

  it("reports a drift under the prompt instead of hiding it", () => {
    // The banner only fires at the prompt threshold, so under it the figure was
    // measured and never shown. "Empty results are reported, not hidden."
    assert.match(standing, /bookDrift >= DRIFT_PROMPT/);
    assert.match(standing, /at which this page raises the rebalancing prompt/);
  });

  it("distinguishes an unmeasurable drift from a drift of zero", () => {
    /**
     * The house defect, in its exact shape. `bookDrift` is null when there is
     * too little shared history to build a covariance; printing that as 0%
     * turns "we cannot tell" into "nothing to do", and it type-checks.
     */
    assert.match(standing, /bookDrift == null/);
    assert.match(standing, /which is not the same as being on target/);
    assert.doesNotMatch(standing, /bookDrift \?\? 0/);
  });
});

// --------------------------------------------------------------------------
// One number, one place
// --------------------------------------------------------------------------

describe("the bands the Standing summary quotes are the bands it tests", () => {
  /** Every file that renders a band or a drift figure, so "one place" is measurable. */
  const readers: Array<[string, string]> = [
    ["PortfolioWorkspace.tsx", workspace],
    ["OverviewSection.tsx", overviewSection],
    ["OverviewStanding.tsx", standing],
    ["OverviewBook.tsx", overviewBook],
  ];

  it("leaves no threshold literal behind in the code", () => {
    /**
     * The summary now says "no position has spent 75% of its symbol cap" in
     * prose. Prose that repeats a number living in a condition goes wrong the
     * first time the condition is retuned, and nothing fails — the page renders
     * a confident sentence about a band it no longer uses.
     */
    for (const [name, source] of readers) {
      assert.doesNotMatch(
        source,
        />=\s*0\.\d/,
        `${name} writes a utilisation threshold as a literal again; it belongs in ALERT_BANDS or DRIFT_PROMPT`,
      );
    }
    assert.match(alertBands, /export const ALERT_BANDS = \{/);
    assert.match(alertBands, /export const DRIFT_PROMPT = 0\.05/);
  });

  it("declares each band exactly once, in the module both panes read", () => {
    // The split gave this a way to go wrong that one file did not have: a pane
    // that grows its own copy of a band rather than importing the record.
    const copies = readers
      .filter(([, source]) => /const (ALERT_BANDS|DRIFT_PROMPT)\s*=/.test(source))
      .map(([name]) => name);
    assert.deepEqual(copies, [], "a threshold has been re-declared beside a pane instead of imported");
    for (const [name, source] of readers.filter(([, body]) => /ALERT_BANDS\.|DRIFT_PROMPT/.test(body))) {
      assert.match(
        source,
        /from "@\/components\/portfolio\/alert-bands"/,
        `${name} reads a band without importing the shared record`,
      );
    }
  });

  it("reads every band off the shared record, in the tests and in the copy", () => {
    // Both Overview panes together: Standing raises the alerts and quotes the
    // bands in prose, Book tones the risk tile with two of the same four. A
    // band declared and read by neither is a band nothing enforces.
    const overview = [standing, overviewBook].join("\n");
    for (const band of ["symbolNear", "symbolAtCap", "gross", "drawdown"]) {
      assert.match(overview, new RegExp(`ALERT_BANDS\\.${band}\\b`), `ALERT_BANDS.${band} is unused`);
    }
  });

  it("uses the one drift threshold in all three of the places it decides", () => {
    /**
     * This replaces a count. The old assertion required the string
     * `DRIFT_PROMPT` to appear at least three times somewhere in the workspace
     * file, as a proxy for "the banner's condition, the summary's inverse of
     * it, and the sentence the summary prints all read the same number". A
     * count cannot survive the code moving, and it could not tell three real
     * uses from three mentions — so the three uses are named instead, which is
     * what the proxy was standing in for and is stricter than it was.
     */
    assert.match(standing, /bookDrift >= DRIFT_PROMPT/, "the banner does not test the shared threshold");
    assert.match(
      standing,
      /bookDrift < DRIFT_PROMPT/,
      "the summary's quiet branch does not test the shared threshold, so the two can disagree",
    );
    assert.match(
      standing,
      /pct\(DRIFT_PROMPT, 0\)/,
      "the summary prints a literal percentage instead of the threshold it just tested",
    );
  });
});

// --------------------------------------------------------------------------
// The Performance boundary is a time base
// --------------------------------------------------------------------------

describe("Performance is split along its time base, and says so", () => {
  it("names the time base in the visible label, not only in the hint", () => {
    const block = performance.slice(performance.indexOf("const PERFORMANCE_PANES"));
    const list = block.slice(0, block.indexOf("];"));
    assert.match(list, /label: "Flow, lifetime"/);
    assert.match(list, /label: "Trend, this session"/);
  });

  it("keeps the lifetime cards together and the session card alone", () => {
    /**
     * `execution_stats()` on the gateway is `FROM orders` with no session
     * filter, so the execution-quality tiles are measured over the same window
     * as the flow tables — they are those tables' totals row. Putting them with
     * the session chart would have reproduced, inside one pane, exactly the mix
     * the attribution card warns against.
     */
    const flow = pane(performance, 'performancePane === "flow"', 'performancePane === "trend"');
    assert.match(flow, /<h2>Strategy flow<\/h2>/);
    assert.match(flow, /<h2>Flow by instrument<\/h2>/);
    assert.match(flow, /<h2>Execution quality<\/h2>/);
    assert.doesNotMatch(flow, /<RiskAdjustedTrend/);
  });

  it("says on the quality card itself that its tiles are lifetime", () => {
    // The fee tile said so; the other three did not, and the kicker said
    // "desk-wide", which is a scope rather than a window.
    assert.match(performance, /page-kicker">Desk-wide and lifetime, computed by the gateway</);
  });

  it("keeps the warning prose that the switcher now makes visible", () => {
    // It explains the boundary rather than substituting for it, so splitting
    // the panel — into panes, and then into a file of its own — is not licence
    // to delete it.
    assert.match(
      performanceSource,
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
    assert.match(overviewBook, /<CrossLinkTile<RiskSection>/);
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
    const portfolioTile = overviewBook.slice(overviewBook.indexOf("<CrossLinkTile<RiskSection>"));
    assert.match(portfolioTile.slice(0, 400), /targetSection="limits"/);
    const riskTile = risk.slice(risk.indexOf("<CrossLinkTile<PortfolioSection>"));
    assert.match(riskTile.slice(0, 400), /targetSection="positions"/);
  });

  it("says on the button where the click lands", () => {
    // "Open Risk" named a tab. A destination the reader cannot predict before
    // clicking is the same navigation problem one step earlier.
    assert.match(overviewBook, /actionLabel="Open Risk limits"/);
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
