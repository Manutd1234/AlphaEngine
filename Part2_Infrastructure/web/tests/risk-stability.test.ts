/**
 * The Risk tab on a flapping gateway, pinned.
 *
 * Every panel on this tab renders one polled snapshot — the book — plus two
 * loss estimates that re-simulate when their inputs change. Three decisions
 * keep the tab still while the network is not:
 *
 *  1. A failed poll never sends the tab to its fallback card or a generated
 *     book. `DeskSourceMachine` holds the last measured payload, demotes the
 *     tier to cached at once and re-promotes only on a streak, so the stale
 *     banner appears once and holds rather than flipping per packet.
 *  2. Neither Monte Carlo re-simulates on the poll cadence. Both quantise the
 *     book's equity to $1,000 buckets with one rule, so a sub-bucket equity
 *     tick changes neither request.
 *  3. A re-run reserves the space its result will take, so a parameter change
 *     repaints the simulation card instead of bouncing everything below it.
 *
 * The machine's own doctrine is pinned in `tests/desk-source.test.ts`, and the
 * one-horizon consolidation in `tests/tab-consolidation.test.ts`. What is
 * pinned here is that the Risk tab's rendered decisions actually ride on that
 * machinery — the sequences a flapping gateway produces, replayed against the
 * class the tab reads, plus the source-level wiring a future edit would have
 * to break deliberately (the same approach `risk-actions.test.ts` takes).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DeskSourceMachine, PROMOTION_STREAK, type ProbeOutcome } from "../lib/desk-source";
import { readSource, stripCode } from "./helpers/source-files";

/** The slice of the portfolio payload these sequences need to tell apart. */
interface Book { equity: number }

const ok = (equity: number): ProbeOutcome<Book> => ({ ok: true, payload: { equity } });
const down: ProbeOutcome<Book> = {
  ok: false,
  failure: { message: "the gateway did not answer this poll" },
};

// --------------------------------------------------------------------------
// 1. The book under the limits
// --------------------------------------------------------------------------

describe("a failed poll never blanks the risk tab", () => {
  it("one failure after a reading keeps the book, demoted to cached", () => {
    const m = new DeskSourceMachine<Book>();
    m.observe(ok(1_000_000));
    m.observe(down);
    const { showing, tier } = m.state;
    assert.equal(showing.kind, "measured", "the limits panel must keep its numbers");
    assert.equal(showing.kind === "measured" && showing.payload.equity, 1_000_000);
    assert.equal(tier, "cached", "the failure is reported as staleness, not absence");
  });

  it("a flapping gateway holds one steady decision: measured, cached", () => {
    // RiskWorkspace opens with `if (!book) return fallback` — so if the book
    // ever went null mid-flap, every subtab would unmount, every scenario
    // input and scroll position would reset, and the fallback card would
    // strobe on the poll cadence. This sequence is that gateway: one poll in
    // two answering, for fifty polls.
    const m = new DeskSourceMachine<Book>();
    m.observe(ok(1_000_000));
    const kinds = new Set<string>();
    const tiers: string[] = [];
    for (let poll = 0; poll < 50; poll += 1) {
      m.observe(poll % 2 === 0 ? down : ok(1_000_000 + poll));
      kinds.add(m.state.showing.kind);
      tiers.push(m.state.tier);
    }
    assert.deepEqual([...kinds], ["measured"], "no fallback card, no generated book, ever");
    assert.deepEqual([...new Set(tiers)], ["cached"],
      "the stale banner appears once and holds — it does not flip per packet");
    const { showing } = m.state;
    assert.equal(showing.kind === "measured" && showing.payload.equity, 1_000_049,
      "each successful poll still lands: cached demotes the badge, never the data");
  });

  it("recovery is a streak, not a packet", () => {
    const m = new DeskSourceMachine<Book>();
    m.observe(ok(1_000_000));
    m.observe(down);
    for (let i = 0; i < PROMOTION_STREAK - 1; i += 1) {
      m.observe(ok(1_000_000));
      assert.equal(m.state.tier, "cached",
        `success ${i + 1} of ${PROMOTION_STREAK} must not clear the stale banner yet`);
    }
    m.observe(ok(1_000_000));
    assert.equal(m.state.tier, "live", "the full streak clears it");
  });

  it("the workspace guards on the book alone, through the shared fallback", () => {
    const workspace = readSource("components/RiskWorkspace.tsx");
    assert.match(workspace, /const fallback = <BookFallback view=\{view\}/);
    assert.match(workspace, /if \(!book\) return fallback;/);
  });
});

describe("the risk tab reads the one book feed", () => {
  // `workspace-routing-shared-fetch.test.ts` already forbids a direct book
  // fetch in RiskWorkspace; these are the tab's own panel files, which that
  // scan does not walk. A private poll or a second `useBook()` here would be
  // a second source of truth for equity — and a second chance to flap.
  const panels = [
    "components/risk/MonteCarloDistribution.tsx",
    "components/risk/McParameterRail.tsx",
    "components/risk/McHistogram.tsx",
  ];

  it("no risk panel fetches the book or polls for itself", () => {
    for (const path of panels) {
      const code = stripCode(readSource(path));
      for (const banned of ["/api/gateway/portfolio", "useBook(", "usePolling(", "setInterval("]) {
        assert.ok(!code.includes(banned), `${path} contains ${banned}: the book arrives as props`);
      }
    }
  });

  it("the workspace takes the shared view as a prop rather than polling", () => {
    const code = stripCode(readSource("components/RiskWorkspace.tsx"));
    assert.ok(code.includes("view: BookView"), "the one book feed arrives through props");
    assert.ok(!code.includes("useBook("), "a second useBook() would be a second poll");
  });
});

// --------------------------------------------------------------------------
// 2. The two loss estimates and the poll cadence
// --------------------------------------------------------------------------

describe("neither loss estimate re-simulates on the poll cadence", () => {
  const QUANTISE = /Math\.round\(equity \/ 1_000\) \* 1_000 \|\| equity/;
  const cards = [
    "components/risk/MonteCarloDistribution.tsx",
    "components/portfolio/OracleVarPanel.tsx",
  ];

  it("both cards quantise equity with the identical rule", () => {
    // Extracted from each file and executed, not re-stated: the test runs the
    // expression the cards actually ship, so the two rules cannot drift apart
    // while a copy here stays green.
    for (const path of cards) {
      const source = readSource(path);
      const match = source.match(QUANTISE);
      assert.ok(match, `${path} no longer quantises equity — every 15s book poll re-simulates`);
      const bucket = new Function("equity", `return ${match[0]};`) as (equity: number) => number;
      assert.equal(bucket(1_234_567), 1_235_000);
      assert.equal(bucket(1_234_567), bucket(1_234_940),
        "a sub-bucket equity tick lands in the same bucket, so the request identity holds");
      assert.equal(bucket(400), 400,
        "a sub-$500 book keeps its real equity — rounding to zero would simulate a book that has none");
    }
  });

  it("the bootstrap request is keyed on the bucket, never the raw equity", () => {
    const source = readSource("components/risk/MonteCarloDistribution.tsx");
    assert.match(source, /equity: equityForRun/);
    // `driverDefect` joined the list when the degeneracy guard landed — it is
    // the only addition, and every name the original pinned is still here in
    // its original order. The point of the assertion is unchanged: the memo
    // keys on the BUCKET, so a sub-bucket equity tick cannot re-simulate.
    assert.match(
      source,
      /\[driver, driverDefect, horizonDays, paths, resampler, blockLength, bands, seedOverride, seedUnusable, equityForRun, runNonce\]/,
      "the request memo's dependency list must carry the bucket, not the tick",
    );
    assert.doesNotMatch(source, /\bequity\b(?![A-Za-z])[^\n]*\]\);/,
      "the raw equity prop must never appear in the request memo's dependency list");
  });

  it("the GBM run is keyed on the bucket too", () => {
    const source = readSource("components/portfolio/OracleVarPanel.tsx");
    assert.match(source, /equity: equityForRun/);
    // `record` joined the run callback's list when the re-run trend landed; it
    // is a `useCallback` over exactly the same three inputs, which is why its
    // own list is asserted too rather than the addition being waved through.
    // `sandbox` joined it when the panel started holding its last good answer:
    // the held record stamps which book it was computed for, so a Live/Sandbox
    // toggle discards it rather than captioning generated figures as a live
    // run. It is READ inside the callback, so omitting it would be a stale
    // closure — the reason this list is pinned at all.
    assert.match(source, /\[annualVol, equityForRun, horizonDays, record, sandbox\]/,
      "the run callback re-fires on a model, horizon or book change, never on an equity tick");
    assert.match(source, /\[annualVol, equityForRun, horizonDays\],\n\s*\);/,
      "the trend recorder keys on the same three inputs the run does");
  });
});

describe("an unusable seed simulates nothing", () => {
  it("the request goes null rather than running on a seed nobody chose", () => {
    // `parseMcSeed`'s refusals are pinned value by value in
    // `tests/mc-distribution.test.ts`; this is the other half — that a refusal
    // actually stops the simulation instead of being papered over with the
    // derived seed or with zero.
    const source = readSource("components/risk/MonteCarloDistribution.tsx");
    // The degeneracy guard joined this condition; the seed refusal it was
    // written for is still the third clause, unweakened.
    assert.match(source,
      /if \(!driver \|\| driver\.returns\.length === 0 \|\| seedUnusable \|\| driverDefect\) return null;/);
    assert.match(source, /seed: seedOverride \?\? driver\.seed/,
      "the derived seed steps in only when the box is empty, never over a typed one");
  });
});

describe("terminal facts are never buffered", () => {
  const hook = readSource("lib/use-mc-distribution.ts");

  it("only the progress readout passes through the throttle", () => {
    // The worker posts a progress frame every 500 paths; the counter goes
    // through the window so it repaints at a readable rate. `status`,
    // `result` and `error` must not: a finished simulation sitting behind a
    // throttle is a card lying about being busy.
    assert.match(hook, /useThrottledValue\(state\.progress\)/);
    assert.match(hook, /state\.status === "running" \? \{ \.\.\.state, progress \} : state/);
  });

  it("a superseded run cannot overwrite a newer one", () => {
    // Two guards, one for the result and one for the error: a slow worker
    // finishing after the reader has already changed a parameter must land
    // nowhere. Without them the card would flash the old distribution over
    // the new run — the render-level twin of the poll flap above.
    const guards = hook.match(/if \(current !== generation\.current\) return;/g) ?? [];
    assert.ok(guards.length >= 2, "the generation guard must cover both terminal paths");
    assert.match(hook, /worker\?\.terminate\(\)/, "an abandoned worker is stopped, not leaked");
  });
});

// --------------------------------------------------------------------------
// 3. Layout stability across a re-run
// --------------------------------------------------------------------------

describe("a re-run reserves the space its result will take", () => {
  const card = readSource("components/risk/MonteCarloDistribution.tsx");

  it("the histogram reserve matches the drawn histogram block", () => {
    assert.match(card, /height: 212/);
  });

  it("the tile reserve is the same shape as the tile grid, at every width", () => {
    // Mean outcome, three loss confidences, worst case: five StatTiles. On
    // the four-track `.stability-tiles` grid they land 4 + 1 — two rows —
    // so the fallback reserve is 196px, two 92px rows plus the 12px grid
    // gap. A one-row reserve let every horizon or parameter change collapse
    // the card by a tile row and bounce whatever sat below it — the exact
    // twitch the reserve exists to prevent.
    //
    // Updated by the 2026-08-22 density pass: at desk width the Risk density
    // partial lays the five tiles on five tracks, one row, so the reserve is
    // now a custom property the partial narrows ALONGSIDE that grid rule.
    // The component carries the two-row fallback; hard-coding either height
    // again would desynchronise reserve and result at one width or the other.
    assert.match(card, /\[result\.loss\.p50, result\.loss\.p95, result\.loss\.p99\]\.map/);
    assert.match(card, /height: "var\(--mc-tile-reserve, 196px\)"/,
      "the tile skeleton's fallback must reserve two 92px rows plus the 12px grid gap");
    assert.doesNotMatch(card, /height: 92/,
      "a hard-coded one-row reserve under-reserves by a full row of tiles below the desk breakpoint");
  });

  it("the desk-width one-row tile grid narrows the reserve with it", () => {
    // The pair of declarations must move together: five tracks without the
    // narrowed reserve makes every desk re-run over-reserve by a row and
    // collapse the card when the result lands; a narrowed reserve without
    // the five tracks under-reserves the 4 + 1 layout. Both live in the one
    // media query so neither can apply without the other.
    const density = readSource("app/globals/14e-density-risk.css");
    assert.match(density, /@media \(min-width: 1280px\)/,
      "density overrides are desk-only; phones keep the stacked flow");
    assert.match(density,
      /#risk-subpanel-montecarlo \.stability-tiles \{[^}]*repeat\(5, minmax\(0, 1fr\)\)/,
      "five tiles on five tracks at desk width");
    assert.match(density, /--mc-tile-reserve: 92px/,
      "the reserve must match the one-row grid it precedes");
  });
});

describe("a model re-fetch never blanks a rendered model", () => {
  it("the risk engine's skeleton is gated on having nothing to show", () => {
    // `riskLoading` turns true whenever the held-bar fetch re-runs — a
    // position change, not a poll — and the engine keeps the model it has
    // until the new one lands. `loading` alone would swap a rendered
    // covariance for a skeleton on every re-fetch.
    const workspace = readSource("components/RiskWorkspace.tsx");
    assert.match(workspace, /loading=\{riskLoading && !risk\}/);
  });
});

// --------------------------------------------------------------------------
// 4. The stale write gate
// --------------------------------------------------------------------------

describe("the stale banner's claim about handoffs", () => {
  it("is enforced where the handoff executes, not only claimed in the banner", () => {
    const handoff = readSource("components/portfolio/ExecutionHandoff.tsx");
    assert.match(handoff, /stale: boolean/, "ExecutionHandoff needs a staleness input");
    assert.match(handoff, /!sandbox && !stale && !locked && !noGateway/,
      "the action gate ignores a stale book");
    assert.match(handoff, /if \(!canExecute\) return;/,
      "the event handler relies only on the button's disabled attribute");
    assert.match(handoff, /disabled=\{sandbox \|\| stale \|\| locked \|\| noGateway\}/,
      "the confirmation input remains armed under a stale book");
    const workspace = readSource("components/RiskWorkspace.tsx");
    assert.match(workspace, /stale=\{view\.isStale\}/,
      "the risk tab must pass the staleness it already banners on");
    const portfolio = readSource("components/PortfolioWorkspace.tsx");
    assert.match(portfolio, /stale=\{isStale\}/,
      "the portfolio tab must pass the staleness it already banners on");
  });

  it("keeps the banner and the executing control on the same promise", () => {
    const chrome = readSource("components/portfolio/BookChrome.tsx");
    assert.match(chrome, /Execution handoffs are[\s\S]{0,30}disabled until the gateway reconnects/);
  });
});
