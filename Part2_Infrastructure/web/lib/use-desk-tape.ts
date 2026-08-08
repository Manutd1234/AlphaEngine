"use client";

/**
 * The live decision tape — new blotter rows as Postgres commits them.
 *
 * This is the blueprint's `useAlphaEngineRealtime`, with the two things it got
 * wrong for this codebase fixed.
 *
 * **It does not replace the poll.** The blueprint's hook returns the blotter,
 * implying the subscription is the source. Here the gateway's DuckDB blotter
 * stays authoritative and `useBook` still polls it; this is a *tape* of what
 * has just been decided. The distinction matters because a realtime channel
 * silently drops while it reconnects, so anything that must be complete cannot
 * be sourced from one.
 *
 * **`unavailable` is a state, never an empty list.** The same rule
 * `describeSearchOutcome` states for the research index: "nothing has been
 * decided yet" and "this deployment has no realtime" are different facts, and a
 * tape rendering the second as the first is quietly lying about a live desk.
 *
 * The subscription's scope is Postgres RLS, not the filter below. See
 * `supabase/migrations/20260808120700_anon_demo_realtime.sql` — anon can read
 * gateway-decided, unowned rows on the public demo desk and nothing else, so a
 * client that asked for more would simply receive nothing.
 */

import { useEffect, useRef, useState } from "react";

import { supabaseBrowser, supabaseConfigured } from "@/lib/supabaseClient";

export type TapeState =
  /** No public Supabase config in this deployment. Not a fault. */
  | "unconfigured"
  /** Subscribing, or reconnecting after a drop. */
  | "connecting"
  /** Subscribed; rows arrive as they commit. */
  | "live"
  /** The channel errored or timed out. Rows are being missed right now. */
  | "unavailable";

export interface TapeRow {
  id: string;
  symbol: string;
  side: string;
  notional: number;
  verdict: string;
  status: string | null;
  latencyMs: number | null;
  occurredAt: string;
  /** True the first time this row is painted, so the UI can flash it once. */
  fresh: boolean;
}

/** Bounded: a tape is a window on the recent past, not an accumulating log. */
const MAX_ROWS = 25;

export function useDeskTape(symbol?: string): {
  state: TapeState;
  rows: TapeRow[];
  /** Total seen this session — the count a poll cannot give you. */
  seen: number;
} {
  const [state, setState] = useState<TapeState>(
    supabaseConfigured() ? "connecting" : "unconfigured",
  );
  const [rows, setRows] = useState<TapeRow[]>([]);
  const [seen, setSeen] = useState(0);
  // Symbol lives in a ref so changing the instrument does not tear down and
  // rebuild the channel — a resubscribe costs a round trip and loses whatever
  // commits during it.
  const symbolRef = useRef(symbol);
  symbolRef.current = symbol;

  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) {
      setState("unconfigured");
      return;
    }

    const channel = supabase
      .channel("desk-tape")
      .on(
        "postgres_changes",
        // INSERT only: the table is append-only by trigger, so UPDATE and
        // DELETE are not merely unused — they cannot happen.
        { event: "INSERT", schema: "public", table: "order_blotter" },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const rowSymbol = String(row.symbol ?? "");
          // Filtered here rather than in the subscription so switching
          // instruments does not resubscribe. The security filter is RLS; this
          // one is only about relevance.
          const wanted = symbolRef.current;
          if (wanted && rowSymbol !== wanted) return;

          setSeen((count) => count + 1);
          setRows((current) => [
            {
              id: String(row.id ?? crypto.randomUUID()),
              symbol: rowSymbol,
              side: String(row.side ?? ""),
              notional: Number(row.notional ?? 0),
              verdict: String(row.verdict ?? ""),
              status: row.status == null ? null : String(row.status),
              latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
              occurredAt: String(row.occurred_at ?? new Date().toISOString()),
              fresh: true,
            },
            // Everything already on the tape stops being new, so the flash
            // applies to the arriving row alone.
            ...current.map((existing) => (existing.fresh ? { ...existing, fresh: false } : existing))
              .slice(0, MAX_ROWS - 1),
          ]);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setState("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setState("unavailable");
        else if (status === "CLOSED") setState("connecting");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
    // Deliberately empty: the channel is built once. `symbol` is read through
    // the ref above, so listing it here would resubscribe on every instrument
    // change for no benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { state, rows, seen };
}

/** The sentence the panel shows for each state — centralised so none of them blur. */
export function describeTape(state: TapeState, rowCount: number): string {
  switch (state) {
    case "unconfigured":
      return "Realtime is not configured in this deployment, so nothing is being streamed.";
    case "connecting":
      return "Subscribing to the decision stream…";
    case "unavailable":
      return "The realtime channel dropped — decisions are being missed until it reconnects.";
    case "live":
      return rowCount
        ? `Streaming live. ${rowCount} decision${rowCount === 1 ? "" : "s"} on the tape.`
        : "Streaming live. No decisions have been recorded since this page opened.";
  }
}
