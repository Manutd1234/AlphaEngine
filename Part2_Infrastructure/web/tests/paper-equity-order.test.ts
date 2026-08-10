import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PaperEquityReferenceError,
  buildPaperExecutionReference,
} from "../lib/paper-equity";
import type { Quote, Sourced } from "../lib/providers/types";

const ROUTE = readFileSync(new URL("../app/api/gateway/orders/route.ts", import.meta.url), "utf8");

function quote(overrides: Partial<Quote> = {}): Sourced<Quote> {
  return {
    data: {
      symbol: "AAPL",
      price: 200,
      change: 1,
      changePct: 0.5,
      open: 198,
      high: 201,
      low: 197,
      prevClose: 199,
      volume: 1_000_000,
      currency: "USD",
      asOf: "2026-08-10T18:47:34.000Z",
      delayed: false,
      ...overrides,
    },
    provenance: {
      provider: "fmp",
      label: "Financial Modeling Prep",
      fetchedAt: "2026-08-10T18:47:35.000Z",
      latencyMs: 35,
      cached: false,
      delayed: false,
      quotaRemaining: 249,
      quotaWindow: "day",
      contract: { passed: true, violations: [], notEvaluated: [] },
    },
    attempts: [],
  };
}

describe("trusted paper-equity reference", () => {
  it("keeps only the gateway's narrow USD quote evidence", () => {
    assert.deepEqual(buildPaperExecutionReference("aapl", quote()), {
      asset_class: "equity",
      price: 200,
      as_of: "2026-08-10T18:47:34.000Z",
      source: "Financial Modeling Prep",
      currency: "USD",
      delayed: false,
    });
  });

  it("fails closed on a mismatched, unpriced, non-USD or untimestamped quote", () => {
    const invalid = [
      quote({ symbol: "MSFT" }),
      quote({ price: Number.NaN }),
      quote({ currency: "EUR" }),
      quote({ asOf: "not-a-time" }),
    ];
    for (const candidate of invalid) {
      assert.throws(
        () => buildPaperExecutionReference("AAPL", candidate),
        PaperEquityReferenceError,
      );
    }
  });

  it("fails closed when the provider contract did not pass", () => {
    const candidate = quote();
    candidate.provenance.contract = {
      passed: false,
      violations: [{ check: "price", severity: "fatal", message: "bad" }],
      notEvaluated: [],
    };
    assert.throws(() => buildPaperExecutionReference("AAPL", candidate), /data contract/);
  });
});

describe("order route equity enrichment boundary", () => {
  it("loads an interactive server-side quote and constructs the reference", () => {
    assert.match(ROUTE, /getQuote\(String\(order\.symbol\), \{[\s\S]*priority: "interactive"/);
    assert.match(ROUTE, /paper_execution: buildPaperExecutionReference/);
  });

  it("does not copy a browser-supplied reference through parseOrder", () => {
    const parser = ROUTE.slice(ROUTE.indexOf("function parseOrder"), ROUTE.indexOf("export async function POST"));
    assert.doesNotMatch(parser, /paper_execution/);
  });

  it("leaves crypto orders on the existing L2 gateway path", () => {
    assert.match(ROUTE, /classify\(String\(order\.symbol\)\) === "equity"/);
    assert.match(ROUTE, /callGateway<Record<string, unknown>>\("\/api\/orders"/);
  });
});
