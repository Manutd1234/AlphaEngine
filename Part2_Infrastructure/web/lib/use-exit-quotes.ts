/**
 * Custom hook for manual TCA exit quote probing.
 *
 * Never polls automatically — probes are triggered on explicit click.
 */

import { useState, useCallback } from "react";

export interface ExitQuoteResult {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  expectedSlippageBps: number | null;
  vwap: number | null;
  fillable: boolean;
  fetchedAt: string;
}

export function useExitQuotes() {
  const [quotes, setQuotes] = useState<Record<string, ExitQuoteResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const fetchExitQuote = useCallback(async (symbol: string, notional: number, isLong: boolean) => {
    const side = isLong ? "SELL" : "BUY";
    const key = `${symbol}-${side}`;
    setLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const res = await fetch(`/api/tca?symbol=${symbol}&side=${side}&notional=${Math.abs(notional)}`);
      if (!res.ok) throw new Error("Failed to fetch TCA exit quote");
      const data = await res.json();
      
      const quote: ExitQuoteResult = {
        symbol,
        side,
        notional: Math.abs(notional),
        expectedSlippageBps: data.summary?.expected_slippage_bps ?? null,
        vwap: data.summary?.vwap ?? null,
        fillable: Boolean(data.summary?.fillable),
        fetchedAt: new Date().toLocaleTimeString(),
      };

      setQuotes((prev) => ({ ...prev, [key]: quote }));
    } catch {
      // Graceful error state
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  return { quotes, loading, fetchExitQuote };
}
