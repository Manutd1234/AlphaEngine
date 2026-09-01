import { useEffect, useState } from "react";

import { pollingFailure } from "@/lib/polling";
import { usePolling } from "@/lib/use-polling";

export interface EquityQuotePreview {
  price: number;
  changePct: number | null;
  asOf: string;
  source: string;
  currency: string;
  delayed: boolean;
  synthetic: boolean;
}

/** REST-observation health, separate from the provider's market `asOf` time. */
export const EQUITY_QUOTE_STALE_MS = 90_000;
export const EQUITY_QUOTE_TTL_MS = 300_000;
export type EquityQuoteHealthState = "checking" | "fresh" | "error" | "stale" | "expired" | "unavailable";
export interface EquityQuoteHealth {
  state: EquityQuoteHealthState;
  lastSuccessAt: number | null;
  ageMs: number | null;
  staleAfterMs: number;
  ttlMs: number;
  refreshFailed: boolean;
  pending: boolean;
}

export function deriveEquityQuoteHealth(input: {
  lastSuccessAt: number | null; refreshFailed: boolean; pending: boolean; now: number;
}): EquityQuoteHealth {
  const ageMs = input.lastSuccessAt == null ? null : Math.max(0, input.now - input.lastSuccessAt);
  let state: EquityQuoteHealthState;
  if (ageMs == null) state = input.refreshFailed ? "error" : input.pending ? "checking" : "unavailable";
  else if (ageMs >= EQUITY_QUOTE_TTL_MS) state = "expired";
  else if (ageMs >= EQUITY_QUOTE_STALE_MS) state = "stale";
  else if (input.refreshFailed) state = "error";
  else state = "fresh";
  return {
    state, ageMs, lastSuccessAt: input.lastSuccessAt,
    staleAfterMs: EQUITY_QUOTE_STALE_MS, ttlMs: EQUITY_QUOTE_TTL_MS,
    refreshFailed: input.refreshFailed, pending: input.pending,
  };
}

export function equityQuoteAgeLabel(ageMs: number | null): string {
  if (ageMs == null) return "no successful refresh";
  if (ageMs < 1_000) return "just now";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1_000)} s ago`;
  return `${Math.floor(ageMs / 60_000)} min ago`;
}

export function equityQuoteHealthLabel(health: EquityQuoteHealth): string {
  const age = equityQuoteAgeLabel(health.ageMs);
  if (health.state === "fresh") return `Fresh; last success ${age}`;
  if (health.state === "stale") return `${health.refreshFailed ? "Refresh failed; retained quote stale" : "Stale"}; last success ${age}`;
  if (health.state === "expired") return `${health.refreshFailed ? "Refresh failed; retained quote expired" : "Expired"}; last success ${age}`;
  if (health.state === "error") return health.ageMs == null
    ? "REST quote refresh failed; no successful refresh" : `Refresh failed; last success ${age}`;
  return health.state === "checking" ? "Checking REST quote" : "REST quote unavailable";
}

function parseQuotePreview(body: unknown): EquityQuotePreview | null {
  const row = (body as { quotes?: Array<{
    data?: { price?: unknown; changePct?: unknown; asOf?: unknown; currency?: unknown; delayed?: unknown };
    provenance?: { label?: unknown; provider?: unknown; delayed?: unknown; synthetic?: unknown };
  }> } | null)?.quotes?.[0];
  const price = Number(row?.data?.price);
  const asOf = typeof row?.data?.asOf === "string" ? row.data.asOf : "";
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(Date.parse(asOf))) return null;
  const changePct = Number(row?.data?.changePct);
  return {
    price, asOf, changePct: Number.isFinite(changePct) ? changePct : null,
    source: typeof row?.provenance?.label === "string" ? row.provenance.label
      : typeof row?.provenance?.provider === "string" ? row.provenance.provider : "Provider",
    currency: typeof row?.data?.currency === "string" ? row.data.currency : "USD",
    delayed: row?.data?.delayed === true || row?.provenance?.delayed === true,
    synthetic: row?.provenance?.synthetic === true,
  };
}

interface QuotePollState {
  symbol: string; quote: EquityQuotePreview | null; lastSuccessAt: number | null;
  pending: boolean; refreshFailed: boolean; now: number;
}

/** Owns the equity REST observation; view components receive only decided props. */
export function useEquityQuotePreview(symbol: string, enabled: boolean) {
  const [poll, setPoll] = useState<QuotePollState>(() => ({
    symbol: "", quote: null, lastSuccessAt: null, pending: false, refreshFailed: false, now: Date.now(),
  }));
  const current = enabled && poll.symbol === symbol
    ? poll
    : { symbol, quote: null, lastSuccessAt: null, pending: enabled, refreshFailed: false, now: poll.now };

  usePolling({
    tick: async ({ signal }) => {
      const attemptedAt = Date.now();
      setPoll((prior) => prior.symbol === symbol
        ? { ...prior, pending: true, now: attemptedAt }
        : { symbol, quote: null, lastSuccessAt: null, pending: true, refreshFailed: false, now: attemptedAt });
      const fail = () => setPoll((prior) => prior.symbol === symbol
        ? { ...prior, pending: false, refreshFailed: true, now: Date.now() }
        : prior);
      try {
        const response = await fetch(`/api/quote?symbols=${encodeURIComponent(symbol)}`, { cache: "no-store", signal });
        if (signal.aborted) return;
        if (!response.ok) { fail(); return pollingFailure(String(response.status)); }
        const body = await response.json();
        if (signal.aborted) return;
        const quote = parseQuotePreview(body);
        if (!quote) { fail(); return pollingFailure(String(quote)); }
        const lastSuccessAt = Date.now();
        setPoll({ symbol, quote, lastSuccessAt, pending: false, refreshFailed: false, now: lastSuccessAt });
      } catch (cause) {
        if (!signal.aborted) fail();
        throw cause;
      }
    },
    intervalMs: 30_000, maxBackoffMs: EQUITY_QUOTE_TTL_MS,
    enabled, immediate: true, restartKey: symbol,
  });

  useEffect(() => {
    if (!enabled || current.lastSuccessAt == null) return;
    const age = Math.max(0, Date.now() - current.lastSuccessAt);
    const wait = age < EQUITY_QUOTE_STALE_MS
      ? EQUITY_QUOTE_STALE_MS - age : age < EQUITY_QUOTE_TTL_MS ? EQUITY_QUOTE_TTL_MS - age : null;
    if (wait == null) return;
    const timer = window.setTimeout(() => setPoll((prior) => prior.symbol === symbol
      ? { ...prior, now: Date.now() } : prior), wait + 20);
    return () => window.clearTimeout(timer);
  }, [current.lastSuccessAt, current.now, enabled, symbol]);

  return { quote: current.quote, pending: current.pending, health: deriveEquityQuoteHealth(current) };
}
