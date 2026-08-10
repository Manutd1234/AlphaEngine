import type { Quote, Sourced } from "@/lib/providers/types";

export interface PaperExecutionReference {
  asset_class: "equity";
  price: number;
  as_of: string;
  source: string;
  currency: "USD";
  delayed: boolean;
}

export class PaperEquityReferenceError extends Error {
  readonly code = "equity_quote_invalid";

  constructor(message: string) {
    super(message);
    this.name = "PaperEquityReferenceError";
  }
}

/**
 * Turn a provider-registry result into the narrow gateway contract.
 *
 * The caller supplies a symbol that has already passed order validation. The
 * returned envelope is built only on the server; browser-supplied prices never
 * reach this function or the gateway.
 */
export function buildPaperExecutionReference(
  requestedSymbol: string,
  sourced: Sourced<Quote>,
): PaperExecutionReference {
  const expected = requestedSymbol.trim().toUpperCase();
  const actual = sourced.data.symbol.trim().toUpperCase();
  if (actual !== expected) {
    throw new PaperEquityReferenceError(`Quote symbol ${actual || "(missing)"} did not match ${expected}.`);
  }

  if (!Number.isFinite(sourced.data.price) || sourced.data.price <= 0) {
    throw new PaperEquityReferenceError(`${expected} did not return a positive finite price.`);
  }
  if (sourced.data.currency.trim().toUpperCase() !== "USD") {
    throw new PaperEquityReferenceError(`${expected} is not quoted in USD.`);
  }
  if (!Number.isFinite(Date.parse(sourced.data.asOf))) {
    throw new PaperEquityReferenceError(`${expected} did not return a timestamped quote.`);
  }
  if (sourced.provenance.contract && !sourced.provenance.contract.passed) {
    throw new PaperEquityReferenceError(`${expected} failed the provider data contract.`);
  }

  const source = sourced.provenance.label.trim() || sourced.provenance.provider.trim();
  if (!source) {
    throw new PaperEquityReferenceError(`${expected} quote provenance was missing.`);
  }

  return {
    asset_class: "equity",
    price: sourced.data.price,
    as_of: new Date(sourced.data.asOf).toISOString(),
    source: source.slice(0, 80),
    currency: "USD",
    delayed: sourced.data.delayed || sourced.provenance.delayed,
  };
}
