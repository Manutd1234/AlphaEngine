/**
 * Costs and returns are scoped to the book's own UTC session, or withheld.
 *
 * A block covering another UTC day is not a smaller version of the right
 * answer, it is the same class of error as subtracting a lifetime fee total
 * from one day's P&L — and a restarted or stale gateway produces exactly that,
 * with a `session_date` that is not the book's. The same boundary governs the
 * reference return: `sessionReturn` refuses a kline whose UTC date is not the
 * session being decomposed, and its null is the input that withholds the market
 * leg downstream.
 *
 * The rest of this suite is about what a session block is allowed to be read as
 * saying. The gateway sends a bare `{}` when it has no audit log, sums
 * `slippage_bps` over fills that may all be NULL, and defaults its two fill
 * counts independently. Each of those produces a plausible zero:
 *
 *  - `{}` is not "zero fees this session".
 *  - `slippage_cost: 0` with `fills_without_slippage == fills` is a sum over
 *    nothing, not a session that cost nothing — and it is not a lower bound
 *    either, because there is no measurement to bound.
 *  - `fills_without_slippage: 4` with no `fills` is "4 fills carry no measured
 *    slippage", never the impossible "4 of 0 fills".
 *  - An undated block's silence is not agreement with the book's date.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECONCILIATION_TOLERANCE,
  sessionReturn,
} from "../lib/pnl-attribution";
import type { SessionAttribution } from "../lib/portfolio";
import {
  AUDITED_SESSION,
  build,
  DAY_PNL,
  EXPECTED_MARKET,
  leg,
  makeBook,
  required,
  SESSION_DATE,
  sum,
} from "./helpers/pnl-attribution-fixtures";

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
