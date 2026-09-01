import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PaperEquityReferenceError,
  buildPaperExecutionReference,
} from "../lib/paper-equity";
import {
  EQUITY_QUOTE_STALE_MS,
  EQUITY_QUOTE_TTL_MS,
  deriveEquityQuoteHealth,
  equityQuoteHealthLabel,
} from "../components/execution/use-equity-quote";
import type { Quote, Sourced } from "../lib/providers/types";
import { SYMBOLS, marketCapabilitiesFor } from "../lib/venues";

const ROUTE = readFileSync(new URL("../app/api/gateway/orders/route.ts", import.meta.url), "utf8");
const LIVE_MARKET = readFileSync(new URL("../components/LiveMarket.tsx", import.meta.url), "utf8");
const MARKET_CONTEXT = readFileSync(
  new URL("../components/execution/MarketWatchlist.tsx", import.meta.url), "utf8",
);
const EQUITY_QUOTE_FEED = readFileSync(
  new URL("../components/execution/use-equity-quote.ts", import.meta.url), "utf8",
);
const TICKET = readFileSync(new URL("../components/execution/OrderTicket.tsx", import.meta.url), "utf8");
// The order-type seg and the panel's own subtitle moved into the form when the
// ticket was split; the equity classification that gates them did not.
const TICKET_FORM = readFileSync(
  new URL("../components/execution/OrderTicketForm.tsx", import.meta.url), "utf8",
);

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
      quotaLimit: 250,
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

  it("never turns a synthetic fallback into executable paper evidence", () => {
    const candidate = quote();
    (candidate.provenance as typeof candidate.provenance & { synthetic: boolean }).synthetic = true;
    assert.throws(() => buildPaperExecutionReference("AAPL", candidate), /synthetic/i);
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

describe("covered equity execution UI", () => {
  it("separates provider quotes, direct L2 and paper execution capabilities", () => {
    assert.deepEqual(marketCapabilitiesFor("aapl"), {
      asset: "equity",
      restQuote: true,
      directL2: false,
      paperMarketOrder: true,
    });
    assert.deepEqual(marketCapabilitiesFor("BTCUSDT"), {
      asset: "crypto",
      restQuote: true,
      directL2: true,
      paperMarketOrder: false,
    });
    assert.equal((SYMBOLS as readonly string[]).includes("AAPL"), false,
      "equity support must not manufacture a Binance/Bybit AAPL subscription");
  });

  it("accepts curated or free-text tickers without expanding the page", () => {
    assert.match(LIVE_MARKET, /<SymbolCombobox/);
    assert.match(LIVE_MARKET, /id="execution-symbol"/);
    assert.match(LIVE_MARKET, /onCommit=\{onSymbolChange\}/);
    assert.match(LIVE_MARKET, /execution-market-strip/);
  });

  it("previews provider provenance but leaves authoritative pricing to the order route", () => {
    assert.match(EQUITY_QUOTE_FEED, /fetch\(`\/api\/quote\?symbols=/);
    const quotePoll = EQUITY_QUOTE_FEED.slice(EQUITY_QUOTE_FEED.indexOf("export function useEquityQuotePreview"));
    assert.match(quotePoll, /usePolling\(\{[\s\S]*?signal[\s\S]*?intervalMs: 30_000/);
    assert.match(quotePoll, /maxBackoffMs: EQUITY_QUOTE_TTL_MS/);
    assert.match(quotePoll, /enabled, immediate: true/);
    assert.match(quotePoll, /immediate: true/);
    assert.match(quotePoll, /restartKey: symbol/,
      "changing the selected equity must abort the old poll and fetch the new quote immediately");
    const failedUpdate = quotePoll.slice(quotePoll.indexOf("const fail"), quotePoll.indexOf("try {"));
    assert.match(failedUpdate, /\.\.\.prior, pending: false, refreshFailed: true/);
    assert.doesNotMatch(failedUpdate, /quote: null/,
      "a failed refresh erased the last-good display value instead of demoting it");

    const at = 1_000_000;
    const health = (age: number | null, refreshFailed = false, pending = false) =>
      deriveEquityQuoteHealth({
        lastSuccessAt: age == null ? null : at - age,
        refreshFailed,
        pending,
        now: at,
      });
    assert.equal(health(null, false, true).state, "checking");
    assert.equal(health(0).state, "fresh");
    assert.equal(health(10_000, true).state, "error");
    assert.equal(health(EQUITY_QUOTE_STALE_MS, true).state, "stale");
    assert.equal(health(EQUITY_QUOTE_TTL_MS, true).state, "expired");
    assert.equal(health(0).staleAfterMs, EQUITY_QUOTE_STALE_MS);
    assert.equal(health(0).ttlMs, EQUITY_QUOTE_TTL_MS);
    assert.match(equityQuoteHealthLabel(health(null, true)), /no successful refresh/);
    assert.match(equityQuoteHealthLabel(health(EQUITY_QUOTE_STALE_MS, true)), /Refresh failed; retained quote stale/);
    assert.match(equityQuoteHealthLabel(health(EQUITY_QUOTE_TTL_MS, true)), /retained quote expired/);
    assert.match(LIVE_MARKET, /Covered US ticker/);
    assert.match(LIVE_MARKET, /Sandbox preview — not execution evidence/);
    assert.match(LIVE_MARKET, /quotePreview && !quotePreview\.synthetic && !quotePreview\.delayed && quoteHealth\.state === "fresh"/);
    assert.match(LIVE_MARKET, /Delayed\/EOD equity quote/);
    assert.match(LIVE_MARKET, /no L2 routing/);
    assert.match(LIVE_MARKET, /<EquityMarketPath/);
    assert.match(MARKET_CONTEXT, /Last provider quote/);
    assert.match(MARKET_CONTEXT, /Quote as of/);
    assert.match(MARKET_CONTEXT, /Refresh health/);
    assert.match(MARKET_CONTEXT, /live-status TTL \$\{EQUITY_QUOTE_TTL_MS \/ 60_000\} min/);
    assert.match(MARKET_CONTEXT, /expired values stay as context/);
    assert.match(MARKET_CONTEXT, /market-context-card__mode\$\{liveSupported \? " is-live" : ""\}/,
      "REST quote health must not be styled as direct L2 venue liveness");
    assert.match(MARKET_CONTEXT, /Available paper MARKET path/);
    assert.match(MARKET_CONTEXT, /Direct equity L2 is not provisioned/);
    assert.doesNotMatch(LIVE_MARKET, /Live venue routing is not available/);
  });

  it("keeps equity orders MARKET-only in the ticket", () => {
    assert.match(TICKET, /classify\(symbol\) === "equity"/);
    assert.match(TICKET_FORM, /disabled=\{paperEquity && option === "LIMIT"\}/);
    assert.match(TICKET, /MARKET only; no L2 routing is claimed/);
  });
});
