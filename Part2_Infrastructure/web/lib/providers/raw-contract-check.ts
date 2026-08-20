/**
 * One entry point: given a provider, a capability and the raw body, check it.
 *
 * Separate from both predicate files because they would otherwise import each
 * other — `raw-contracts-rest.ts` needs the shared helpers from
 * `raw-contracts.ts`, and a dispatcher living in `raw-contracts.ts` would need
 * the six functions back.
 *
 * ── Where this is called from, and why that matters ─────────────────────────
 * The raw body exists inside `httpJson` and NOWHERE else: by the time
 * `runtime.ts` normalises a response the original is gone, which is why the
 * boundary notice's claim that raw payloads reach the quarantine sample was
 * false. `quarantinePayload` was handed `data` — the normalised object.
 *
 * ── Violations join the existing plumbing rather than growing new plumbing ──
 * A raw violation is an ordinary `Violation` with a `raw.<provider>.<check>`
 * id, so the ledger, the quarantine, the failover decision and the telemetry
 * all carry it without a single new field. That is the cheapest correct place
 * to put it and the reason the check ids are namespaced.
 */

import type { Violation } from "@/lib/providers/contracts";
import {
  checkBinanceKlinesRaw,
  checkBinanceTickerRaw,
  checkBybitEnvelopeRaw,
  checkBybitKlinesRaw,
  type RawContractResult,
} from "@/lib/providers/raw-contracts";
import {
  checkAlphaVantageRaw,
  checkFirecrawlRaw,
  checkFmpRaw,
  checkMassiveRaw,
  checkOpenBBRaw,
  checkTiingoRaw,
} from "@/lib/providers/raw-contracts-rest";

/** Providers with a raw predicate. Anything else is checked as unknown. */
export const RAW_CHECKED: readonly string[] = [
  "binance", "bybit", "alphavantage", "massive", "openbb", "firecrawl", "fmp", "tiingo",
];

/**
 * Check one raw body. Returns null when the provider has no predicate.
 *
 * Null rather than an empty pass: "nothing checked this" and "this passed
 * every check" are different facts, and collapsing them would let a provider
 * silently drop out of coverage while the panel kept reporting green.
 */
export function checkRawBody(
  provider: string,
  capability: string,
  body: unknown,
): RawContractResult | null {
  switch (provider) {
    case "binance":
      return capability === "bars" ? checkBinanceKlinesRaw(body) : checkBinanceTickerRaw(body);
    case "bybit": {
      const envelope = checkBybitEnvelopeRaw(body, capability);
      if (!envelope.passed || capability !== "bars") return envelope;
      return checkBybitKlinesRaw(body);
    }
    case "alphavantage":
      return checkAlphaVantageRaw(body, capability);
    case "massive":
      return checkMassiveRaw(body, capability);
    case "openbb":
      return checkOpenBBRaw(body, capability);
    case "firecrawl":
      return checkFirecrawlRaw(body, capability);
    case "fmp":
      return checkFmpRaw(body, capability);
    case "tiingo":
      return checkTiingoRaw(body, capability);
    default:
      return null;
  }
}

/** The violations alone, for merging into an existing `ContractResult`. */
export function rawViolations(provider: string, capability: string, body: unknown): Violation[] {
  return checkRawBody(provider, capability, body)?.violations ?? [];
}
