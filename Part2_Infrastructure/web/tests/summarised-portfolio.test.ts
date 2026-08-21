/**
 * THE PORTFOLIO TAB'S REWRITE PASS, PINNED FACT BY FACT.
 *
 * Two passes came before this one and neither could lose a claim. The first
 * DELETED sentences that restated a neighbour and stopped at 1.9%. The second
 * FOLDED prose behind `<details>` byte-identical, so words left the screen and
 * none left the DOM. This pass is the third kind and the only one that can lose
 * something: the same fact, said in fewer words.
 *
 * `8d091a3` is what that looks like when it goes wrong — "Cut 610 words from
 * the frontend, then put 16 facts back". Fluency is not the failure mode. The
 * failure mode is a sentence that reads better and asserts less: a dropped
 * threshold, a dropped "rather than", a missing reason for a missing
 * measurement, a scope caveat quietly promoted to a general claim.
 *
 * So every sentence this pass rewrote is entered below as its FACT TOKENS —
 * the numbers, units, named entities, negations and qualifiers it carries — and
 * each token is asserted still present. A rewrite may reword anything between
 * the tokens. It may not lose one.
 *
 * Two traps this file is built around:
 *
 *  1. AN EMPTY READ PASSES EVERYTHING. A source that resolved to "" satisfies
 *     every negative assertion ever written against it. `read()` refuses a
 *     short file, and the first suite below asserts all eleven arrived.
 *  2. A COMMENT IS NOT THE SCREEN. Comments here quote the copy they explain,
 *     verbatim in several places, so a fact deleted from the JSX would still be
 *     found by a naive search. Comments are stripped before any token is sought.
 *
 * `was` on each entry is the sentence as it stood before this pass and is
 * asserted ABSENT: it is what proves the rewrite happened rather than being
 * quietly reverted while the fact tokens kept passing.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

const WORKSPACE = "components/PortfolioWorkspace.tsx";
const BOOK = "components/portfolio/OverviewBook.tsx";
const STANDING = "components/portfolio/OverviewStanding.tsx";
const POSITIONS = "components/portfolio/PositionsSection.tsx";
const PANEL = "components/portfolio/AllocationPanel.tsx";
const DONUT = "components/portfolio/AllocationDonut.tsx";
const MIXES = "components/portfolio/AllocationMixes.tsx";
const PERFORMANCE = "components/portfolio/PerformanceSection.tsx";
const WATERFALL = "components/portfolio/PnlWaterfall.tsx";
const ORDERS = "components/portfolio/WorkingOrders.tsx";
const CHROME = "components/portfolio/BookChrome.tsx";

/** The eleven files this pass owns. */
const FILES = [WORKSPACE, BOOK, STANDING, POSITIONS, PANEL, DONUT, MIXES, PERFORMANCE, WATERFALL, ORDERS, CHROME];

function read(relative: string): string {
  const source = readFileSync(join(root, relative), "utf8");
  assert.ok(
    source.trim().length > 400,
    `${relative} read as empty or near-empty from ${root}; every check below would pass against nothing`,
  );
  return source;
}

/** Comments removed: a comment quoting the copy must not stand in for it. */
const stripComments = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");

/**
 * One flat line per file, normalised the way a reader sees the words:
 * whitespace collapsed (JSX re-wraps prose whenever it moves), string
 * concatenation seams closed (`"…for a " + "covariance…"` is one sentence to a
 * reader), and the entities this tree writes decoded so a token can be typed
 * normally.
 *
 * The seam pattern demands whitespace on BOTH sides of the `+`, which is what a
 * wrapped literal looks like. `\s*` either side would also swallow the `"+"`
 * that signs a positive number, and this file asserts about signs.
 */
const flatten = (source: string) =>
  source
    .replace(/["`]\s+\+\s+["`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ");

const view = new Map<string, string>();
for (const file of FILES) view.set(file, flatten(stripComments(read(file))));

const of = (file: string): string => {
  const text = view.get(file);
  assert.ok(text && text.length > 200, `${file} flattened to nothing; no assertion against it would mean anything`);
  return text;
};

// --------------------------------------------------------------------------
// The rewrites: [file, what it says, the wording before, the facts it carries]
// --------------------------------------------------------------------------

type Rewrite = [file: string, id: string, was: string, facts: string[]];

const REWRITES: Rewrite[] = [
  [BOOK, "the equity track with too few points to draw",
    "The equity track holds fewer than two observations, so there is no path to draw yet.",
    ["Fewer than two", "observations", "equity track", "no path to draw yet"]],
  [BOOK, "a flat book has nothing to rank",
    "The book is flat — there is no exposure to rank.",
    ["The book is flat", "no exposure to rank"]],
  [BOOK, "the gross headroom tile's utilisation note",
    "% of the cap in use",
    ["book.risk_budget.gross_exposure.utilisation * 100, 1", "% of the cap used"]],

  [STANDING, "the gross-exposure alert",
    "Gross exposure is at ${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap",
    ["Gross exposure is ${fmt(book.risk_budget.gross_exposure.utilisation * 100, 1)}% of the cap",
      "adding to any sleeve needs room made elsewhere"]],
  [STANDING, "the drawdown alert and the reduce-only threshold it quotes",
    "% of the daily drawdown budget is spent; reduce-only engages at",
    ["${fmt(book.risk_budget.daily_drawdown.utilisation * 100, 0)}% of the daily drawdown budget spent",
      "reduce-only engages at ${fmt(ALERT_BANDS.drawdown * 100, 0)}%"]],
  [STANDING, "the rebalancing prompt banner",
    "past the point where rebalancing costs less than the drift",
    ["Book drift is {pct(bookDrift, 1)}", "inverse-volatility",
      "past where rebalancing costs less than the drift"]],

  [POSITIONS, "the Holdings pane hint",
    "Every open position, what it is worth, and the actions on it",
    ["Every open position", "its worth", "the actions on it"]],
  [POSITIONS, "the Exit pane hint",
    "What getting out costs at a chosen participation rate",
    ["What exiting costs", "chosen participation rate", "the orders already working"]],
  [POSITIONS, "the flat book on a stale snapshot",
    "The last successful snapshot was flat. Reconnect before relying on current exposure.",
    ["Last successful snapshot was flat", "reconnect", "before relying on current exposure"]],
  [POSITIONS, "the flat book on a live gateway",
    "The gateway is connected and the book is flat.",
    ["The gateway is connected", "the book is flat"]],

  [CHROME, "why a serverless deployment has no gateway",
    "This site runs the sandbox instead",
    ["Serverless cannot host a long-lived process", "the gateway is one", "The sandbox runs instead",
      "a generated book judged by the same gate logic"]],
  [CHROME, "the stale-data banner",
    "Last successful refresh was {lastRefreshLabel}",
    ["Portfolio data is stale", "Last successful refresh {lastRefreshLabel}",
      "Execution handoffs are disabled until the gateway reconnects"]],

  [PANEL, "what equal weight is for",
    "The baseline the other three have to beat.",
    ["Every position the same size", "the baseline the other three must beat"]],
  [PANEL, "unbalanced manual weights withhold the trades",
    "nothing typed has been rescaled",
    ["Trades are withheld until it balances", "nothing typed was rescaled"]],
  [PANEL, "a book of one has no gap for the band to judge",
    "Target equals current, so there is nothing for the band to suppress.",
    ["Target equals current", "nothing for the band to suppress"]],
  [PANEL, "the proposal forecasts no returns",
    "this answers how the risk should be spread, not what to own",
    ["No expected return is forecast", "how to spread the risk", "not what to own"]],
  [PANEL, "why a small deviation is left alone",
    "than the deviation costs in risk",
    ["Correcting a small deviation costs more in fees and slippage", "than it costs in risk"]],
  [PANEL, "the weights table's disclosure summary",
    "Every weight as a table, with notional now and target",
    ["Every weight as a table", "notional now and target"]],
  // The rewrite here dropped "which is why", leaving a semicolon that asserts only
  // adjacency. Under the house rule a withheld figure must say WHY, and that clause
  // was the why — restored after the fact-loss audit, so the pre-rewrite form is now
  // the correct one and this entry guards the causal link instead.
  [PANEL, "why the current-to-target pair is withheld when the gross cap binds",
    "drift over gross; the",
    ["The gross cap sits below current gross",
      "target weights are measured over the cap and drift over gross",
      "current → target", "pair is withheld", "which is why"]],

  [DONUT, "a flat book has nothing allocated",
    "The book is flat — there is nothing allocated to show.",
    ["The book is flat", "nothing allocated to show"]],
  [DONUT, "gross notional sizing, and what it does not say",
    "so a long and a short of the same size read as two",
    ["Sized by gross notional", "equal-sized long and short", "two concentrations",
      "rather than cancelling", "Whether they move together", "correlation matrix"]],

  [MIXES, "settlement currency is inferred, not recorded",
    "No currency is recorded on a position",
    ["Settlement currency is derived from the ticker", "Positions record no currency",
      "no quote suffix", "counts as unknown", "not as dollars"]],

  [PERFORMANCE, "no audited flow this session",
    "No audited order flow has been recorded for this session.",
    ["No audited order flow", "was recorded", "this session"]],
  [PERFORMANCE, "the lifetime-window disclosure summary",
    "why they cannot be added to the waterfall",
    ["Which window these rows cover", "why they cannot join the waterfall"]],
  [PERFORMANCE, "what a mean latency hides",
    "that took long enough to miss",
    ["A mean decision time hides", "one order in a hundred", "slow enough to miss its price"]],

  [PERFORMANCE, "the Flow pane hint",
    "Every audited order since the log was opened",
    ["Every audited order since the log opened", "by sleeve, by instrument and desk-wide"]],

  [WATERFALL, "the residual leg's disclosure summary",
    "What lands in the leg that is left over",
    ["What lands in the leftover leg"]],
  [WATERFALL, "what the decomposition needs before it can run",
    "No book to decompose yet. The split needs",
    ["No book to decompose yet", "the split needs a session's P&L", "the positions behind it",
      "a reference return"]],

  [ORDERS, "the generated resting orders marker",
    "Never sent and not cancellable",
    ["Generated resting orders", "Never sent, not cancellable",
      "the actions below are disabled rather than hidden"]],
  [ORDERS, "no gateway means no resting book",
    "so there is no resting book to read",
    ["No gateway in this deployment", "no resting book to read"]],
  [ORDERS, "how a resting order meets the caps",
    "the touch crosses it, which is optimistic",
    ["Fills are not queued", "an order fills in full the moment the touch crosses it", "optimistic"]],
  [ORDERS, "a refused replacement leaves nothing resting",
    "so nothing is resting for ${orderId} now",
    ["The replacement was refused by", "the original order is already cancelled",
      "nothing rests for ${orderId} now"]],
];

// --------------------------------------------------------------------------
// 1. The scan reads what it claims to read
// --------------------------------------------------------------------------

describe("the rewrite scan is pointed at real files", () => {
  it("reads all eleven sources, none of them empty", () => {
    assert.equal(view.size, FILES.length);
    for (const file of FILES) assert.ok(of(file).length > 200, `${file} is too short to be the component`);
  });

  it("covers every file this pass rewrote prose in", () => {
    const touched = new Set(REWRITES.map(([file]) => file));
    assert.ok(touched.size >= 9, `only ${touched.size} files carry a pinned rewrite`);
    for (const file of touched) assert.ok(FILES.includes(file), `${file} is not owned by this pass`);
  });

  it("strips comments before looking for a fact", () => {
    // The trap: several comments in this tree quote the copy they explain, so a
    // fact deleted from the JSX would still be findable in the file.
    const stripped = flatten(stripComments('const a = 1; /* Sized by gross notional */ <p>hello</p>'));
    assert.ok(!stripped.includes("Sized by gross notional"));
    assert.ok(stripped.includes("hello"));
  });
});

// --------------------------------------------------------------------------
// 2. Every fact the rewritten sentence carried is still on the page
// --------------------------------------------------------------------------

describe("no rewrite lost a fact", () => {
  for (const [file, id, , facts] of REWRITES) {
    it(`${file.split("/").pop()}: ${id} keeps its ${facts.length} facts`, () => {
      const text = of(file);
      const lost = facts.filter((fact) => !text.includes(fact));
      assert.deepEqual(
        lost, [],
        `a shorter sentence dropped ${lost.length} of ${facts.length} facts — this is 8d091a3:\n    ${lost.join("\n    ")}`,
      );
    });
  }

  it("asserts a meaningful number of facts in total", () => {
    // A table that emptied itself would report green having checked nothing.
    const total = REWRITES.reduce((sum, [, , , facts]) => sum + facts.length, 0);
    assert.ok(total >= 80, `only ${total} fact tokens are pinned`);
  });
});

// --------------------------------------------------------------------------
// 3. The rewrite happened, and stays happened
// --------------------------------------------------------------------------

describe("no rewrite was quietly reverted", () => {
  for (const [file, id, was] of REWRITES) {
    it(`${file.split("/").pop()}: ${id} is not back to its longer form`, () => {
      assert.ok(!of(file).includes(was), `the pre-rewrite wording is back:\n    ${was}`);
    });
  }
});

// --------------------------------------------------------------------------
// 4. The house rules a rewrite is most likely to break
// --------------------------------------------------------------------------

describe("shortening did not break the house rules", () => {
  it("writes no middle dot into any rewritten file", () => {
    // The separator is the cheapest way to shorten a sentence and the one the
    // house forbids: a note is prose, so peer facts take a comma and a
    // qualifier takes a semicolon.
    for (const file of FILES) assert.ok(!of(file).includes("·"), `${file} shortened a phrase into a middle dot`);
  });

  it("leaves no unmeasured figure coerced to zero", () => {
    for (const file of FILES) {
      assert.doesNotMatch(
        of(file),
        /(beta|drift|bookDrift|latency|slippage|distanceBps|p99)\w*\s*\?\?\s*0\b/,
        `${file} answers a missing measurement with a zero`,
      );
    }
  });

  it("keeps the reason beside every withheld measurement it rewrote", () => {
    // A shortened null branch saying only "not measured" is worse than the
    // sentence it replaced. Each of these names the CAUSE, and the cause is the
    // half a rewrite is tempted to drop.
    const reasons: Array<[string, RegExp, string]> = [
      [STANDING, /Drift is not measured: these instruments share too little price history for a covariance/,
        "the drift null branch"],
      [PANEL, /too little shared price history for a covariance\. The proposal is withheld rather than guessed\./,
        "the withheld proposal"],
      [POSITIONS, /Not enough aligned price history to measure/, "the dashed beta"],
      [ORDERS, /No live mark to measure against/, "the dashed distance from mark"],
      [BOOK, /needs price history/, "the dashed VaR"],
    ];
    for (const [file, pattern, what] of reasons) {
      assert.match(of(file), pattern, `${what} stopped saying why it is missing`);
    }
  });

  it("keeps the negations and bounds the shortest sentences hang on", () => {
    // Each of these is a whole claim living in two or three words. "rather
    // than", "not", "never" and "cannot" are what a fluent rewrite drops first,
    // and dropping one leaves a different sentence behind.
    const pairs: Array<[string, RegExp]> = [
      [DONUT, /two concentrations rather than cancelling/],
      [MIXES, /counts as unknown, not as dollars/],
      [MIXES, /Sleeve is traded notional, not holdings/],
      [MIXES, /current exposure by sleeve cannot be derived/],
      [PANEL, /No expected return is forecast/],
      [ORDERS, /Never sent, not cancellable/],
      [ORDERS, /disabled rather than hidden/],
      [ORDERS, /Fills are not queued/],
      [WATERFALL, /Reported, not drawn as a leg/],
      [CHROME, /Nothing is generated in its place/],
      [STANDING, /which is not the same as being on target/],
    ];
    for (const [file, pattern] of pairs) {
      assert.match(of(file), pattern, `${file} lost a negation or a bound to a shorter sentence`);
    }
  });
});
