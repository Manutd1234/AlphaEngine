/**
 * "THE ORACLE VAR PANEL DOES NOT SHOW A LIVE FEED." Asked twice.
 *
 * WHAT WAS ACTUALLY WRONG
 * ------------------------------------------------------------------------
 * `oracle-var-freshness.test.ts` is the suite next door, and everything it
 * pins was true while this card was dead. Its subject is not BLANKING a good
 * answer; the defect here is that a second answer never arrived, because the
 * only thing that could ever start a run was a change of inputs:
 *
 *   - On the LIVE book, `lib/portfolio-risk/risk.ts` returns null at zero
 *     positions, so `annualVol` is null and `run` returns before fetching.
 *     The panel had never run once, and said only "Waiting for the covariance
 *     model" — a sentence that never resolves on a flat book and never says
 *     the flat book is why.
 *   - On the SANDBOX, `use-book.ts` disables the poll and the generated book is
 *     memoised on its seed, so no input could change for the life of the tab.
 *     It ran exactly once and then held that answer under a chrome claiming a
 *     live feed.
 *   - And a repeat WOULD have been worth drawing. `oracle/02_monte_carlo.sql`
 *     draws `DBMS_RANDOM.NORMAL` with no SEED and persists nothing, so every
 *     call is an independent 20,000-path draw; reimplemented and measured over
 *     300 repeats, sd 1.11% of the figure at 1 day, 0.98% at 30, 0.83% at 90.
 *     The trend keyed each point on its inputs alone, so all of that spread
 *     landed on one dot.
 *
 * Everything below is ADDED to the freshness suite rather than replacing any of
 * it: liveness must not be bought back with the grey screen it fixed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { observationKey, TREND_MAX_OBSERVATIONS } from "../components/risk/OracleVarTrend";
import {
  ORACLE_CADENCE_MS,
  ORACLE_CADENCE_S,
  ORACLE_DEADLINE_MS,
  ORACLE_REFUSED_CADENCE_MS,
} from "../lib/oracle/var-request";
import { readSource, stripCode } from "./helpers/source-files";

const panel = readSource("components/portfolio/OracleVarPanel.tsx");
const code = stripCode(panel);
/** JSX wraps prose at whatever indent it lands on. */
const flat = code.replace(/\s+/g, " ");
const cadence = readSource("lib/oracle/use-var-cadence.ts");
const trend = stripCode(readSource("components/risk/OracleVarTrend.tsx"));

describe("the three sources this suite scans are actually being read", () => {
  it("each loads with content", () => {
    // The empty-haystack trap: a `doesNotMatch` or an `includes` guard over ""
    // is green for ever and looks exactly like a working assertion.
    for (const [name, text] of [["panel", code], ["cadence", cadence], ["trend", trend]] as const) {
      assert.ok(text.length > 1000, `${name} read as ${text.length} chars once stripped`);
    }
  });
});

describe("the panel re-runs on a cadence, and the cadence is argued", () => {
  it("the loop is the shared PollingController, not a hand-rolled interval", () => {
    // `lib/polling.ts` opens with the census of what fourteen hand-rolled loops
    // on this desk got wrong — hidden tabs, backoff, revalidate-on-return,
    // stacking `setInterval` ticks. A fifteenth would have had to decide all
    // four again.
    assert.match(cadence, /usePolling\(\{/);
    assert.doesNotMatch(stripCode(cadence), /setInterval|setTimeout|requestAnimationFrame/,
      "the cadence must be the shared machine, which is the only one under test with a fake clock");
    assert.match(code, /useOracleVarCadence\(\{/, "the panel must actually mount the loop");
  });

  it("it runs only while someone is looking at this panel", () => {
    // Eight subtabs stay mounted behind `display: none` for the life of the
    // workspace, and every tick is a real database call. An ungated loop would
    // have multiplied the spend below by the number of panels a reader had
    // ever opened, none of which are on screen.
    assert.match(code, /enabled: live && annualVol !== null/,
      "the cadence must be gated on being the visible subtab AND having a model to run");
    const workspace = stripCode(readSource("components/RiskWorkspace.tsx"));
    assert.match(workspace, /live=\{active && section === "oraclevar"\}/,
      "both terms: the workspace being the visible tab, and this being the visible subtab");
    // `pauseWhenHidden` is PollingController's default and this loop does not
    // turn it off, so a backgrounded browser tab spends nothing either.
    assert.doesNotMatch(stripCode(cadence), /pauseWhenHidden/,
      "opting out of the hidden-tab pause would spend Oracle CPU on a tab nobody can see");
  });

  it("the interval is defended by arithmetic, not chosen for feeling live", () => {
    assert.equal(ORACLE_CADENCE_MS, 30_000);
    assert.equal(ORACLE_CADENCE_S, 30, "the copy on screen is derived from the interval, never retyped");
    // Cost, executed rather than quoted. A run is ~230ms of database work: the
    // procedure draws one terminal value per path, so a 90-day request costs no
    // more than a 1-day one and the horizon does not enter this sum.
    const runsPerHour = 3_600_000 / ORACLE_CADENCE_MS;
    assert.equal(runsPerHour, 120);
    const cpuSecondsPerHour = runsPerHour * 0.23;
    assert.ok(cpuSecondsPerHour / 3600 < 0.01,
      `${cpuSecondsPerHour.toFixed(1)}s of database CPU an hour is over 1% of the one `
      + "always-available OCPU an Always-Free Autonomous Database provides");
    // Legibility, the other bound: the 40-point cap the chart owns is exactly
    // twenty minutes of history at this cadence. The two numbers were chosen to
    // meet, so a change to either without the other is a chart that either
    // drops history a reader is still watching or waits too long for a line.
    assert.equal((TREND_MAX_OBSERVATIONS * ORACLE_CADENCE_MS) / 60_000, 20);
    // Neither cadence may be shorter than the deadline, or a tick could be due
    // before the request it follows has given up. `PollingController`'s
    // `inFlight` latch would drop the overlapping tick, so the failure is a
    // silently halved cadence rather than a stampede — quiet, which is worse.
    assert.ok(ORACLE_CADENCE_MS > ORACLE_DEADLINE_MS);
    assert.ok(ORACLE_REFUSED_CADENCE_MS > ORACLE_DEADLINE_MS);
    assert.ok(ORACLE_REFUSED_CADENCE_MS > ORACLE_CADENCE_MS,
      "a refusing database must be asked LESS often, not the same amount");
  });

  it("the loop re-reads one book rather than fetching a second one", () => {
    // `tests/risk-live-feed.test.ts` forbids `usePolling(` inside the panel
    // itself, and it is right about what it was written for: a Risk panel that
    // polled for the BOOK would be a second source of truth for equity and a
    // second chance to flap. This loop fetches no book — it re-asks one
    // question about the book the panel was handed as props. The guard's real
    // intent is re-run here, at the address the loop actually lives at, so the
    // extraction cannot become a way to smuggle a book feed in.
    for (const banned of ["/api/gateway/portfolio", "useBook(", "fetch("]) {
      assert.ok(!stripCode(cadence).includes(banned), `the cadence module contains ${banned}`);
    }
    assert.ok(!code.includes("usePolling("), "the panel's own guard still holds");
  });
});

describe("a repeat at unchanged inputs is a measurement, not a duplicate", () => {
  it("the point is keyed on the tick as well as the inputs", () => {
    // The procedure seeds nothing (`oracle/02_monte_carlo.sql` draws
    // DBMS_RANDOM.NORMAL with no SEED and persists nothing), so re-asking the
    // same question returns an INDEPENDENT draw. Keyed on the inputs alone,
    // every one of those draws overwrote the last and the chart could only ever
    // hold one point on a book that was not moving — which is every sandbox
    // book, for the life of the tab.
    assert.match(code, /key: `\$\{observationKey\(equityForRun, annualVol, horizonDays\)\}@\$\{tick\.current\}`/,
      "without the tick suffix a re-run at unchanged inputs is invisible");
    // The tick reaches `record` through a ref rather than its dependency list,
    // because that list is the quantisation contract `risk-stability.test.ts`
    // pins literally. It is written where the run is dispatched, so the value
    // read as an answer lands is the tick that asked for it.
    assert.match(code, /const tick = useRef\(0\);/);
    assert.match(code, /tick\.current = runNonce;\s*const superseded = new AbortController\(\);/,
      "the tick must be stamped at dispatch, not read from wherever the counter got to");
  });

  it("StrictMode is handled by the abort discipline, not by suppressing repeats", () => {
    // Both terminal paths still refuse to land when superseded — pinned at
    // exactly two occurrences above — which is what stops the double-invoked
    // twin recording at all. The tick suffix folds the twin as a second guard,
    // because both invocations belong to ONE tick; a genuine repeat is a later
    // tick and appends. The fold is therefore reachable only for the twin.
    assert.match(code, /const at = kept\.findIndex\(\(o\) => o\.key === point\.key\);/);
    assert.match(code, /at === -1 \? \[\.\.\.kept, point\] : kept\.map/);
    const a = `${observationKey(1_235_000, 0.6042, 30)}@7`;
    assert.equal(a, `${observationKey(1_235_000, 0.6042, 30)}@7`, "one tick, one point");
    assert.notEqual(a, `${observationKey(1_235_000, 0.6042, 30)}@8`,
      "a later tick at identical inputs must be its own observation");
  });
});

describe("no state on this card is silent about itself", () => {
  it("a flat live book is named as the reason, not left as a wait", () => {
    // `lib/portfolio-risk/risk.ts` returns null at zero positions, so a flat
    // book and a model still being measured arrive at this component as the
    // same `annualVol === null`. One sentence for two absences meant the live
    // desk read "Waiting for the covariance model" for ever, with nothing
    // saying that a book with no positions is why, or that it is expected.
    assert.match(code, /positionCount === 0/);
    assert.ok(flat.includes("Nothing to simulate: this book holds no open position"),
      "the flat-book cause must be on screen, in words");
    assert.ok(flat.includes("correct reading of a flat book rather than a fault"),
      "a named absence that reads as a fault is only half the fix");
    // And the wait itself survives for the case it was actually written for.
    assert.ok(flat.includes("Waiting for the covariance model"),
      "a model still being measured is a different state and keeps its sentence");
  });

  it("the chart's empty state explains itself in the register of its caption", () => {
    // The reported blank: at a horizon nothing had run at yet, `shown` is empty
    // and the branch returned one quiet line inside a 156px reserve — no
    // legend, no axis, no caption — while the tiles above stayed populated,
    // because the panel holds its last completed answer across a re-run by
    // design. The 1-observation case never looked broken, and this is that
    // sentence's standard applied to the state before it.
    assert.match(trend, /No completed run at the \{horizonDays\}-day horizon yet/);
    assert.ok(trend.includes("The next re-run lands within ${everySeconds} seconds"),
      "an empty plot must say when its first point arrives");
    assert.ok(trend.includes("a line needs two, so the one after it draws the line"),
      "and when it becomes a line, which is the 1-observation caption's own promise");
    assert.ok(trend.includes("No re-run is scheduled either"),
      "when nothing is scheduled the chart must say so rather than promise a point");
  });

  it("the cadence is disclosed on the card, derived from the constant", () => {
    // Read off `everySeconds`, which is the cadence the panel is ACTUALLY
    // keeping — the slow retry while the database refuses, nothing at all when
    // there is no model or this is not the section on screen. Printing the
    // healthy constant in every state would be a card promising a rate it is
    // not keeping, on the one card whose subject is that distinction.
    assert.ok(flat.includes("It re-runs every ${everySeconds} seconds besides"),
      "the card must disclose its own re-run rate, derived rather than retyped");
    assert.ok(flat.includes("Nothing else is scheduled: this panel simulates only while it is"),
      "and must say so plainly when no re-run is scheduled at all");
    assert.match(code, /const everySeconds = !live \|\| annualVol === null \? null\s*: refusal !== null \? ORACLE_REFUSED_CADENCE_S : ORACLE_CADENCE_S;/,
      "the disclosed rate is derived from the same two constants the loop reads");
    assert.ok(flat.includes("Retrying every ${ORACLE_REFUSED_CADENCE_S} seconds until it answers."),
      "a refused card must say how often it is still trying");
    assert.match(trend, /One every \$\{everySeconds\} seconds while this section is on/,
      "the chart states the cadence the panel is ACTUALLY running at, not the healthy constant");
    assert.ok(trend.includes("independent draw: the spread between these points is its sampling error"),
      "a line that wobbles on an unmoving book must say what the wobble IS");
  });
});
