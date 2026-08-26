/**
 * The portfolio's payoff in each state, rebuilt the way the kernel does.
 *
 * Split out of `PayoffByState.tsx` on 2026-08-26, when that file stood at 399
 * of the house's 400 lines and the crosshair it was about to gain needed room.
 * Nothing here draws: it is the arithmetic of ``kernel/dutchbook.py::
 * _worst_case_gross`` in the browser, plus the two parsers that arithmetic
 * needs — a fee arrives at six decimals and a price at four, and one parser
 * for both would reject one of them. `BasketCostLadder` is its second caller.
 */

import { DOLLAR_CC, fromCenticents, toCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCertificate } from "@/lib/coherence/types";

/** Micro-dollars per centicent. Every amount below is integer micro-dollars. */
export const MICRO_PER_CC = 100;

/** One settlement state: the market that resolves YES in it. */
export interface PayoffState {
  ticker: string;
  label: string;
}

export interface Column {
  label: string;
  /** Gross payoff in micro-dollars, before fees. Null when a leg is unreadable. */
  gross: number | null;
}

/**
 * A dollar string to integer micro-dollars ($0.000001).
 *
 * `toCenticents` is the right parser for a price and the wrong one for a fee.
 * The rounding component floors a notional to the account's balance precision,
 * so `total_fees` arrives at SIX decimals, and a centicent parser rejects that
 * as "not a price from a book". Rejecting the fee would leave the gross bar
 * with nothing taken off it — the one direction that invents an edge.
 */
export function toMicros(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const match = /^(-?)(\d*)(?:\.(\d{0,6}))?$/.exec(raw.trim());
  if (!match) return null;
  const [, sign, whole, fraction = ""] = match;
  if (!whole && !fraction) return null;
  const micros = Number(whole || "0") * 1_000_000 + Number(`${fraction}000000`.slice(0, 6));
  return sign === "-" ? -micros : micros;
}

/** A computed amount at the exchange's canonical four decimals. */
export function money(micros: number | null): string {
  if (micros == null) return "—";
  return fromCenticents(Math.round(micros / MICRO_PER_CC)) ?? "—";
}

/**
 * The portfolio's gross payoff in each state, rebuilt the way the kernel does.
 *
 * ``kernel/dutchbook.py::_worst_case_gross``, in the browser: a bought leg
 * contributes ``(payoff - price) * size`` and a sold leg the mirror of it, at
 * RAW prices, before any fee. Held in micro-dollars because a price is exact to
 * a centicent and a size to a hundredth of a contract, and their product is
 * exact to neither on its own.
 */
export function payoffsByState(certificate: CoherenceCertificate, states: PayoffState[]) {
  const unreadable: string[] = [];
  const priced = certificate.legs.map((leg) => {
    const price = toCenticents(leg.price);
    const size = toCenticents(leg.size);
    if (price == null || size == null) {
      unreadable.push(leg.label || leg.ticker);
      return null;
    }
    return { ticker: leg.ticker, price, size, selling: leg.direction === "sell" };
  });

  const columns: Column[] = states.map((state) => {
    let total = 0;
    for (const leg of priced) {
      if (leg == null) return { label: state.label, gross: null };
      const payoff = leg.ticker === state.ticker ? DOLLAR_CC : 0;
      const per = leg.selling ? leg.price - payoff : payoff - leg.price;
      total += (per * leg.size) / MICRO_PER_CC;
    }
    return { label: state.label, gross: total };
  });

  return { columns, unreadable };
}

/**
 * What each leg pays in ONE state, for the crosshair's rows: the same
 * arithmetic as `payoffsByState`, per leg rather than summed. A leg that
 * cannot be read is null, and a null is printed as a dash by the caller.
 */
export function legPayoffsInState(certificate: CoherenceCertificate, state: PayoffState): Array<{ label: string; micros: number | null }> {
  return certificate.legs.map((leg) => {
    const price = toCenticents(leg.price);
    const size = toCenticents(leg.size);
    if (price == null || size == null) return { label: leg.label || leg.ticker, micros: null };
    const payoff = leg.ticker === state.ticker ? DOLLAR_CC : 0;
    const per = leg.direction === "sell" ? price - payoff : payoff - price;
    return { label: leg.label || leg.ticker, micros: (per * size) / MICRO_PER_CC };
  });
}
