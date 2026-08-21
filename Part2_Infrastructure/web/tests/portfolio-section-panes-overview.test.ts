/**
 * OVERVIEW'S STANDING PANE CANNOT BE EMPTY, and the bands it quotes in prose
 * are the bands it tests.
 *
 * Both cards the Standing pane was given are conditional: no alert fires until
 * a symbol has spent 75% of its cap, and the drift banner needs both a
 * covariance and 5% of drift. On the quiet book that is the normal case, the
 * pane would have rendered as a blank plane — which `no-dead-ends.test.ts`
 * bans for provenance states and the desk sweep flags at 60 characters of
 * innerText, for the same reason: nothing on screen is indistinguishable from
 * a section that failed to mount.
 *
 * The second half is the same defect one level down. The pane says "no
 * position has spent 75% of its symbol cap" in prose, and prose that repeats a
 * number living in a condition goes wrong the first time the condition is
 * retuned — nothing fails, and the page renders a confident sentence about a
 * band it no longer uses. So the thresholds live in `alert-bands.ts` and every
 * reader of them is checked for importing rather than re-declaring.
 *
 * The summary strip is checked here too, because it is the frame both
 * questions are asked inside: a strip that moved into a pane would make
 * switching panes read as though the book itself had changed.
 *
 * Source-level assertions, like the rest of this suite: there is no DOM here.
 * The split of `PortfolioWorkspace.tsx` into `components/portfolio/` is what
 * makes several of these stricter than they were — "not in the Standing pane"
 * is now measurable as "not in the Standing pane's FILE".
 *
 * Siblings: `-splits` (the split mechanics), `-performance` (the time base),
 * `-cross-link` (the tile's destination).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alertBands,
  overviewBook,
  overviewSection,
  standing,
  workspace,
} from "./helpers/portfolio-sources";

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
