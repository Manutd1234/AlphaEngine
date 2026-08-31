"use client";

import { useCallback, useMemo, useState } from "react";

import type { CoherenceEventView } from "@/lib/coherence/types";
import { DOLLAR_CC, toCenticents } from "@/lib/coherence/fixed-point";

/**
 * Paper quotes are kept per family so Cover, Basket, and Size inspect the same
 * scenario even though only one view is mounted at a time.
 */
interface StoredScenario {
  tickers: string[];
  asks: number[];
}

const scenarios = new Map<string, StoredScenario>();

function quoteVector(event: CoherenceEventView): number[] | null {
  const values = event.markets.map((market) => {
    const cc = toCenticents(market.yes_ask);
    return cc == null ? Number.NaN : cc / DOLLAR_CC;
  });
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

export interface BasketScenario {
  baseline: number[];
  asks: number[];
  moved: boolean;
  setAsk: (index: number, value: number) => void;
  reset: () => void;
}

export function useBasketScenario(event: CoherenceEventView): BasketScenario | null {
  const baseline = useMemo(() => quoteVector(event), [event]);
  const remembered = scenarios.get(event.event_ticker);
  const tickers = event.markets.map((market) => market.ticker);
  const rememberedMatches = baseline
    && remembered?.asks.length === baseline.length
    && remembered.tickers.every((ticker, index) => ticker === tickers[index]);
  const [local, setLocal] = useState<number[] | null>(() => rememberedMatches ? remembered.asks.slice() : null);

  const asks = local?.length === baseline?.length ? local : baseline;

  const setAsk = useCallback((index: number, value: number) => {
    setLocal((current) => {
      const source = current?.length === baseline?.length ? current : baseline;
      if (!source) return current;
      const next = source.slice();
      next[index] = value;
      scenarios.set(event.event_ticker, { tickers, asks: next });
      return next;
    });
  }, [baseline, event.event_ticker, tickers]);

  const reset = useCallback(() => {
    scenarios.delete(event.event_ticker);
    setLocal(null);
  }, [baseline, event.event_ticker]);

  if (!baseline || !asks) return null;
  return {
    baseline,
    asks,
    moved: asks.some((value, index) => value !== baseline[index]),
    setAsk,
    reset,
  };
}
