/**
 * Cross-provider reconciliation.
 *
 * Split out of `registry.ts` when that file passed 630 lines. This is the piece
 * that exists because the desk is a trading tool rather than a data viewer:
 * given more than one configured price source it queries all of them and reports
 * the dispersion, because the failure mode that actually costs money is not an
 * outage — an outage is loud. It is one feed quietly going stale while still
 * returning HTTP 200 with a plausible price. A single source cannot detect that
 * about itself; two can.
 */

import { outageFor } from "../observability";
import { candidatesFor, type Options } from "./adapters";
import { getQuote } from "./facades";
import { isConfigured } from "./runtime";
import { classify } from "./symbols";
import { Attempt } from "./types";

export interface ConsensusLeg {
  provider: string;
  label: string;
  price: number;
  asOf: string;
  delayed: boolean;
  latencyMs: number;
  /** Signed distance from the consensus, in basis points. */
  deviationBps: number;
  /** Seconds between this print's stamp and the freshest one in the set. */
  stalenessSec: number;
}

export interface Consensus {
  symbol: string;
  /** Median, not mean — one stuck feed should not drag the reference. */
  price: number | null;
  legs: ConsensusLeg[];
  /** max − min across legs, in bps of the consensus. */
  spreadBps: number | null;
  /** Legs further than `toleranceBps` from the consensus. */
  outliers: string[];
  toleranceBps: number;
  attempts: Attempt[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Query every configured price source at once and report where they disagree.
 *
 * The tolerance defaults to 50bps because these providers are legitimately not
 * the same instrument: an EOD close, a delayed composite and a live IEX print
 * for the same ticker will differ by more than a tick and that is not an error.
 * The purpose is not tick-level arbitration — it is catching the leg that is
 * 400bps out because it has been serving a cached Friday close since Tuesday.
 *
 * Deliberately bypasses `dispatch`'s failover: this fans out on purpose and one
 * provider failing is a data point, not a reason to retry elsewhere.
 */
export async function consensusQuote(
  symbol: string,
  toleranceBps = 50,
  opts: Options = {},
): Promise<Consensus> {
  const asset = classify(symbol);
  const pool = candidatesFor("quote", asset);
  const attempts: Attempt[] = [];

  const settled = await Promise.all(
    pool.map(async (adapter) => {
      const { id } = adapter.meta;
      if (!isConfigured(adapter, opts.env ?? process.env)) {
        attempts.push({ provider: id, reason: "not_configured", detail: adapter.meta.keyEnv });
        return null;
      }
      // Checked here, not left to the pinned dispatch's throw: the catch below
      // would record the outage as "failed", and a fault an operator caused
      // deliberately must never be reported as one they did not.
      const outage = outageFor(id);
      if (outage) {
        attempts.push({
          provider: id,
          reason: "simulated_outage",
          detail: `restores in ${Math.max(0, Math.ceil((outage.expiresAt - Date.now()) / 1000))}s`,
        });
        return null;
      }
      try {
        // Each leg goes through `dispatch` pinned to itself, so it still gets
        // the cache, the breaker and the quota ledger — a consensus check must
        // not be the thing that burns Alpha Vantage's day.
        const r = await getQuote(symbol, { ...opts, provider: id });
        return { adapter, quote: r.data, latencyMs: r.provenance.latencyMs };
      } catch (err) {
        attempts.push({
          provider: id,
          reason: "failed",
          detail: err instanceof Error ? err.message.slice(0, 160) : String(err),
        });
        return null;
      }
    }),
  );

  const ok = settled.filter((x): x is NonNullable<typeof x> => x !== null);
  if (!ok.length) {
    return {
      symbol, price: null, legs: [], spreadBps: null,
      outliers: [], toleranceBps, attempts,
    };
  }

  const prices = ok.map((x) => x.quote.price);
  const consensus = median(prices);
  const freshest = Math.max(...ok.map((x) => Date.parse(x.quote.asOf) || 0));

  const legs: ConsensusLeg[] = ok.map((x) => ({
    provider: x.adapter.meta.id,
    label: x.adapter.meta.label,
    price: x.quote.price,
    asOf: x.quote.asOf,
    delayed: x.quote.delayed,
    latencyMs: x.latencyMs,
    deviationBps: consensus ? ((x.quote.price - consensus) / consensus) * 10_000 : 0,
    stalenessSec: Math.max(0, Math.round((freshest - (Date.parse(x.quote.asOf) || freshest)) / 1000)),
  }));
  legs.sort((a, b) => Math.abs(a.deviationBps) - Math.abs(b.deviationBps));

  return {
    symbol,
    price: consensus,
    legs,
    spreadBps: consensus ? ((Math.max(...prices) - Math.min(...prices)) / consensus) * 10_000 : null,
    outliers: legs.filter((l) => Math.abs(l.deviationBps) > toleranceBps).map((l) => l.provider),
    toleranceBps,
    attempts,
  };
}
