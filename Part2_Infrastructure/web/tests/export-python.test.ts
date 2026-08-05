import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ExperimentRecord } from "../lib/experiments";
import { generatePythonScript, pyLiteral } from "../lib/export-python";
import { DEFAULT_REQUEST } from "../lib/types";

function makeRecord(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "EXP-042",
    savedAt: 1_760_000_000_000,
    symbol: "ETHUSDT",
    interval: "4h",
    strategy: "ma_cross",
    direction: "long_only",
    bars: 1500,
    periodStart: "2025-06-01 00:00",
    periodEnd: "2026-02-01 08:00",
    combosTested: 74,
    fast: 12,
    slow: 48,
    sharpe: 1.2345,
    totalReturn: 0.4567,
    maxDrawdown: -0.21,
    trades: 37,
    deflatedSharpeRatio: 0.88,
    walkForwardOosSharpe: 0.5,
    medianEfficiency: null,
    stabilityKind: null,
    alphaTStat: null,
    verdict: "marginal",
    promotionPassed: 3,
    promotionTotal: 6,
    modelledFrictions: false,
    dataHash: "0badc0de",
    request: { ...DEFAULT_REQUEST, symbol: "ETHUSDT" },
    ...overrides,
  };
}

describe("pyLiteral", () => {
  it("maps the JSON keywords to Python's", () => {
    assert.equal(pyLiteral(true), "True");
    assert.equal(pyLiteral(false), "False");
    assert.equal(pyLiteral(null), "None");
    assert.equal(pyLiteral(NaN), "None");
  });

  it("renders nested structures", () => {
    assert.equal(
      pyLiteral({ a: [1, "two", false], b: { c: null } }),
      '{"a": [1, "two", False], "b": {"c": None}}',
    );
  });
});

describe("generatePythonScript", () => {
  it("embeds the request, winner and window", () => {
    const script = generatePythonScript(makeRecord(), { appCommit: "abc1234" });
    assert.ok(script.includes('"symbol": "ETHUSDT"'));
    assert.ok(script.includes('"interval": "4h"'));
    assert.ok(script.includes("FAST = 12"));
    assert.ok(script.includes("SLOW = 48"));
    assert.ok(script.includes(`"feeBps": ${DEFAULT_REQUEST.feeBps}`));
    assert.ok(script.includes("0badc0de"));
    assert.ok(script.includes("commit abc1234"));
    // 2026-02-01 08:00 UTC — pins the fetch window.
    assert.ok(script.includes(`END_TIME_MS = ${Date.UTC(2026, 1, 1, 8, 0)}`));
  });

  it("emits the right signal builder per strategy and rejects unknown ones", () => {
    const ma = generatePythonScript(makeRecord({ strategy: "ma_cross" }));
    assert.ok(ma.includes("f > s"));
    const don = generatePythonScript(makeRecord({ strategy: "donchian" }));
    assert.ok(don.includes("rolling_max(high, fast)"));
    const rsiScript = generatePythonScript(makeRecord({ strategy: "rsi_reversion" }));
    assert.ok(rsiScript.includes("r[i] < 30"));
    assert.throws(
      () => generatePythonScript(makeRecord({ strategy: "martingale" as ExperimentRecord["strategy"] })),
      /unknown strategy/,
    );
  });

  it("never leaks JS artefacts into the Python source", () => {
    for (const strategy of ["ma_cross", "donchian", "rsi_reversion"] as const) {
      const script = generatePythonScript(makeRecord({ strategy }));
      assert.ok(!script.includes("undefined"));
      assert.ok(!script.includes("[object Object]"));
      assert.ok(!script.includes("NaN,"), "bare NaN in a literal");
      // Python keywords, not JSON's.
      assert.ok(!/\btrue\b|\bfalse\b/.test(script.replace(/".*?"/g, "")));
    }
  });

  it("is deterministic for a fixed record", () => {
    const a = generatePythonScript(makeRecord());
    const b = generatePythonScript(makeRecord());
    assert.equal(a, b);
  });

  it("throws on an unparseable period end rather than emitting garbage", () => {
    assert.throws(
      () => generatePythonScript(makeRecord({ periodEnd: "not a date" })),
      /unparseable/,
    );
  });
});
