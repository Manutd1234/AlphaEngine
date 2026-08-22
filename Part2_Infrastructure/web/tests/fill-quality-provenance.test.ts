/**
 * Where a fill-quality figure came from, and why the page may not stay quiet
 * about it.
 *
 * WHAT WAS MEASURED, before any of this was written. Against the running
 * gateway on 2026-08-22, `/api/gateway/audit?feed=orders&limit=200` returned 14
 * rows whose union of keys is exactly:
 *
 *   accepted, checks_json, client_order_id, decided_at, fee_usd, fill_price,
 *   fill_qty, latency_ms, notional, order_id, order_type, quantity, reason,
 *   rejected_by, side, slippage_bps, source, status, strategy, symbol,
 *   time_in_force, ts, venue
 *
 * There is no `simulated` in that list, and there cannot be: `modules/audit/
 * schema.py` declares no such column on `orders` and `recent_orders` selects
 * the columns by name. The flag DOES exist — `modules/schemas_trading.py` has
 * `Fill.simulated: bool = True`, every one of the three `Fill(...)` sites in
 * `modules/risk_proxy/execution.py` sets it, and it survives into
 * `lib/gateway-contract.generated.ts` — but only on the order-ticket decision
 * response, which is a different path from the blotter feed.
 *
 * So the honest state of this field on the blotter is `null`, on every row,
 * today. That is the case these tests care most about. A parser written as
 * `row.simulated === true` would turn "the gateway never said" into "the
 * gateway said no", and the whole point of carrying the field is to stop a
 * simulator's constant from being read as a venue's measured cost.
 *
 * The second half of the suite is the part that does not depend on the gateway
 * ever growing that column. Fee and slippage on the paper path are settings —
 * `notional * settings.paper_fee_bps / 1e4`, and for equities
 * `slippage_bps = settings.paper_equity_slippage_bps`, an assignment — so those
 * venues report a figure that is identical on every fill. Dispersion sees that
 * without being told, which is why the verdict is computed from the numbers and
 * the venue tag is used only to NAME the setting afterwards.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASIS_WORD,
  MIN_DISPERSION_FILLS,
  MIN_PRICED_FILLS,
  REALIZED_SPREAD_WITHHELD,
  SIMULATED_FLAG_UNSTATED,
  assumedSlippageNote,
  costBasis,
  toBlotterRow,
  venueProvenance,
  venueQuality,
  type BlotterRow,
} from "../lib/blotter";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * Comments stripped before any source scan, the same guard the disclosure and
 * stability suites use. These files argue in prose about the string they no
 * longer print — SpreadDecomposition's header quotes "measured, measured, not
 * measurable" as the defect it ended — so a raw scan finds the explanation and
 * reports the fix as the violation.
 */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");

/** The exact key set the live gateway returns, with plausible values. Nothing
 *  is added to it: a fixture that invents `simulated` would test a wire that
 *  does not exist. */
const WIRE_ROW = {
  ts: "2026-08-17T11:14:56.665232",
  order_id: "b43f2c5363913451",
  client_order_id: null,
  strategy: "manual",
  symbol: "BTCUSDT",
  side: "BUY",
  order_type: "MARKET",
  quantity: 163.6,
  notional: 12_000,
  accepted: true,
  rejected_by: null,
  reason: null,
  latency_ms: 0.22,
  fill_price: 73.32,
  fill_qty: 163.6,
  fee_usd: 4.8,
  slippage_bps: 0.682,
  venue: "BINANCE",
  checks_json: "[]",
  source: "gateway",
  status: "FILLED",
  time_in_force: "IOC",
  decided_at: "2026-08-17T11:14:56.665232",
};

const fill = (over: Partial<BlotterRow> = {}): BlotterRow => ({
  ts: "2026-01-01T00:00:00Z", orderId: "o1", clientOrderId: null, strategy: "ma_cross",
  symbol: "BTCUSDT", side: "BUY", orderType: "MARKET", quantity: 1, notional: 100_000,
  accepted: true, rejectedBy: [], reason: null, latencyMs: 0.2, fillPrice: 100,
  feeUsd: 40, slippageBps: 4, venue: "BINANCE", simulated: null, source: "gateway",
  status: "FILLED", timeInForce: "IOC", checks: [], ...over,
});

/** n fills whose fee is a fixed RATE on a varying notional — the exact shape
 *  `fee_usd = notional * paper_fee_bps / 1e4` produces, float noise included. */
const atRate = (rateBps: number, notionals: number[], over: Partial<BlotterRow> = {}) =>
  notionals.map((notional, i) =>
    fill({ orderId: `o${i}`, notional, feeUsd: (notional * rateBps) / 1e4, ...over }));

describe("the simulated flag survives the boundary, or says it did not", () => {
  it("carries an explicit true and an explicit false", () => {
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: true })!.simulated, true);
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: false })!.simulated, false);
  });

  it("reads the SQLite twin's integers", () => {
    // `AuditStore._sqlite_fallback` opens a SQLite database when DuckDB will
    // not load, and SQLite has no boolean type.
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: 1 })!.simulated, true);
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: 0 })!.simulated, false);
  });

  it("leaves the real wire shape null, and never false", () => {
    const row = toBlotterRow(WIRE_ROW)!;
    assert.equal(row.simulated, null, "the audit feed carries no simulated column");
    assert.notEqual(row.simulated, false,
      "an older gateway that never stamped the flag must not render as measured");
  });

  it("does not flatten an explicit null, or a value it cannot read", () => {
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: null })!.simulated, null);
    // A string is not a claim. `Boolean("false")` is `true`, which is how this
    // sort of coercion produces the exact wrong answer.
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: "false" })!.simulated, null);
    assert.equal(toBlotterRow({ ...WIRE_ROW, simulated: "true" })!.simulated, null);
  });

  it("reads the field the generated contract actually declares", () => {
    assert.match(read("../lib/gateway-contract.generated.ts"), /simulated\?: boolean;/);
    const parse = code(read("../lib/blotter/parse.ts"));
    assert.match(parse, /simulated: bool\(row\.simulated\)/);
    // The idiom that would have re-broken it, pinned closed by name.
    assert.doesNotMatch(parse, /simulated: row\.simulated === true/);
  });
});

describe("a venue reports what the gateway said, including that it said nothing", () => {
  const at = (venue: string, rows: BlotterRow[]) => venueProvenance(venue, rows).source;

  it("calls a venue simulated only when every fill says so", () => {
    assert.equal(at("PAPER", [fill({ simulated: true }), fill({ simulated: true })]).kind, "simulated");
    assert.equal(at("BINANCE", [fill({ simulated: false }), fill({ simulated: false })]).kind, "exchange");
  });

  it("reports an all-null venue as unstated, not as an exchange venue", () => {
    const source = at("BINANCE", [fill(), fill(), fill()]);
    assert.equal(source.kind, "unstated");
    assert.equal(source.unstated, 3);
    assert.equal(source.exchange, 0, "a missing flag may never be counted as an exchange fill");
  });

  it("says mixed rather than picking the flattering half", () => {
    const both = at("BINANCE", [fill({ simulated: true }), fill({ simulated: false })]);
    assert.equal(both.kind, "mixed");
    assert.equal(both.simulated, 1);
    assert.equal(both.exchange, 1);

    // Half stamped and half silent is also a mix. Reporting it as "simulated"
    // would overclaim; reporting it as "exchange" would underclaim.
    const partly = at("BINANCE", [fill({ simulated: true }), fill()]);
    assert.equal(partly.kind, "mixed");
  });
});

describe("dispersion, not the venue name, decides measured from assumed", () => {
  it("calls a figure that never moves an assumed one, and names its size", () => {
    const basis = costBasis([8, 8, 8, 8], "effective spread");
    assert.equal(basis.kind, "assumed");
    assert.equal(basis.kind === "assumed" && basis.valueBps, 8);
    assert.match(basis.detail, /applied to them, not measured from them/);
  });

  it("survives the float noise a rate on varying notionals produces", () => {
    // 4.0 bps of 12,000 / 40,000 / 137.5 are three different divisions, and the
    // quotients differ in the last bit. That is IEEE 754, not a venue.
    const rows = atRate(4.0, [12_000, 40_000, 137.5]);
    const basis = venueProvenance("PAPER_EQUITY/Tiingo", rows).fee;
    assert.equal(basis.kind, "assumed", "a fixed rate must not read as measured");
  });

  it("calls a figure that moves a measured one", () => {
    const basis = costBasis([0.682, 1.1, 0.5], "effective spread");
    assert.equal(basis.kind, "measured");
    assert.match(basis.detail, /ranges from/);
  });

  it("refuses the verdict below the dispersion floor, both ways", () => {
    assert.equal(MIN_DISPERSION_FILLS, 3);
    // Two agreeing fills is a coincidence at any liquid venue: slippage reaches
    // the wire rounded to three decimals, so collisions are ordinary.
    const two = costBasis([8, 8], "effective spread");
    assert.equal(two.kind, "undetermined");
    assert.notEqual(two.kind, "assumed", "two agreeing fills are not evidence of a constant");
    assert.equal(costBasis([], "fee").kind, "undetermined");
  });

  it("does not read the verdict off the venue tag", () => {
    // A venue NAMED like the simulator's, whose numbers move, is measured.
    const moving = venueProvenance("PAPER_EQUITY/Tiingo", [
      fill({ slippageBps: 1 }), fill({ slippageBps: 2 }), fill({ slippageBps: 3 }),
    ]);
    assert.equal(moving.spread.kind, "measured");
    // And an exchange-named venue whose numbers do not move is assumed.
    const flat = venueProvenance("BINANCE", [
      fill({ slippageBps: 8 }), fill({ slippageBps: 8 }), fill({ slippageBps: 8 }),
    ]);
    assert.equal(flat.spread.kind, "assumed");
  });
});

describe("the assumption is named where the gateway makes it knowable", () => {
  it("names the setting behind a paper-equity slippage", () => {
    const note = assumedSlippageNote("PAPER_EQUITY/Financial Modeling Prep");
    assert.match(note!, /PAPER_EQUITY_SLIPPAGE_BPS/);
    assert.match(note!, /risk_proxy\/execution\.py/);
  });

  it("names the fee path, which no venue schedule is consulted for", () => {
    const rows = atRate(4.0, [12_000, 40_000, 137.5]);
    const fee = venueProvenance("BINANCE", rows).fee;
    assert.equal(fee.kind, "assumed");
    assert.match(fee.detail, /PAPER_FEE_BPS/);
  });

  it("claims nothing about a venue tag it cannot trace", () => {
    assert.equal(assumedSlippageNote("BINANCE"), null);
    assert.equal(assumedSlippageNote("BYBIT+BINANCE"), null);
  });

  it("explains the missing column rather than only flagging it", () => {
    assert.ok(SIMULATED_FLAG_UNSTATED.length > 120, "the gap must argue, not merely tag");
    assert.match(SIMULATED_FLAG_UNSTATED, /audit table/, "name what is missing the column");
    assert.match(SIMULATED_FLAG_UNSTATED, /never as EXCHANGE/);
  });
});

describe("a simulated venue renders distinctly from a measured one", () => {
  const spread = code(read("../components/execution/SpreadDecomposition.tsx"));
  const heatmap = code(read("../components/execution/FillQualityHeatmap.tsx"));

  /** Three fills whose spread AND fee both move, so nothing in them is assumed
   *  and the mark is decided purely by what the gateway said. */
  const varying = (simulated: boolean | null) => [30, 40, 50].map((feeUsd, i) =>
    fill({ orderId: `o${i}`, feeUsd, slippageBps: i + 1, simulated }));

  it("gives the three states three different words", () => {
    const measured = venueProvenance("BINANCE", varying(false)).mark;
    const simulated = venueProvenance("BINANCE", varying(true)).mark;
    const assumed = venueProvenance("PAPER_EQUITY/Tiingo", [
      fill({ orderId: "a", simulated: true, slippageBps: 8 }),
      fill({ orderId: "b", simulated: true, slippageBps: 8 }),
      fill({ orderId: "c", simulated: true, slippageBps: 8 }),
    ]).mark;

    const words = new Set([measured.word, simulated.word, assumed.word]);
    assert.equal(words.size, 3, "three provenances that print one word are not distinguishable");
    assert.equal(assumed.word, "ASSUMED",
      "an assumed cost outranks a simulated venue: inside a simulation the figure may still "
      + "have been measured, and on these venues it was not");
  });

  it("is never carried by colour alone", () => {
    for (const mark of [
      venueProvenance("BINANCE", varying(null)).mark,
      venueProvenance("PAPER", [fill({ slippageBps: 8 }), fill({ slippageBps: 8 }), fill({ slippageBps: 8 })]).mark,
    ]) {
      assert.ok(mark.word.length >= 6, "the word is the reading");
      assert.ok(mark.glyph.length > 0, "the glyph is what survives forced-colors");
    }
    // Both surfaces print the word beside the glyph rather than a bare tint.
    for (const source of [spread, heatmap]) {
      assert.match(source, /<span aria-hidden>\{[a-zA-Z.]*mark\.glyph\}<\/span>/);
      assert.match(source, /mark\.word\}/);
    }
  });

  it("derives the Basis cell instead of asserting one for every row", () => {
    // The literal this replaced claimed a measurement for both columns beside
    // it, on every venue, whatever they rested on.
    assert.doesNotMatch(spread, /measured, measured, not measurable/);
    assert.match(spread, /BASIS_WORD\[venue\.provenance\.spread\.kind\]/);
    assert.match(spread, /BASIS_WORD\[venue\.provenance\.fee\.kind\]/);
    assert.equal(BASIS_WORD.undetermined, "not established");
  });

  it("states the finding at rest and folds only the argument", () => {
    // The honesty floor, carried here because disclosure-execution.test.ts is at its line ceiling.
    // A provenance verdict a reader acts on may move within the card; it may not move behind a
    // fold, which is a one-time notice with extra steps.
    const fold = spread.indexOf("<details");
    const atRest = spread.slice(0, fold);
    const folded = spread.slice(fold);
    const finding = "it is marked ASSUMED below";
    assert.match(atRest, /identical on every fill/,
      "the finding a reader acts on may not live behind a fold");
    assert.ok(atRest.includes(finding), "the provenance finding left the card");
    assert.ok(!folded.includes(finding), "the provenance finding is behind a fold");
    assert.match(atRest, /assumed\.map\(\(venue\) => venue\.venue\)/,
      "the venues named at rest must be computed, never a hard-coded list");
    // The heatmap's mark is a row header, which is as at-rest as a table gets.
    assert.ok(heatmap.indexOf("mark.word") < heatmap.indexOf("<details"),
      "the venue mark must not be reachable only by opening the grid's fold");
  });

  it("extends the existing disclosure rather than opening a rival one", () => {
    assert.equal((spread.match(/<summary>/g) ?? []).length, 1);
    assert.match(spread, /What is the spread measured against, and why is one column left blank\?/);
    // The pre-existing body is still word for word inside that same fold.
    assert.match(spread, /\{REALIZED_SPREAD_WITHHELD\}/);
    assert.match(spread, /\{SIMULATED_FLAG_UNSTATED\}/);
  });

  it("does not weaken what the fill-quality suite already pinned", () => {
    assert.equal(MIN_PRICED_FILLS, 8);
    assert.match(REALIZED_SPREAD_WITHHELD, /tca_snapshots/);
    // Every venue still withholds the realized leg, provenance or not.
    for (const venue of venueQuality([fill(), fill({ venue: "PAPER" })]).venues) {
      assert.equal(venue.realizedSpreadBps, null);
    }
  });

  it("neither hides a simulated venue nor invents a fee for it", () => {
    const rows = [
      ...atRate(4.0, [12_000, 40_000, 137.5], { venue: "PAPER_EQUITY/Tiingo", slippageBps: 8, simulated: true }),
      ...atRate(4.0, [9_000, 15_000, 21_000], { venue: "BINANCE", simulated: true }),
    ];
    const mix = venueQuality(rows);
    assert.equal(mix.venues.length, 2, "a simulated venue stays in the mix");
    const paper = mix.venues.find((v) => v.venue === "PAPER_EQUITY/Tiingo")!;
    // The number is untouched: 2 x 8.0. Only the claim around it changed.
    assert.equal(paper.effectiveSpreadBps, 16);
    assert.equal(paper.provenance.mark.word, "ASSUMED");
  });
});
