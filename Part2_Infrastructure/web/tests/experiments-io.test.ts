import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EXPORT_SCHEMA,
  MAX_RECORDS,
  type ExperimentRecord,
  exportExperiments,
  importExperiments,
  saveExperiments,
} from "../lib/experiments";
import { DEFAULT_REQUEST } from "../lib/types";

function makeRecord(overrides: Partial<ExperimentRecord> = {}): ExperimentRecord {
  return {
    id: "EXP-001",
    savedAt: 1_700_000_000_000,
    symbol: "BTCUSDT",
    interval: "4h",
    strategy: "ma_cross",
    direction: "long_only",
    bars: 2000,
    periodStart: "2025-01-01 00:00",
    periodEnd: "2026-01-01 00:00",
    combosTested: 74,
    fast: 12,
    slow: 48,
    sharpe: 1.4,
    totalReturn: 0.32,
    maxDrawdown: -0.18,
    trades: 41,
    deflatedSharpeRatio: 0.91,
    walkForwardOosSharpe: 0.6,
    medianEfficiency: 0.7,
    stabilityKind: "plateau",
    alphaTStat: 2.1,
    verdict: "marginal",
    promotionPassed: 4,
    promotionTotal: 6,
    modelledFrictions: false,
    dataHash: "abcd1234",
    request: { ...DEFAULT_REQUEST },
    ...overrides,
  };
}

describe("export bundle", () => {
  it("round-trips through import", () => {
    const records = [
      makeRecord(),
      makeRecord({ id: "EXP-002", request: { ...DEFAULT_REQUEST, fastMin: 4 }, savedAt: 1_700_000_100_000 }),
    ];
    const json = exportExperiments(records, "abc1234");
    const bundle = JSON.parse(json);
    assert.equal(bundle.schema, EXPORT_SCHEMA);
    assert.equal(bundle.appCommit, "abc1234");

    const result = importExperiments(json, []);
    assert.equal(result.error, undefined);
    assert.equal(result.added, 2);
    assert.deepEqual(
      result.records.map((r) => r.id).sort(),
      ["EXP-001", "EXP-002"],
    );
  });

  it("accepts a bare array of records", () => {
    const result = importExperiments(JSON.stringify([makeRecord()]), []);
    assert.equal(result.added, 1);
    assert.equal(result.error, undefined);
  });
});

describe("import validation", () => {
  it("malformed JSON leaves the history untouched", () => {
    const existing = [makeRecord()];
    const result = importExperiments("{not json", existing);
    assert.ok(result.error);
    assert.equal(result.records, existing);
  });

  it("a wrong schema tag is rejected", () => {
    const payload = JSON.stringify({ schema: "someone-elses@9", records: [makeRecord()] });
    const result = importExperiments(payload, []);
    assert.ok(result.error?.includes("schema"));
    assert.equal(result.records.length, 0);
  });

  it("junk entries are filtered and counted while valid ones import", () => {
    const payload = JSON.stringify({
      schema: EXPORT_SCHEMA,
      exportedAt: "2026-01-01T00:00:00Z",
      records: [makeRecord(), { id: "nope" }, 42, { ...makeRecord({ id: "EXP-009" }), request: null }],
    });
    const result = importExperiments(payload, []);
    assert.equal(result.added, 1);
    assert.equal(result.invalid, 3);
  });

  it("unknown extra fields survive the round-trip", () => {
    const exotic = { ...makeRecord(), futureField: { nested: true } } as unknown as ExperimentRecord;
    const result = importExperiments(exportExperiments([exotic]), []);
    assert.equal(result.added, 1);
    assert.deepEqual(
      (result.records[0] as unknown as { futureField: unknown }).futureField,
      { nested: true },
    );
  });
});

describe("merge policy", () => {
  it("same request: newer savedAt wins, local note survives", () => {
    const local = makeRecord({ note: "my hypothesis", tags: ["btc"] });
    const newer = makeRecord({ id: "EXP-777", savedAt: local.savedAt + 5000, sharpe: 1.6 });
    const result = importExperiments(JSON.stringify([newer]), [local]);
    assert.equal(result.replaced, 1);
    assert.equal(result.added, 0);
    const merged = result.records[0];
    assert.equal(merged.id, "EXP-001", "local id is kept");
    assert.equal(merged.sharpe, 1.6, "newer metrics win");
    assert.equal(merged.note, "my hypothesis", "local note survives");
    assert.deepEqual(merged.tags, ["btc"]);
  });

  it("same request: older import is skipped", () => {
    const local = makeRecord();
    const older = makeRecord({ savedAt: local.savedAt - 5000, sharpe: 0.2 });
    const result = importExperiments(JSON.stringify([older]), [local]);
    assert.equal(result.skippedOlder, 1);
    assert.equal(result.records[0].sharpe, local.sharpe);
  });

  it("id collision with a different request keeps both, re-issuing the id", () => {
    const local = makeRecord();
    const clash = makeRecord({
      request: { ...DEFAULT_REQUEST, slowMax: 250 },
      savedAt: local.savedAt + 1,
    });
    const result = importExperiments(JSON.stringify([clash]), [local]);
    assert.equal(result.added, 1);
    assert.equal(result.records.length, 2);
    const ids = result.records.map((r) => r.id);
    assert.equal(new Set(ids).size, 2, `ids not unique: ${ids}`);
  });

  it("merged history is newest-first so the storage cap drops the oldest", () => {
    const incoming = Array.from({ length: MAX_RECORDS + 10 }, (_, i) =>
      makeRecord({
        id: `EXP-${String(i + 1).padStart(3, "0")}`,
        savedAt: 1_700_000_000_000 + i * 1000,
        request: { ...DEFAULT_REQUEST, fastMin: 2 + i },
      }),
    );
    const result = importExperiments(JSON.stringify(incoming), []);
    assert.equal(result.added, MAX_RECORDS + 10);
    assert.ok(result.records[0].savedAt > result.records.at(-1)!.savedAt);
    const bounded = saveExperiments(result.records);
    assert.equal(bounded.length, MAX_RECORDS);
    assert.equal(bounded[0].savedAt, result.records[0].savedAt, "newest survives the cap");
  });
});
