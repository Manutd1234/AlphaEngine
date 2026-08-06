/**
 * A P&L decomposition is only worth having if it can refuse to produce one.
 *
 * The arithmetic in `lib/pnl-attribution.ts` is four lines long. Everything else
 * in that module — and almost everything below — is about the cases where a leg
 * cannot be measured, because those are the cases where a decomposition turns
 * from an explanation into a fabrication. Three of them are subtle enough to be
 * worth naming:
 *
 *  - A withheld market leg must withhold the **residual** too. The subtraction
 *    still works: `dayPnl - 0` is a perfectly good number, it sums correctly,
 *    and it is day P&L relabelled as skill. The tests below pin that the leg is
 *    renamed rather than merely recomputed.
 *  - An unmeasurable beta must never become 1, and a book where *no* beta is
 *    measurable must not report a market leg of zero. "The market contributed
 *    nothing" and "we could not tell what the market contributed" are opposite
 *    claims about the same book.
 *  - Costs are session-scoped or they are withheld. A block covering another
 *    UTC day is not a smaller version of the right answer, it is the same class
 *    of error as subtracting a lifetime fee total from one day's P&L.
 *
 * The reconciliation assertions are the cheap half: the residual is a plug, so
 * the legs sum to day P&L by construction and a failure there means a sign flew
 * the wrong way — which is exactly the bug that would otherwise make execution
 * cost look like a source of P&L.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECONCILIATION_TOLERANCE,
  type PnlLeg,
  type PnlWaterfall,
  buildPnlWaterfall,
  sessionReturn,
} from "../lib/pnl-attribution";
// One declaration of the wire shape, in the module that owns the payload. The
// attribution module imports it from here too; a fixture built against a second
// copy would keep compiling after the gateway changed and prove nothing.
import type { PortfolioPayload, SessionAttribution } from "../lib/portfolio";
import type { RiskPosition } from "../lib/portfolio-risk";

// --------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------

const SESSION_DATE = "2026-08-06";

const POSITIONS: RiskPosition[] = [
  { symbol: "BTCUSDT", signedNotional: 3_600_000 },
  { symbol: "ETHUSDT", signedNotional: 2_400_000 },
  { symbol: "SOLUSDT", signedNotional: 1_450_000 },
  { symbol: "BNBUSDT", signedNotional: -1_150_000 },
];

const BETAS = new Map<string, number | null>([
  ["BTCUSDT", 1],
  ["ETHUSDT", 1.2],
  ["SOLUSDT", 1.5],
  ["BNBUSDT", 0.9],
]);

const DAY_PNL = 142_500;
const REFERENCE_RETURN = 0.01;
/** 0.01 × (3.6m + 2.88m + 2.175m − 1.035m). Hand-computed so the test is not the code. */
const EXPECTED_MARKET = 76_200;

const AUDITED_SESSION: SessionAttribution = {
  session_date: SESSION_DATE,
  fills: 77,
  notional: 9_600_000,
  fees: 5_760,
  slippage_cost: 3_240,
  fills_without_slippage: 0,
  realized_pnl: 51_400,
  unrealized_pnl: 91_100,
  basis: "audited",
};

interface BookOptions {
  dayPnl?: number;
  sessionDate?: string;
  session?: SessionAttribution | Record<string, never> | undefined;
  sandbox?: boolean;
  realized?: number;
  unrealized?: number;
}

/**
 * A payload with every contract field filled, because the module reads the
 * equity block and the sandbox flag and must not be handed a shape the gateway
 * could never send.
 */
function makeBook(options: BookOptions = {}): PortfolioPayload {
  const dayPnl = options.dayPnl ?? DAY_PNL;
  const start = 10_000_000;
  const attribution: PortfolioPayload["attribution"] & { session?: unknown } = {
    by_strategy: [],
    by_symbol: [],
  };
  if (options.session !== undefined) attribution.session = options.session;

  const book: PortfolioPayload = {
    as_of: `${options.sessionDate ?? SESSION_DATE}T14:00:00Z`,
    session_date: options.sessionDate ?? SESSION_DATE,
    trading_halted: false,
    halted_symbols: [],
    equity: {
      current: start + dayPnl,
      start_of_day: start,
      daily_pnl: dayPnl,
      daily_return: dayPnl / start,
      realized_pnl: options.realized ?? 51_400,
      unrealized_pnl: options.unrealized ?? 91_100,
    },
    exposure: {
      gross: 8_600_000,
      net: 6_300_000,
      leverage: 0.86,
      positions: [],
    },
    concentration: {
      positions: POSITIONS.length,
      largest_symbol: "BTCUSDT",
      largest_share: 0.42,
      top_two_share: 0.7,
      hhi: 0.3,
      effective_positions: 3.3,
    },
    risk_budget: {
      gross_exposure: { used: 8_600_000, limit: 12_000_000, remaining: 3_400_000, utilisation: 0.72 },
      daily_drawdown: {
        used_pct: 0, limit_pct: 0.05, utilisation: 0,
        equity_at_halt: 9_500_000, cushion_usd: 642_500,
      },
      binding_constraint: ["gross_exposure", 0.72],
    },
    attribution,
    execution_quality: {},
  };

  if (options.sandbox) book.sandbox = true;
  return book;
}

function build(overrides: Partial<Parameters<typeof buildPnlWaterfall>[0]> = {}): PnlWaterfall {
  const result = buildPnlWaterfall({
    book: makeBook({ session: AUDITED_SESSION }),
    positions: POSITIONS,
    betaBySymbol: BETAS,
    referenceSymbol: "BTCUSDT",
    referenceReturn: REFERENCE_RETURN,
    ...overrides,
  });
  assert.ok(result, "the waterfall should build for a well-formed payload");
  return result;
}

function leg(waterfall: PnlWaterfall, key: PnlLeg["key"]): PnlLeg | undefined {
  return waterfall.legs.find((candidate) => candidate.key === key);
}

function required(waterfall: PnlWaterfall, key: PnlLeg["key"]): PnlLeg {
  const found = leg(waterfall, key);
  assert.ok(found, `expected a ${key} leg`);
  return found;
}

function sum(waterfall: PnlWaterfall): number {
  return waterfall.legs.reduce((acc, candidate) => acc + (candidate.value ?? 0), 0);
}

// --------------------------------------------------------------------------

describe("the happy path reconciles, and the costs point the right way", () => {
  it("splits day P&L into four legs that add back up to it", () => {
    const waterfall = build();
    assert.equal(waterfall.dayPnl, DAY_PNL);
    assert.equal(waterfall.legs.length, 4);
    assert.ok(
      Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE,
      `legs sum to ${sum(waterfall)}, not ${DAY_PNL}`,
    );
    assert.equal(waterfall.complete, true);
  });

  it("measures the market leg from signed notional × beta × the reference return", () => {
    const market = required(build(), "market");
    assert.equal(market.basis, "measured");
    assert.ok(market.value !== null);
    assert.ok(Math.abs(market.value - EXPECTED_MARKET) < 1e-6, `${market.value} !== ${EXPECTED_MARKET}`);
  });

  it("signs fees and slippage as costs, so a waterfall cannot draw them as gains", () => {
    const waterfall = build();
    assert.equal(required(waterfall, "fees").value, -5_760);
    assert.equal(required(waterfall, "slippage").value, -3_240);
    assert.equal(required(waterfall, "fees").basis, "audited");
    assert.equal(required(waterfall, "slippage").basis, "audited");
  });

  it("plugs the residual, and calls it a residual rather than alpha", () => {
    const residual = required(build(), "residual");
    assert.equal(residual.basis, "derived");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 5_760 + 3_240);
    // The leg may only mention alpha in order to disclaim it. Anything the UI
    // could read as a label — the key, the label itself — must not.
    assert.equal(residual.label, "Residual");
    assert.match(residual.note, /not alpha/i);
    for (const candidate of build().legs) {
      assert.ok(!/alpha/i.test(candidate.label), `${candidate.key} is labelled with "alpha"`);
    }
  });

  it("reports carried mark-to-market as the gap day P&L leaves over the session's own P&L", () => {
    // Realised + unrealised here is exactly day P&L, so the carry is zero — the
    // single-session case. It is the *field* being derived rather than assumed
    // that matters; a multi-day book legitimately carries a non-zero number.
    const waterfall = build({ book: makeBook({ session: AUDITED_SESSION, realized: 51_400, unrealized: 91_100 }) });
    assert.equal(waterfall.carriedMarkToMarket, 0);

    const carried = build({
      book: makeBook({ session: AUDITED_SESSION, realized: 20_000, unrealized: 40_000 }),
    });
    assert.equal(carried.carriedMarkToMarket, DAY_PNL - 60_000);
  });
});

describe("no reference return withholds the residual as well as the market leg", () => {
  const waterfall = build({ referenceReturn: null });

  it("withholds the market leg rather than reporting zero", () => {
    const market = required(waterfall, "market");
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.match(market.note, /could not be measured/i);
  });

  it("replaces the residual with a single leg named Unattributed", () => {
    assert.equal(leg(waterfall, "residual"), undefined);
    const unattributed = required(waterfall, "unattributed");
    assert.equal(unattributed.label, "Unattributed");
    assert.equal(unattributed.basis, "derived");
    // Day P&L less the costs that *were* measured, and nothing else.
    assert.equal(unattributed.value, DAY_PNL + 5_760 + 3_240);
    assert.equal(
      waterfall.legs.filter((candidate) => candidate.key === "unattributed").length,
      1,
    );
  });

  it("is not complete, even though the arithmetic still adds up", () => {
    assert.equal(waterfall.complete, false);
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("drops the reference symbol along with the move it would have applied", () => {
    // This used to assert the symbol survived, on the reasoning that reporting
    // what *would* have been used is informative. It is not, to the only reader
    // there is: `PnlWaterfall.tsx` gates its closing paragraph on the pair, so a
    // symbol with no move beside it renders "the market leg uses BTCUSDT at …,
    // applied through each position's measured beta" for a leg that was
    // withheld. The symbol is still named in the leg's own note, which is where
    // it explains an absence instead of implying a measurement.
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(waterfall.referenceReturn, null);
    const market = waterfall.legs.find((leg) => leg.key === "market");
    assert.ok(market?.note.includes("BTCUSDT"), "the note still has to say which reference failed");
  });

  it("names nothing in unmeasuredSymbols, because no leg excluded anything", () => {
    // The field means "excluded from a market leg that exists". With no market
    // leg, listing symbols would imply the leg is merely understated.
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });
});

describe("unmeasurable betas understate the market leg instead of inventing one", () => {
  const partial = new Map(BETAS);
  partial.set("SOLUSDT", null);
  const waterfall = build({ betaBySymbol: partial });

  it("names the excluded symbols", () => {
    assert.deepEqual(waterfall.unmeasuredSymbols, ["SOLUSDT"]);
  });

  it("computes the market leg over the measurable positions only", () => {
    const market = required(waterfall, "market");
    // 0.01 × (3.6m + 2.88m − 1.035m); SOL's 2.175m of beta-adjusted exposure is gone.
    assert.equal(market.value, 54_450);
    assert.ok(market.value! < EXPECTED_MARKET, "an excluded position must understate, not inflate");
    assert.match(market.note, /understated/);
    assert.match(market.note, /SOLUSDT/);
  });

  it("still reconciles, because the residual absorbs the excluded exposure", () => {
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
    const residual = required(waterfall, "residual");
    const full = required(build(), "residual");
    assert.ok(residual.value! > full.value!, "the residual must grow by what the market leg lost");
  });

  it("treats a symbol missing from the beta map exactly like a null beta", () => {
    const missing = new Map(BETAS);
    missing.delete("BNBUSDT");
    assert.deepEqual(build({ betaBySymbol: missing }).unmeasuredSymbols, ["BNBUSDT"]);
  });

  it("withholds the market leg entirely when not one position is measurable", () => {
    const none = new Map<string, number | null>(POSITIONS.map((p) => [p.symbol, null]));
    const blind = build({ betaBySymbol: none });
    const market = required(blind, "market");
    // Zero here would read as "the market contributed nothing", which is a
    // different claim from "nothing could be measured".
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.equal(leg(blind, "residual"), undefined);
    assert.equal(required(blind, "unattributed").value, DAY_PNL + 5_760 + 3_240);
  });

  it("reports a genuine zero for a book that holds nothing", () => {
    const flat = build({ positions: [], betaBySymbol: new Map() });
    const market = required(flat, "market");
    assert.equal(market.value, 0);
    assert.equal(market.basis, "measured");
    assert.deepEqual(flat.unmeasuredSymbols, []);
    assert.equal(flat.complete, true);
  });
});

describe("an absent session block degrades rather than breaking", () => {
  it("withholds both cost legs and says why, when the key is missing entirely", () => {
    const waterfall = build({ book: makeBook() });
    const fees = required(waterfall, "fees");
    const slippage = required(waterfall, "slippage");
    assert.equal(fees.value, null);
    assert.equal(slippage.value, null);
    assert.equal(fees.basis, "withheld");
    assert.equal(slippage.basis, "withheld");
    assert.match(fees.note, /lifetime/i);
    assert.equal(waterfall.complete, false);
  });

  it("lets the residual absorb them, and says so in the note", () => {
    const waterfall = build({ book: makeBook() });
    const residual = required(waterfall, "residual");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET);
    assert.match(residual.note, /absorbing the withheld fee and slippage legs/i);
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("treats the empty block a gateway with no audit log sends as absent", () => {
    // `session_attribution` returns a bare `{}` when `audit is None`. Reading
    // that as "zero fees this session" would be a fabricated measurement.
    const waterfall = build({ book: makeBook({ session: {} }) });
    assert.equal(required(waterfall, "fees").value, null);
    assert.equal(required(waterfall, "slippage").value, null);
  });

  it("withholds costs from a block covering a different UTC session", () => {
    // A restarted or stale gateway carries a session_date that is not the
    // book's. Those costs are real and they belong to another day.
    const stale = build({
      book: makeBook({ session: { ...AUDITED_SESSION, session_date: "2026-08-05" } }),
    });
    assert.equal(required(stale, "fees").value, null);
    assert.match(required(stale, "fees").note, /2026-08-05/);
    assert.match(required(stale, "fees").note, /different day/i);
  });

  it("withholds costs when the book and the block disagree about being generated", () => {
    const live = build({ book: makeBook({ session: { ...AUDITED_SESSION, basis: "generated" } }) });
    assert.equal(required(live, "slippage").value, null);
    assert.match(required(live, "slippage").note, /contradiction/i);
  });
});

describe("an unmeasured fill makes the slippage leg a lower bound", () => {
  const waterfall = build({
    book: makeBook({ session: { ...AUDITED_SESSION, fills: 77, fills_without_slippage: 4 } }),
  });

  it("flags it on the waterfall", () => {
    assert.equal(waterfall.slippageIsLowerBound, true);
  });

  it("names the count in the leg's own note", () => {
    const slippage = required(waterfall, "slippage");
    assert.match(slippage.note, /lower\s+bound/i);
    assert.match(slippage.note, /4 of 77/);
    // Still a number: a lower bound is a measurement, not a withholding.
    assert.equal(slippage.value, -3_240);
  });

  it("is false when every fill carried a measured slippage", () => {
    assert.equal(build().slippageIsLowerBound, false);
  });

  it("is false when there is no slippage leg to bound", () => {
    assert.equal(build({ book: makeBook() }).slippageIsLowerBound, false);
  });
});

describe("a session nobody could measure is not a session that cost nothing", () => {
  /**
   * Every fill in the session has `slippage_bps IS NULL`.
   *
   * `session_costs` computes `sum(COALESCE(notional,0) * COALESCE(slippage_bps,0))`,
   * so this block is what the gateway *actually emits* for that session:
   * `slippage_cost` is 0.0 because the sum ran over nothing, and
   * `fills_without_slippage` equals `fills` because nothing was measured. The
   * state is reachable through `_maker_fill`, which writes the NULL whenever
   * there is no mark — one mark outage across a maker-filled session is enough.
   */
  const ALL_NULL: SessionAttribution = {
    ...AUDITED_SESSION, fills: 77, fills_without_slippage: 77, slippage_cost: 0,
  };
  /** The same shape, from a session where slippage *was* measured at zero. */
  const GENUINELY_FREE: SessionAttribution = {
    ...AUDITED_SESSION, fills: 77, fills_without_slippage: 0, slippage_cost: 0,
  };

  const blind = build({ book: makeBook({ session: ALL_NULL }) });
  const free = build({ book: makeBook({ session: GENUINELY_FREE }) });

  it("withholds the slippage leg rather than reporting the sum over nothing", () => {
    const slippage = required(blind, "slippage");
    assert.equal(slippage.value, null);
    assert.equal(slippage.basis, "withheld");
    assert.equal(blind.complete, false);
    assert.match(slippage.note, /sum over nothing/i);
    assert.match(slippage.note, /77/);
  });

  it("does not call it a lower bound, because there is no measurement to bound", () => {
    // A lower bound says "at least this much"; with nothing measured there is no
    // floor to stand on, and the flag would tell the panel to print a caveat
    // about a leg it is not drawing.
    assert.equal(blind.slippageIsLowerBound, false);
  });

  it("renders differently from a session that genuinely cost nothing", () => {
    const measured = required(free, "slippage");
    const withheld = required(blind, "slippage");
    // The whole finding in one assertion: these two sessions are opposite
    // claims, and every field a renderer keys off has to disagree.
    assert.notDeepEqual(
      [withheld.value, withheld.basis, withheld.note],
      [measured.value, measured.basis, measured.note],
    );
    assert.equal(measured.value, 0);
    assert.equal(measured.basis, "audited");
    assert.equal(free.complete, true);
    assert.equal(blind.complete, false);
  });

  it("hands the unmeasured cost to the residual, and blames only slippage", () => {
    const residual = required(blind, "residual");
    // Fees were measured and subtracted; only slippage is missing from the plug.
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 5_760);
    assert.match(residual.note, /withheld slippage leg/i);
    assert.doesNotMatch(residual.note, /fee and slippage/i);
    assert.ok(Math.abs(sum(blind) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("withholds when the block counts more unmeasured fills than fills", () => {
    // A block that contradicts itself this way still cannot support a slippage
    // figure: there is no fill left that carried one.
    const contradictory = build({
      book: makeBook({ session: { ...AUDITED_SESSION, fills: 4, fills_without_slippage: 9 } }),
    });
    assert.equal(required(contradictory, "slippage").value, null);
    assert.equal(contradictory.slippageIsLowerBound, false);
  });
});

describe("the fill counts are read as a pair, never as a ratio the block never stated", () => {
  it("drops the denominator when the block states no fill count", () => {
    // `fills` and `fills_without_slippage` default independently, so a block can
    // report unmeasured fills without reporting any fills at all — and the note
    // then renders the impossible "4 of 0 fills".
    for (const fills of [undefined, 0]) {
      const waterfall = build({
        book: makeBook({ session: { ...AUDITED_SESSION, fills, fills_without_slippage: 4 } }),
      });
      const slippage = required(waterfall, "slippage");
      assert.doesNotMatch(slippage.note, /of 0 fills/);
      assert.match(slippage.note, /4 fills carry no measured slippage/);
      assert.match(slippage.note, /lower\s+bound/i);
      // Still a measurement: at least four fills went unmeasured, so the figure
      // is a floor. It is the *ratio* that is unavailable, not the direction.
      assert.equal(slippage.value, -3_240);
      assert.equal(waterfall.slippageIsLowerBound, true);
    }
  });

  it("keeps the denominator when the block does state one", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, fills: 77, fills_without_slippage: 4 } }),
    });
    assert.match(required(waterfall, "slippage").note, /4 of 77 fills/);
  });
});

describe("unmeasuredSymbols means excluded from a market leg that exists", () => {
  const none = new Map<string, number | null>(POSITIONS.map((p) => [p.symbol, null]));

  it("is empty on every path that withholds the market leg", () => {
    // The field's contract, and the sentence the panel prints from it: "the
    // market leg excludes them and is understated by whatever they moved".
    // Neither is true of a leg that does not exist.
    const withheldMarket = [
      build({ betaBySymbol: none }),
      build({ referenceReturn: null }),
      build({ book: makeBook({ sandbox: true }), referenceReturn: 0.05 }),
    ];
    for (const waterfall of withheldMarket) {
      assert.equal(required(waterfall, "market").value, null);
      assert.deepEqual(waterfall.unmeasuredSymbols, []);
    }
  });

  it("keeps the names in the withheld leg's own note instead", () => {
    // Dropping them from the field must not drop them from the output: the
    // reason the leg is missing is still the symbols that could not be measured.
    const note = required(build({ betaBySymbol: none }), "market").note;
    for (const position of POSITIONS) assert.match(note, new RegExp(position.symbol));
  });

  it("is non-empty exactly when the market leg is a number that excluded something", () => {
    const partial = new Map(BETAS);
    partial.set("SOLUSDT", null);
    for (const waterfall of [build(), build({ betaBySymbol: partial }), build({ betaBySymbol: none })]) {
      const market = required(waterfall, "market");
      assert.equal(
        waterfall.unmeasuredSymbols.length > 0,
        market.value !== null && /understated/.test(market.note),
        `unmeasuredSymbols disagrees with the ${market.basis} market leg it describes`,
      );
    }
  });
});

describe("the residual names the cost legs it is actually carrying", () => {
  it("blames slippage alone when fees were measured and subtracted", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
    });
    // The fee leg is a number and is already out of the plug. Telling a reader
    // the residual absorbs it invites them to subtract it a second time.
    assert.equal(required(waterfall, "fees").value, -5_760);
    const residual = required(waterfall, "residual");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 5_760);
    assert.match(residual.note, /absorbing the withheld slippage leg, which is inside day P&L/i);
    assert.doesNotMatch(residual.note, /fee/i);
  });

  it("blames fees alone when slippage was measured and subtracted", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, fees: undefined } }),
    });
    assert.equal(required(waterfall, "slippage").value, -3_240);
    const residual = required(waterfall, "residual");
    assert.equal(residual.value, DAY_PNL - EXPECTED_MARKET + 3_240);
    assert.match(residual.note, /absorbing the withheld fee leg, which is inside day P&L/i);
    assert.doesNotMatch(residual.note, /slippage/i);
  });

  it("names both, in the plural, only when both are withheld", () => {
    const residual = required(build({ book: makeBook() }), "residual");
    assert.match(residual.note, /withheld fee and slippage legs, which are inside day P&L/i);
  });

  it("says nothing about withheld costs when both were measured", () => {
    assert.doesNotMatch(required(build(), "residual").note, /withheld/i);
  });

  it("applies the same rule to the unattributed leg", () => {
    const one = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
      referenceReturn: null,
    });
    assert.match(required(one, "unattributed").note, /absorbs the withheld slippage leg\./i);
    assert.doesNotMatch(required(one, "unattributed").note, /fee/i);

    const both = build({ book: makeBook(), referenceReturn: null });
    assert.match(required(both, "unattributed").note, /absorbs the withheld fee and slippage legs\./i);

    assert.doesNotMatch(
      required(build({ referenceReturn: null }), "unattributed").note,
      /withheld/i,
    );
  });
});

describe("an undated block does not get to borrow the book's session date", () => {
  it("refuses to assert a session the block never claimed", () => {
    for (const session_date of [undefined, ""]) {
      const waterfall = build({
        book: makeBook({ session: { ...AUDITED_SESSION, session_date } }),
      });
      for (const key of ["fees", "slippage"] as const) {
        const note = required(waterfall, key).note;
        // `readSession` only rejects a date that *disagrees* with the book's, so
        // an undated block is accepted — but its silence is not agreement, and
        // the note must not put the book's date in the block's mouth.
        assert.doesNotMatch(note, /for session 2026-08-06/);
        assert.match(note, /names no session date/i);
        assert.match(note, /2026-08-06/, "the date it could not be checked against is still named");
      }
      // The costs are still measured — an unnamed day is a weaker claim, not a
      // wrong one, and withholding here would discard real audited figures.
      assert.equal(required(waterfall, "fees").value, -5_760);
    }
  });

  it("still names the session when the block names it", () => {
    const note = required(build(), "fees").note;
    assert.match(note, /for session 2026-08-06/);
    assert.doesNotMatch(note, /names no session date/i);
  });

  it("makes no date claim at all for a generated block", () => {
    const waterfall = build({
      book: makeBook({
        sandbox: true,
        session: { ...AUDITED_SESSION, basis: "generated", session_date: undefined },
      }),
    });
    assert.doesNotMatch(required(waterfall, "fees").note, /session date/i);
  });
});

describe("no figure this module emits is IEEE −0", () => {
  /** What `session_attribution` sends for a session with no fills at all. */
  const NO_FILLS: SessionAttribution = {
    session_date: SESSION_DATE,
    fills: 0, notional: 0, fees: 0, slippage_cost: 0, fills_without_slippage: 0,
    realized_pnl: 0, unrealized_pnl: 0, basis: "audited",
  };

  /**
   * −0 is not cosmetic here. The shipped panel classes a leg with
   * `value >= 0 ? "pos" : "neg"` and formats it with `usd`, so −0 prints "$-0"
   * in the *gain* colour, while the chart label on the same leg prints "+$0"
   * because `-0 < 0` is false. One panel, one number, two signs.
   */
  const books: Array<[string, PnlWaterfall]> = [
    ["a session with no fills", build({ book: makeBook({ session: NO_FILLS }) })],
    [
      "a flat book on a flat day",
      build({ book: makeBook({ dayPnl: 0, session: NO_FILLS }), positions: [], betaBySymbol: new Map() }),
    ],
    [
      // `round(-0.001, 2)` in the gateway is a literal -0.0, and `JSON.parse`
      // preserves it — so day P&L itself arrives negative-zero.
      "a day P&L that rounded to −0",
      build({ book: makeBook({ dayPnl: -0, session: NO_FILLS }), positions: [], betaBySymbol: new Map() }),
    ],
    [
      "a generated block supplying a −0 market leg",
      build({
        book: makeBook({
          sandbox: true,
          session: { ...NO_FILLS, basis: "generated", market_pnl: -0, reference_symbol: "BTCUSDT", reference_return: 0 },
        }),
      }),
    ],
  ];

  for (const [name, waterfall] of books) {
    it(`keeps every leg of ${name} at +0`, () => {
      for (const candidate of waterfall.legs) {
        assert.equal(
          Object.is(candidate.value, -0), false,
          `${candidate.key} carries −0, which renders as "$-0" in the gain colour`,
        );
      }
    });

    it(`keeps every scalar of ${name} at +0`, () => {
      for (const [field, value] of Object.entries({
        dayPnl: waterfall.dayPnl,
        startEquity: waterfall.startEquity,
        endEquity: waterfall.endEquity,
        carriedMarkToMarket: waterfall.carriedMarkToMarket,
      })) {
        assert.equal(Object.is(value, -0), false, `${field} carries −0`);
      }
    });
  }

  it("still reports the cost legs as measured zeros, not as withheld", () => {
    // The normalisation must not become its own fabrication: a measured zero is
    // a number and has to keep saying so.
    const waterfall = build({ book: makeBook({ session: NO_FILLS }) });
    for (const key of ["fees", "slippage"] as const) {
      const cost = required(waterfall, key);
      assert.equal(cost.value, 0);
      assert.equal(cost.basis, "audited");
    }
  });
});

describe("branches that only fire on a gateway sending less than it used to", () => {
  it("withholds the slippage leg when the block carries no slippage figure at all", () => {
    const waterfall = build({
      book: makeBook({ session: { ...AUDITED_SESSION, slippage_cost: undefined } }),
    });
    const slippage = required(waterfall, "slippage");
    assert.equal(slippage.value, null);
    assert.equal(slippage.basis, "withheld");
    assert.match(slippage.note, /carries no slippage figure/i);
    assert.equal(waterfall.complete, false);
  });

  it("withholds the fee leg when the block carries no fee total", () => {
    const waterfall = build({ book: makeBook({ session: { ...AUDITED_SESSION, fees: undefined } }) });
    const fees = required(waterfall, "fees");
    assert.equal(fees.value, null);
    assert.equal(fees.basis, "withheld");
    assert.match(fees.note, /no fee total/i);
  });

  it("withholds the sandbox's market leg when its own block supplies none", () => {
    // A generated book with no generated market leg: measuring one against real
    // prices would attribute a synthetic P&L to a real market move.
    const waterfall = build({
      book: makeBook({
        sandbox: true,
        session: { ...AUDITED_SESSION, basis: "generated", market_pnl: undefined },
      }),
      referenceReturn: 0.05,
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, null);
    assert.equal(market.basis, "withheld");
    assert.match(market.note, /supplies no market leg/i);
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
    // The cost legs are still readable — only the market leg is unavailable.
    assert.equal(required(waterfall, "fees").value, -5_760);
    assert.equal(required(waterfall, "unattributed").value, DAY_PNL + 5_760 + 3_240);
  });

  it("declines to state a reference move the generated block never stated", () => {
    const waterfall = build({
      book: makeBook({
        sandbox: true,
        session: {
          ...AUDITED_SESSION, basis: "generated", market_pnl: 61_000,
          reference_symbol: undefined, reference_return: undefined,
        },
      }),
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, 61_000);
    assert.match(market.note, /an unstated size/i);
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(waterfall.referenceReturn, null);
  });

  it("reports carried mark-to-market as null when the equity block cannot support it", () => {
    // Absent and zero are different claims here too: zero says the book carries
    // nothing in from earlier sessions, which is a statement about its history.
    const broken = makeBook({ session: AUDITED_SESSION });
    (broken.equity as { realized_pnl: unknown }).realized_pnl = null;
    assert.equal(build({ book: broken }).carriedMarkToMarket, null);

    const noUnrealized = makeBook({ session: AUDITED_SESSION });
    (noUnrealized.equity as { unrealized_pnl: number }).unrealized_pnl = Number.NaN;
    assert.equal(build({ book: noUnrealized }).carriedMarkToMarket, null);
  });
});

describe("the sandbox attributes only what it generated", () => {
  const generated: SessionAttribution = {
    session_date: SESSION_DATE,
    fills: 81,
    fees: 5_760,
    slippage_cost: 3_240,
    fills_without_slippage: 0,
    basis: "generated",
    market_pnl: 61_000,
    reference_symbol: "BTCUSDT",
    reference_return: 0.008,
  };

  it("reads the supplied market leg instead of running the beta path", () => {
    const waterfall = build({
      book: makeBook({ sandbox: true, session: generated }),
      // Deliberately supplies a real measured return that would produce a very
      // different leg. It must be ignored: attributing part of a generated P&L
      // to a real market move is a fabricated attribution, and it would also
      // move the number between a server render and a client hydrate.
      referenceReturn: 0.05,
    });
    const market = required(waterfall, "market");
    assert.equal(market.value, 61_000);
    assert.equal(market.basis, "generated");
    assert.equal(waterfall.referenceReturn, 0.008);
    assert.equal(waterfall.referenceSymbol, "BTCUSDT");
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });

  it("labels its cost legs generated, never audited", () => {
    const waterfall = build({ book: makeBook({ sandbox: true, session: generated }) });
    assert.equal(required(waterfall, "fees").basis, "generated");
    assert.equal(required(waterfall, "slippage").basis, "generated");
    assert.equal(waterfall.complete, true);
    assert.ok(Math.abs(sum(waterfall) - DAY_PNL) <= RECONCILIATION_TOLERANCE);
  });

  it("withholds everything when a sandbox book carries no generated block", () => {
    const waterfall = build({ book: makeBook({ sandbox: true }), referenceReturn: 0.05 });
    assert.equal(required(waterfall, "market").value, null);
    assert.equal(required(waterfall, "fees").value, null);
    assert.equal(waterfall.referenceSymbol, null);
    assert.equal(required(waterfall, "unattributed").value, DAY_PNL);
  });

  it("refuses a sandbox book whose block claims audited fills", () => {
    const waterfall = build({ book: makeBook({ sandbox: true, session: AUDITED_SESSION }) });
    assert.equal(required(waterfall, "fees").value, null);
    assert.equal(required(waterfall, "market").value, null);
  });
});

describe("degenerate numbers stay numbers", () => {
  it("survives a flat session without dividing by day P&L", () => {
    const waterfall = build({ book: makeBook({ dayPnl: 0, session: AUDITED_SESSION }) });
    assert.equal(waterfall.dayPnl, 0);
    for (const candidate of waterfall.legs) {
      assert.ok(candidate.value === null || Number.isFinite(candidate.value), `${candidate.key} is not finite`);
    }
    assert.equal(required(waterfall, "residual").value, -EXPECTED_MARKET + 9_000);
    assert.ok(Math.abs(sum(waterfall)) <= RECONCILIATION_TOLERANCE);
    assert.equal(waterfall.complete, true);
  });

  it("never substitutes 0 for a withheld leg, in any withholding path", () => {
    const withheld: PnlLeg[] = [
      ...build({ referenceReturn: null }).legs,
      ...build({ book: makeBook() }).legs,
      ...build({ book: makeBook({ sandbox: true }) }).legs,
      ...build({ betaBySymbol: new Map() }).legs,
    ].filter((candidate) => candidate.basis === "withheld");

    assert.ok(withheld.length >= 6, "expected several withheld legs across these paths");
    for (const candidate of withheld) {
      assert.equal(candidate.value, null, `${candidate.key} was withheld but carries a value`);
      assert.ok(candidate.note.length > 0, `${candidate.key} was withheld without saying why`);
    }
  });

  it("returns null rather than a half-real waterfall on a broken equity block", () => {
    const broken = makeBook({ session: AUDITED_SESSION });
    (broken.equity as { daily_pnl: number }).daily_pnl = Number.NaN;
    assert.equal(
      buildPnlWaterfall({
        book: broken,
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
      null,
    );
  });

  it("ignores a position whose notional is not a number", () => {
    const waterfall = build({
      positions: [...POSITIONS, { symbol: "XRPUSDT", signedNotional: Number.NaN }],
      betaBySymbol: new Map(BETAS).set("XRPUSDT", 1.1),
    });
    assert.equal(required(waterfall, "market").value, EXPECTED_MARKET);
    assert.deepEqual(waterfall.unmeasuredSymbols, []);
  });
});

describe("sessionReturn refuses to attribute across a session boundary", () => {
  const open = Date.parse(`${SESSION_DATE}T00:00:00Z`);

  it("returns the bar's return when its UTC date is the book's session", () => {
    const r = sessionReturn({ openMs: open, prevClose: 100, close: 102 }, SESSION_DATE);
    assert.ok(r !== null);
    assert.ok(Math.abs(r - 0.02) < 1e-12);
  });

  it("returns null when the bar is a different UTC day", () => {
    // The gateway rolls its session at UTC midnight; a restarted or stale one
    // carries a session_date that is not today's, and the newest kline then
    // measures a different window from the P&L being decomposed.
    assert.equal(
      sessionReturn({ openMs: Date.parse("2026-08-05T00:00:00Z"), prevClose: 100, close: 102 }, SESSION_DATE),
      null,
    );
    assert.equal(
      sessionReturn({ openMs: Date.parse("2026-08-07T00:00:00Z"), prevClose: 100, close: 102 }, SESSION_DATE),
      null,
    );
  });

  it("returns null for a missing bar", () => {
    assert.equal(sessionReturn(undefined, SESSION_DATE), null);
  });

  it("returns null when the previous close cannot produce a return", () => {
    assert.equal(sessionReturn({ openMs: open, prevClose: 0, close: 102 }, SESSION_DATE), null);
    assert.equal(sessionReturn({ openMs: open, prevClose: -100, close: 102 }, SESSION_DATE), null);
    assert.equal(sessionReturn({ openMs: open, prevClose: Number.NaN, close: 102 }, SESSION_DATE), null);
    assert.equal(sessionReturn({ openMs: open, prevClose: 100, close: Number.NaN }, SESSION_DATE), null);
  });

  it("returns null for an unusable timestamp rather than throwing", () => {
    assert.equal(sessionReturn({ openMs: Number.NaN, prevClose: 100, close: 102 }, SESSION_DATE), null);
    assert.equal(sessionReturn({ openMs: 1e18, prevClose: 100, close: 102 }, SESSION_DATE), null);
  });

  it("returns null for an empty session date", () => {
    assert.equal(sessionReturn({ openMs: open, prevClose: 100, close: 102 }, ""), null);
  });

  it("feeds buildPnlWaterfall's withholding directly", () => {
    // The composition the caller performs: a mismatched bar yields null, which
    // is exactly the input that withholds the market leg and the residual.
    const stale = sessionReturn(
      { openMs: Date.parse("2026-08-05T00:00:00Z"), prevClose: 100, close: 102 },
      SESSION_DATE,
    );
    const waterfall = build({ referenceReturn: stale });
    assert.equal(required(waterfall, "market").value, null);
    assert.ok(leg(waterfall, "unattributed"));
  });
});

// --------------------------------------------------------------------------
// The reference pair, and negative zero
//
// Two defects that survived an earlier pass because the tests around them
// asserted the leg values and not the scalars beside them. Both reach a reader:
// the panel gates its closing paragraph on the reference pair, and renders any
// leg value straight into a signed cell.
// --------------------------------------------------------------------------

describe("a withheld market leg takes its reference pair with it", () => {
  /** Every path that withholds the market leg, so none can drift from the others. */
  const withheldPaths: Array<{ name: string; build: () => PnlWaterfall | null }> = [
    {
      name: "no reference return",
      build: () => buildPnlWaterfall({
        book: makeBook({ session: AUDITED_SESSION }),
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: null,
      }),
    },
    {
      name: "no measurable beta on any holding",
      build: () => buildPnlWaterfall({
        book: makeBook({ session: AUDITED_SESSION }),
        positions: POSITIONS,
        betaBySymbol: new Map(POSITIONS.map((p) => [p.symbol, null])),
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
    },
    {
      name: "sandbox block supplying no market leg",
      build: () => buildPnlWaterfall({
        book: makeBook({
          sandbox: true,
          session: { ...AUDITED_SESSION, basis: "generated", market_pnl: undefined },
        }),
        positions: POSITIONS,
        betaBySymbol: BETAS,
        referenceSymbol: "BTCUSDT",
        referenceReturn: REFERENCE_RETURN,
      }),
    },
  ];

  for (const path of withheldPaths) {
    it(`nulls referenceSymbol and referenceReturn when the leg is withheld — ${path.name}`, () => {
      const waterfall = path.build();
      assert.ok(waterfall);
      const market = waterfall.legs.find((leg) => leg.key === "market");
      // Either the leg is withheld or it is absent entirely; both mean there is
      // no beta attribution for the panel's closing paragraph to describe.
      assert.ok(market === undefined || market.value === null, path.name);
      assert.equal(waterfall.referenceSymbol, null, `${path.name}: referenceSymbol survived`);
      assert.equal(waterfall.referenceReturn, null, `${path.name}: referenceReturn survived`);
      assert.deepEqual(waterfall.unmeasuredSymbols, [], `${path.name}: unmeasuredSymbols survived`);
    });
  }

  it("keeps the pair when the leg really was measured", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: AUDITED_SESSION }),
      positions: POSITIONS,
      betaBySymbol: BETAS,
      referenceSymbol: "BTCUSDT",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    assert.equal(waterfall.referenceSymbol, "BTCUSDT");
    assert.equal(waterfall.referenceReturn, REFERENCE_RETURN);
  });
});

describe("no number the panel renders is a negative zero", () => {
  /**
   * The panel colours a leg by `value >= 0` and prints it with a sign, so a
   * `-0` renders as "$-0" in the gain colour — a cost shown as a signed-negative
   * gain, next to a "+$0" for the same figure elsewhere in the same card.
   *
   * Asserted per field rather than by mutating the helper wholesale: removing
   * the guard from one call site is exactly the regression that survived last
   * time, and a single blanket check cannot see it.
   */
  function everyScalar(waterfall: PnlWaterfall): Array<[string, number | null]> {
    return [
      ["dayPnl", waterfall.dayPnl],
      ["startEquity", waterfall.startEquity],
      ["endEquity", waterfall.endEquity],
      ["carriedMarkToMarket", waterfall.carriedMarkToMarket],
      ["referenceReturn", waterfall.referenceReturn],
      ...waterfall.legs.map((leg): [string, number | null] => [`leg:${leg.key}`, leg.value]),
    ];
  }

  const zeroCost: SessionAttribution = {
    ...AUDITED_SESSION, fills: 0, fees: 0, slippage_cost: 0, fills_without_slippage: 0,
  };

  it("holds on a session that genuinely cost nothing", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: zeroCost }),
      positions: POSITIONS,
      betaBySymbol: BETAS,
      referenceSymbol: "BTCUSDT",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    for (const [name, value] of everyScalar(waterfall)) {
      assert.ok(!Object.is(value, -0), `${name} is negative zero`);
    }
  });

  it("holds on a flat book with a zero day", () => {
    const waterfall = buildPnlWaterfall({
      book: makeBook({ dayPnl: 0, realized: 0, unrealized: 0, session: zeroCost }),
      positions: [],
      betaBySymbol: new Map(),
      referenceSymbol: "BTCUSDT",
      referenceReturn: 0,
    });
    assert.ok(waterfall);
    for (const [name, value] of everyScalar(waterfall)) {
      assert.ok(!Object.is(value, -0), `${name} is negative zero`);
    }
  });

  it("holds when the market leg itself lands on zero", () => {
    // Equal and opposite exposures at the same beta: the leg is measured, and
    // measured at exactly zero, which must stay distinguishable from withheld.
    const flatBook: RiskPosition[] = [
      { symbol: "AAA", signedNotional: 1_000_000 },
      { symbol: "BBB", signedNotional: -1_000_000 },
    ];
    const waterfall = buildPnlWaterfall({
      book: makeBook({ session: zeroCost }),
      positions: flatBook,
      betaBySymbol: new Map([["AAA", 1], ["BBB", 1]]),
      referenceSymbol: "AAA",
      referenceReturn: REFERENCE_RETURN,
    });
    assert.ok(waterfall);
    const market = waterfall.legs.find((leg) => leg.key === "market");
    assert.ok(market);
    assert.equal(market.value, 0);
    assert.ok(!Object.is(market.value, -0), "a measured zero must not be a negative zero");
    assert.notEqual(market.basis, "withheld", "measured at zero is not the same as unmeasurable");
  });
});
