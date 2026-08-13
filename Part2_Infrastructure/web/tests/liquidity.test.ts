/**
 * Time-to-liquidate, and the exit probe that read a response shape that does
 * not exist.
 *
 * `useExitQuotes` read `data.summary.expected_slippage_bps`, `.vwap` and
 * `.fillable`. `/api/tca` returns a `TcaReport` verbatim, and `TcaReport` has
 * no `summary` — the fields are top-level and camelCase. So the probe fired a
 * real request, got a real 200, and read `undefined` three times: every quote
 * rendered "—" forever, with no error, on a panel nobody had mounted. Two
 * defects hiding each other.
 *
 * The maths below was already sound; what it lacked was a caller and a test.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PARTICIPATION,
  MIN_ADV_OBSERVATIONS,
  liquidityConcentration,
  timeToLiquidate,
  type LiquidityInput,
} from "../lib/liquidity";
import { absorbs } from "../lib/venues";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const position = (over: Partial<LiquidityInput> = {}): LiquidityInput => ({
  symbol: "BTCUSDT", notional: 100_000, quantity: 1,
  adv: 10_000_000, observations: 60, ...over,
});

describe("time to liquidate refuses to guess", () => {
  it("bands a position with no volume history as unmeasurable, not as fast", () => {
    // Zero days to exit and "we have no idea" are opposite claims, and only one
    // of them is safe to put beside a position size.
    const report = timeToLiquidate([position({ adv: null, observations: 0 })]);
    assert.equal(report.rows[0].band, "unmeasurable");
    assert.equal(report.rows[0].daysToLiquidate, null);
    assert.notEqual(report.rows[0].daysToLiquidate, 0);
  });

  it("holds the sample floor rather than pricing a thin history", () => {
    const thin = timeToLiquidate([position({ observations: MIN_ADV_OBSERVATIONS - 1 })]);
    assert.equal(thin.rows[0].band, "unmeasurable");
    const enough = timeToLiquidate([position({ observations: MIN_ADV_OBSERVATIONS })]);
    assert.notEqual(enough.rows[0].band, "unmeasurable");
  });

  it("takes longer at a lower participation rate", () => {
    const big = position({ notional: 5_000_000 });
    const patient = timeToLiquidate([big], 0.05).rows[0].daysToLiquidate;
    const eager = timeToLiquidate([big], 0.3).rows[0].daysToLiquidate;
    assert.ok(patient != null && eager != null);
    assert.ok(patient > eager, "a smaller share of daily volume must take more sessions");
  });

  it("names the slowest leg, which is the one that sets the book's horizon", () => {
    const report = timeToLiquidate([
      position({ symbol: "FAST", notional: 10_000 }),
      position({ symbol: "SLOW", notional: 9_000_000 }),
    ]);
    assert.equal(report.slowestLeg, "SLOW");
  });

  it("reports no horizon at all when nothing is measurable", () => {
    const report = timeToLiquidate([position({ adv: null, observations: 0 })]);
    assert.equal(report.bookDaysToLiquidate, null);
    assert.equal(liquidityConcentration(report), null);
  });

  it("clamps a nonsense participation rate instead of dividing by zero", () => {
    for (const rate of [0, -1, 5]) {
      const days = timeToLiquidate([position()], rate).rows[0].daysToLiquidate;
      assert.ok(days != null && Number.isFinite(days) && days > 0, `rate ${rate} produced ${days}`);
    }
  });
});

describe("the exit probe reads the response this route actually returns", () => {
  const hook = read("../lib/use-exit-quotes.ts");
  const route = read("../app/api/tca/route.ts");
  const report = read("../lib/venues.ts");

  it("reads no `summary` object, because TcaReport has none", () => {
    const code = hook.replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(code, /data\.summary/, "the shape this read never existed");
    assert.doesNotMatch(code, /expected_slippage_bps/, "snake_case in a camelCase contract");

    // Prove the premise rather than asserting it: the route returns the report
    // unwrapped, and the interface declares no `summary` member.
    assert.match(route, /NextResponse\.json\(report\)/);
    const iface = report.slice(report.indexOf("export interface TcaReport"));
    assert.doesNotMatch(iface.slice(0, iface.indexOf("\n}")), /\bsummary\b/);
  });

  it("reads the fields that are there", () => {
    for (const field of ["smartRouteSlippageBps", "smartRouteVwap", "smartRoute"]) {
      assert.match(hook, new RegExp(`body\\.${field}`), `probe never reads ${field}`);
    }
  });

  it("decides fillable with the gateway's own tolerance", () => {
    // A UI that invents its own definition of "filled" will disagree with the
    // Python engine at the edge, which is the worst place to disagree.
    assert.match(hook, /absorbs\(routed, target\)/);
    assert.equal(absorbs(100_000, 100_000), true);
    assert.equal(absorbs(99_999, 100_000), false);
  });

  it("keeps an error state that a caller can render", () => {
    // The old hook caught every failure into a bare comment, so a 503 for a
    // symbol with no live book looked like a button nobody had pressed.
    assert.match(hook, /const \[errors, setErrors\]/);
    assert.match(hook, /body\.error/);
    assert.match(hook, /return \{ quotes, loading, errors, fetchExitQuote \}/);
    assert.doesNotMatch(hook.replace(/\/\*[\s\S]*?\*\//g, ""), /\/\/ Graceful error state/);
  });

  it("never coerces an unpriced quote to zero", () => {
    assert.match(hook, /body\.smartRouteSlippageBps \?\? null/);
  });
});

describe("the panel is mounted and adjustable", () => {
  const panel = read("../components/portfolio/LiquidityPanel.tsx");
  const workspace = read("../components/PortfolioWorkspace.tsx");

  it("is rendered by the positions section", () => {
    // It shipped unreferenced: a finished panel, in the bundle, reachable from
    // no route in the app.
    assert.match(workspace, /<LiquidityPanel/);
    assert.match(workspace, /advMap=\{view\.advBySymbol\}/);
  });

  it("consumes the ADV the book hook was already computing", () => {
    const book = read("../lib/use-book.ts");
    assert.match(book, /advBySymbol/);
    assert.match(panel, /advMap\[position\.symbol\]/);
  });

  it("has the participation control its copy describes", () => {
    // `participation` was state with no setter, beside prose calling it "a
    // given participation rate" — the control was planned and never built.
    assert.match(panel, /setParticipation\(step\)/);
    assert.match(panel, /PARTICIPATION_STEPS/);
    assert.ok(panel.includes(String(DEFAULT_PARTICIPATION)) || panel.includes("DEFAULT_PARTICIPATION"));
  });

  it("renders the probe failure rather than swallowing it", () => {
    assert.match(panel, /errors\[key\]/);
    assert.match(panel, /liquidity-probe__error/);
  });
});
