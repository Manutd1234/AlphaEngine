/**
 * The Oracle VaR card, held to "instant, like the execution tab".
 *
 * WHAT WAS REPORTED
 * ------------------------------------------------------------------------
 * A screenshot of the card showing its heading, its terminal-value sentence,
 * and then a large empty grey block where the four figures belong — with the
 * trend chart below it drawing perfectly. The reserve box was rendering its
 * skeleton while the rest of the card drew, and it was doing so almost all of
 * the time.
 *
 * THE TWO DEFECTS BEHIND IT, AND WHAT THIS FILE PINS
 * ------------------------------------------------------------------------
 * 1. `result === null || running` gated the figures, and `running` covers the
 *    whole of a nine-second in-database simulation. A re-run therefore threw a
 *    perfectly good answer away to show a skeleton — the defect this repo has
 *    already fixed twice, on the risk engine (`loading={riskLoading && !risk}`)
 *    and in `DeskSourceMachine` ("measured data is never replaced by generated
 *    data"). The vocabulary for keeping it is `cached`, and it is not invented
 *    here: `lib/data-tier.ts` defines it.
 * 2. The re-run fired far more often than the panel's own comments claimed.
 *    Equity was quantised into $1,000 buckets; the volatility it was keyed on
 *    beside it was not, and `annualVol` is `√(wᵀΣw)·√ann` over equity-normalised
 *    weights — a new double on every fifteen-second book poll. The card spent
 *    its life mid-request because it was almost always mid-request.
 *
 * The arithmetic below is EXECUTED, not restated: the bucket rule is extracted
 * from the component and run, and the claim that the bucket is inside the
 * simulation's own sampling error is computed from the closed form the panel
 * ships rather than quoted from a comment.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gbmTerminalVar99 } from "../lib/portfolio-risk";
import { observationKey } from "../components/risk/OracleVarTrend";
import { readSource, stripCode } from "./helpers/source-files";

const panel = readSource("components/portfolio/OracleVarPanel.tsx");
const code = stripCode(panel);
/** The request contract, extracted when the panel hit the 400-line ceiling.
 *  Read here because the quantisation this suite executes now lives across two
 *  files, and a suite that only read the panel would have gone quiet on the
 *  half that moved. The cadence added beside it has its own suite,
 *  `oracle-var-cadence.test.ts`. */
const request = readSource("lib/oracle/var-request.ts");
/** JSX wraps prose at whatever indent it lands on. */
const flat = code.replace(/\s+/g, " ");

describe("a good answer is never blanked", () => {
  it("the file is being read, so every doesNotMatch below scans something", () => {
    // The empty-haystack trap this tree has found repeatedly: a negative
    // assertion over "" is green for ever and looks exactly like a working one.
    assert.ok(code.length > 2000, `the panel read as ${code.length} chars once stripped`);
  });

  it("no skeleton is rendered at all", () => {
    // Not "the skeleton is better gated" — there is no state left that it is
    // the honest answer for. The one it had, nothing at all to show, is now
    // the closed form with the simulated half dashed.
    assert.doesNotMatch(code, /className="skeleton"/,
      "a grey rectangle is strictly less than a true number with its slow half dashed");
    assert.doesNotMatch(code, /\|\| running \?/,
      "figures gated on `running` blank a good answer for the whole of a 9s request");
  });

  it("only two states come before the figures, and neither is in-flight", () => {
    // The order is the argument: no model at all, then a refusal with nothing
    // held, then the tiles. `running` appears in the second condition solely to
    // let a retry paint the closed form instead of the previous failure.
    assert.match(code, /\{annualVol === null \? \(/);
    assert.match(code, /\) : sim === null && refusal !== null && !running \? \(/);
  });

  it("a re-run demotes the figures to `cached` instead of removing them", () => {
    // Keyed on `sim`, not on `held`, and the difference is load-bearing rather
    // than cosmetic: `held` may carry an answer computed for the OTHER book,
    // and `sim` is the one that survives the sandbox check below. Demoting a
    // held-but-discarded answer to "cached" would label a figure that is not on
    // screen, and — worse — would mark the card cached at the exact moment it
    // has nothing to show. The tier describes what the reader is looking at.
    assert.match(code,
      /const cached = sim !== null && \(running \|\| refusal !== null \|\| held\?\.key !== requestKey\)/,
      "in-flight, refused, and superseded-by-new-inputs are all the cached tier");
    // The key comparison is what makes the first render after a horizon change
    // already honest — before the effect has even fired. `sandbox` rides on the
    // same record so the held answer knows which book it was computed for.
    assert.match(code, /const \[held, setHeld\] = useState<\{ answer: OracleVarOk; key: string; sandbox: boolean \} \| null>/);
  });

  it("a held answer does not survive the Live/Sandbox toggle", () => {
    // The one case where discarding IS the honest move: the toggle swaps every
    // position, so the held answer describes a different book. Keeping it would
    // put generated figures under a live card wearing the "last completed run"
    // label that makes them look trustworthy. `risk-stability.test.ts` pins the
    // dependency list this needs; what is pinned here is the use it is for.
    assert.match(code, /const sim = held !== null && held\.sandbox === sandbox \? held\.answer : null/,
      "a reading of the other book is discarded, not demoted to cached");
    assert.match(code, /setHeld\(\{ answer, key: observationKey\(equityForRun, annualVol, horizonDays\), sandbox \}\)/,
      "the book the answer was computed for must travel with it");
    assert.match(code, /const cached = sim !== null &&/,
      "cached describes a reading of THIS book; the discarded one is not cached, it is gone");
  });

  it("the status line says which run the figures on screen came from", () => {
    assert.ok(flat.includes("the last completed simulation"), "a refused refresh must say so");
    assert.ok(flat.includes("the last completed run, ${ranOn}, and stay"),
      "a re-run must say the figures are held, and name what they were computed on");
    assert.match(code, /const ranOn = sim === null \? "" : `\$\{usd\(sim\.assumptions\.equity, 0\)\} over \$\{sim\.assumptions\.days\} d`/,
      "what it ran on is the ECHOED equity and horizon, not the props being asked for now");
  });

  it("every tile describes the run it came from, not the request in flight", () => {
    // A tile labelled with the horizon it did not run over would be a worse
    // lie than the blanking this pass removed.
    assert.match(code, /paths over \$\{sim\.assumptions\.days\} d/);
    assert.doesNotMatch(code, /paths over \$\{horizonDays\}/,
      "the note must read the answer's echoed horizon, never the current prop");
    assert.match(code, /mean terminal value; computed in \$\{sim\.computedInMs\} ms/);
  });

  it("a figure that does not exist yet is a dash, never a zero", () => {
    assert.match(code, /const money = \(value: number \| null\) => \(value === null \? "—" : usd\(value, 0\)\)/,
      "the dash tests null, so a genuine floored-at-zero VaR still renders as $0");
    assert.doesNotMatch(code, /var99 \?\? 0/);
    assert.doesNotMatch(code, /expectedEquity \?\? 0/);
  });

  it("the reserve boxes both stay, so nothing bounces", () => {
    assert.match(code, /minHeight: 192/);
    assert.match(code, /minHeight: ORACLE_TREND_RESERVE/);
  });
});

describe("the fast figure is on screen before the database is asked", () => {
  it("the closed form is priced on the requested inputs, in this browser", () => {
    assert.match(code,
      /const requestedVar = annualVol === null \? null\s*: gbmTerminalVar99\(equityForRun, GBM_EXPECTED_ANNUAL_RETURN, annualVol, horizonDays\)/);
    assert.match(code, /value=\{money\(sim === null \? requestedVar : clientVar\)\}/,
      "before an answer the tile shows the requested-input closed form; after one, the echoed");
  });

  it("it never becomes the divergence baseline", () => {
    // The divergence exists to surface method disagreement, and the route
    // clamps its inputs — so a comparison against the UNCLAMPED request would
    // report the clamp as disagreement. That is why the baseline is the echoed
    // `clientVar` and why the tile dashes until there is an answer.
    assert.match(code,
      /const divergence = sim !== null && clientVar !== null && clientVar > 0\s*\?\s*\(sim\.var99 - clientVar\) \/ clientVar/);
    assert.match(code,
      /const clientVar = assumptions === null \? null\s*: gbmTerminalVar99\(assumptions\.equity, assumptions\.mu, assumptions\.sigma, assumptions\.days\)/);
    const uses = [...code.matchAll(/requestedVar/g)].length;
    assert.equal(uses, 2, "requestedVar may be declared once and read once — never by the divergence");
  });

  it("the pre-answer figure is a real number, not a placeholder", () => {
    // The whole claim of the instant paint: this is arithmetic, it is finite,
    // and it is positive for an ordinary book. A dash here would mean the card
    // still has nothing to say before the database answers.
    const early = gbmTerminalVar99(1_000_000, 0.08, 0.6, 30);
    assert.ok(Number.isFinite(early) && early > 0, "the closed form must produce a figure");
    // And it is the same function the divergence prices with, so the two
    // cannot drift into being different models of the same book.
    assert.equal(early, gbmTerminalVar99(1_000_000, 0.08, 0.6, 30));
  });
});

describe("the re-run cadence is what the comments claim", () => {
  /** The bucket rule, extracted from the component and executed — a copy here
   *  would stay green while the shipped rule drifted away from it. */
  const bucketSource = panel.match(/Math\.round\(measuredAnnualVol \* VOL_BUCKET\) \/ VOL_BUCKET/);
  // The constant moved to `lib/oracle/var-request.ts` with the rest of what
  // describes a request; the rule that APPLIES it stayed in the panel, because
  // the dependency lists that quantisation exists to stabilise are there.
  const sizeSource = request.match(/const VOL_BUCKET = ([0-9_]+);/);

  it("the volatility input is bucketed, and the bucket is a basis point", () => {
    assert.ok(bucketSource, "the sigma bucket is gone — every book poll re-simulates again");
    assert.ok(sizeSource, "VOL_BUCKET is gone");
    assert.equal(Number((sizeSource as RegExpMatchArray)[1].replace(/_/g, "")), 10_000,
      "a basis point of annualised volatility");
  });

  const VOL_BUCKET = Number((sizeSource as RegExpMatchArray)[1].replace(/_/g, ""));
  const bucket = new Function("measuredAnnualVol", "VOL_BUCKET",
    `return ${(bucketSource as RegExpMatchArray)[0]};`) as (v: number, b: number) => number;

  it("a poll-sized volatility tick lands in the same bucket", () => {
    // `annualVol` is √(wᵀΣw)·√ann with w = signedNotional / equity, so every
    // poll that moves a mark or the equity by a cent produces a new double.
    // Collapsing them is what stops the request identity changing.
    const measured = 0.604213;
    assert.equal(bucket(measured, VOL_BUCKET), bucket(measured + 0.0000212, VOL_BUCKET));
    assert.equal(bucket(measured, VOL_BUCKET), 0.6042);
    // Five basis points is a real move and must still re-simulate.
    assert.notEqual(bucket(measured, VOL_BUCKET), bucket(measured + 0.0005, VOL_BUCKET));
  });

  it("the observation key collapses with it, so the trend records one fact once", () => {
    const a = observationKey(1_235_000, bucket(0.604213, VOL_BUCKET), 30);
    const b = observationKey(1_235_000, bucket(0.604231, VOL_BUCKET), 30);
    assert.equal(a, b, "an unbucketed sigma appended a fresh observation on every poll");
    assert.notEqual(a, observationKey(1_235_000, bucket(0.604213, VOL_BUCKET), 90),
      "a different horizon is a different measurement and keeps its own point");
  });

  it("the bucket discards less than the simulation's own sampling error", () => {
    // The measurement the VOL_BUCKET comment records, computed here rather
    // than remembered. A bucket that threw away more than the Monte Carlo's
    // noise would be hiding a real move behind a tidy cadence.
    const paths = 20_000;
    const worst = { drop: 0, se: Infinity };
    for (const sigma of [0.25, 0.6, 1.2]) {
      for (const days of [1, 30, 90]) {
        const equity = 1_000_000;
        const mu = 0.08;
        const t = days / 365;
        const varAt = gbmTerminalVar99(equity, mu, sigma, days);
        const drop = Math.abs(gbmTerminalVar99(equity, mu, sigma + 1 / VOL_BUCKET, days) - varAt) / varAt;
        // Standard error of the sample 1st percentile: √(p(1−p)/n) ÷ f(q),
        // with q read back off the closed form so no z is spelled out here.
        const q = equity - varAt;
        const z = ((mu - 0.5 * sigma * sigma) * t - Math.log(q / equity)) / (sigma * Math.sqrt(t));
        const density = Math.exp(-0.5 * z * z) / (Math.sqrt(2 * Math.PI) * sigma * Math.sqrt(t) * q);
        const se = Math.sqrt(0.01 * 0.99 / paths) / density / varAt;
        worst.drop = Math.max(worst.drop, drop);
        worst.se = Math.min(worst.se, se);
      }
    }
    assert.ok(worst.drop < 0.0005, `a basis point moves the VaR by ${(worst.drop * 100).toFixed(4)}%`);
    assert.ok(worst.se > 0.004, `20,000 paths locate it to ${(worst.se * 100).toFixed(3)}%`);
    assert.ok(worst.drop * 10 < worst.se,
      "the bucket must stay an order of magnitude inside the simulation's own noise");
  });

  it("the equity bucket it works beside is untouched", () => {
    assert.match(code, /Math\.round\(equity \/ 1_000\) \* 1_000 \|\| equity/,
      "removing the equity bucket to make the card livelier is the worse defect");
  });
});

describe("a superseded run lands nowhere", () => {
  it("the effect cancels the request whose inputs no longer exist", () => {
    assert.match(code, /const superseded = new AbortController\(\);\s*void run\(superseded\.signal\);\s*return \(\) => superseded\.abort\(\);/,
      "without the cleanup a mid-flight request can land after the one that replaced it");
    // The cadence does not open a request of its own. It bumps `runNonce`, and
    // the dependency list below is what turns that into a run — so a scheduled
    // run and an input-driven one are the same code path with the same
    // cancellation. Two entry points would have been two ways to land a stale
    // answer over a fresh one, which is the defect this describe block opens on.
    assert.match(code, /\}, \[run, runNonce\]\);/,
      "the cadence tick must drive the SAME effect, not a second request path");
  });

  it("a cancellation is not reported as a database that failed to answer", () => {
    // Both landing paths return before touching state, so a superseded run
    // records no observation — a "not computed" tick on the chart for a
    // question nobody is asking any more would be the chart inventing history.
    assert.equal([...code.matchAll(/if \(superseded\?\.aborted\) return;/g)].length, 2,
      "the success path and the catch must both refuse to land");
    assert.match(code, /if \(!superseded\?\.aborted\) setRunning\(false\)/,
      "a superseded run must not clear the flag its replacement has already set");
  });

  it("the deadline is still its own, and still reported", () => {
    // `no-dead-ends.test.ts` exempts this panel from probeGateway on the
    // strength of this deadline; the supersede signal is additional to it,
    // never a replacement.
    assert.match(code, /const timer = setTimeout\(\(\) => controller\.abort\(\), ORACLE_DEADLINE_MS\)/);
    assert.ok(flat.includes("The database did not answer within ${ORACLE_DEADLINE_MS / 1000}s."));
  });
});
