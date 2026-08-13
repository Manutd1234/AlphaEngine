/**
 * Manual TCA exit probing: what would it cost to get out of this position now?
 *
 * Never polls. Each probe is one click, because it walks two live order books
 * and the answer is only meaningful at the moment it is asked.
 *
 * THE CONTRACT BUG THIS FIXES. The first version read
 *
 *   data.summary.expected_slippage_bps / .vwap / .fillable
 *
 * and `TcaReport` has no `summary` object — the fields are top-level and
 * camelCase (`smartRouteSlippageBps`, `smartRouteVwap`, `smartRoute`). So the
 * probe fired a real request, received a real 200, and read `undefined` three
 * times: the panel rendered "—" for every quote, forever, with no error to say
 * why. Snake_case in a route that returns camelCase is the tell that it was
 * written against an imagined response rather than this one.
 *
 * `error` exists for the same reason. The old hook swallowed every failure into
 * a comment reading "Graceful error state" with no state behind it, so a 503
 * from `/api/tca` ("no live book for X" — the ordinary case for an equity, or
 * for any symbol outside the streamed set) was indistinguishable from a button
 * nobody had pressed.
 */

import { useState, useCallback } from "react";

import { absorbs, type TcaReport } from "@/lib/venues";

export interface ExitQuoteResult {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  /** Cost of the smart route, in bps against the consolidated mid. */
  expectedSlippageBps: number | null;
  vwap: number | null;
  /** Whether the routed legs actually cover the requested notional. */
  fillable: boolean;
  /** What the book could absorb, when it could not absorb all of it. */
  routedNotional: number;
  fetchedAt: string;
}

export function useExitQuotes() {
  const [quotes, setQuotes] = useState<Record<string, ExitQuoteResult>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const fetchExitQuote = useCallback(async (symbol: string, notional: number, isLong: boolean) => {
    // Exiting a long is a sell; exiting a short is a buy.
    const side = isLong ? "SELL" : "BUY";
    const key = `${symbol}-${side}`;
    const target = Math.abs(notional);

    setLoading((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });

    try {
      const res = await fetch(
        `/api/tca?symbol=${encodeURIComponent(symbol)}&side=${side}&notional=${target}`,
        { cache: "no-store" },
      );
      const body = (await res.json()) as Partial<TcaReport> & { error?: string };

      if (!res.ok) {
        // The route says why (503 "no live book for X"), so pass it through
        // rather than replacing it with a generic failure.
        setErrors((prev) => ({ ...prev, [key]: body.error ?? `probe failed (${res.status})` }));
        return;
      }

      const legs = body.smartRoute ?? [];
      const routed = legs.reduce((sum, leg) => sum + leg.notional, 0);

      setQuotes((prev) => ({
        ...prev,
        [key]: {
          symbol,
          side,
          notional: target,
          // Null, never zero: a book that could not price this is not a book
          // that priced it at the mid.
          expectedSlippageBps: body.smartRouteSlippageBps ?? null,
          vwap: body.smartRouteVwap ?? null,
          // The same tolerance the gateway's own fill check uses, so this panel
          // and the Python engine cannot disagree about what "filled" means.
          fillable: legs.length > 0 && absorbs(routed, target),
          routedNotional: routed,
          fetchedAt: new Date().toLocaleTimeString(),
        },
      }));
    } catch (cause) {
      setErrors((prev) => ({
        ...prev,
        [key]: cause instanceof Error ? cause.message : "probe did not complete",
      }));
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  return { quotes, loading, errors, fetchExitQuote };
}
