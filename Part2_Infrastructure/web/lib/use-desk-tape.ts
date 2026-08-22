"use client";

/**
 * The decision tape — the last few decisions the mirror already holds, then new
 * ones as Postgres commits them.
 *
 * This is the blueprint's `useAlphaEngineRealtime`, with three things it got
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
 * **It opens with a starting state, and that state never passes for the
 * stream.** A subscription delivers only what commits after it is established,
 * so a desk that traded a minute ago and then opened this pane met an empty
 * card under a green LIVE badge — every component behaving as designed, and the
 * surface reading "the desk is quiet", the one thing the panel's own docstring
 * says must never happen. Measured 2026-08-22: `public.order_blotter` held 62
 * rows, the newest two on BTCUSDT seconds old, and the tape showed none. So the
 * hook issues one bounded read on mount, marking every row `origin: "opening"`.
 *
 * WHERE THE OPENING READ COMES FROM. The same anon-readable
 * `public.order_blotter`, through the same `supabaseBrowser()` client the
 * channel uses — NOT the gateway's authoritative blotter route that
 * `use-cockpit-feed` polls one card away. That route is the more trustworthy
 * source, and that is precisely why it is the wrong one here. It reads DuckDB,
 * which the mirror lags, so the seam between a DuckDB page and the first
 * mirrored row would carry a gap or an overlap neither side can see — the tape
 * would be incomplete in a way it could not report. It is also the Blotter
 * pane's own source, polled four seconds apart beside this card, so a copy of
 * it here is a second moment of one fact, the disagreement `use-cockpit-feed`'s
 * single poll was built to end. And a page OF the record sitting INSIDE the
 * stream is the tape impersonating the record, which is what the pane split
 * exists to prevent.
 *
 * Reading the relation the subscription reads makes the opening page precisely
 * "the messages this client would have received had it subscribed a minute
 * earlier": same table, same RLS policy
 * (`20260808120700_anon_demo_realtime.sql` grants anon SELECT, and that policy
 * IS the subscription filter, so neither half can see past it), same columns,
 * and the index the query wants already exists (`idx_blotter_symbol_time`). It
 * fails as one thing too: a deployment with no public Supabase config has
 * neither half, and says so once rather than twice.
 *
 * THE SEAM THIS CANNOT CLOSE. A decision committing between the socket's
 * handshake and the read's snapshot can be missed by both. The read is issued
 * from an effect declared AFTER the channel's, so the socket is already opening
 * by then, which narrows the window to the handshake; nothing on the client
 * closes it. That is the standing reason the card keeps saying the Blotter pane
 * is the record and this is not.
 *
 * TWO ABSENCES, TWO NAMES. The read and the stream fail independently, so
 * `TapeOpening` is a separate typed state from `TapeState` rather than a flag
 * folded into it. A failed read under a live channel is a tape missing
 * everything from before it opened; a dropped channel over a good read is a
 * tape missing everything since. Neither may render as the other, and neither
 * may render as a quiet desk.
 */

import { useEffect, useMemo, useRef, useState } from "react";

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

/**
 * How a row reached the tape. Not derivable from the row — both origins carry
 * identical columns out of one table — so it is recorded on arrival and travels
 * with the row. The field the whole change turns on: a backfilled row and a
 * streamed row must never be indistinguishable, or the tape starts
 * impersonating the record it sits beside.
 */
export type TapeOrigin = "stream" | "opening";

export interface TapeRow {
  id: string;
  symbol: string;
  side: string;
  /**
   * Null when the mirror holds no notional — the column is nullable and a
   * rejected order can carry none. Never `?? 0`: a zero there claims the desk
   * decided on nothing, which is a measurement rather than an absence.
   */
  notional: number | null;
  verdict: string;
  status: string | null;
  latencyMs: number | null;
  occurredAt: string;
  origin: TapeOrigin;
  /** True the first time this row is painted, so the UI can flash it once. */
  fresh: boolean;
}

/** What the opening read did. Independent of `TapeState` on purpose. */
export type OpeningState =
  /** No public Supabase config, so there is no mirror to read. */
  | "unconfigured"
  /** The read is in flight. */
  | "reading"
  /** It returned. `count` is what it returned, which may be none. */
  | "read"
  /** It failed. The tape is missing everything from before the pane opened. */
  | "unavailable";

export interface TapeOpening {
  state: OpeningState;
  /**
   * Rows the read returned. A fact about the READ, not about the tape now —
   * later streamed rows can push an opening row past `MAX_ROWS`, and the
   * sentence this feeds is in the past tense for that reason.
   */
  count: number;
  /** PostgREST's own words for a failure. Never invented, null when unknown. */
  reason: string | null;
}

/** Bounded: a tape is a window on the recent past, not an accumulating log. */
const MAX_ROWS = 25;

/**
 * How many the opening read asks for, and why ten.
 *
 * Ten answers the question that produced this defect — "I placed orders a
 * minute ago, where are they?" The blotter behind the report held two BTCUSDT
 * decisions in the same second (one ACCEPTED, one rate_limit), and a
 * hand-driven ticket cannot produce many more per minute before the gateway's
 * rate limiter refuses; ten covers the busiest manual burst measured there.
 *
 * It is also well under `MAX_ROWS`, which is the half that matters. Fifteen
 * slots stay free for the stream, so a watched tape is never starved of live
 * rows by its own starting state, and because eviction takes the oldest first
 * the opening page is the first thing to go. The tape decays back into being
 * purely a stream as the session runs — that is what keeps a starting state a
 * starting state rather than a second, permanent source.
 */
const OPENING_ROWS = 10;

/**
 * The read's deadline, and why this number.
 *
 * 2,500ms is the budget `probeGateway` already applies to every desk-facing
 * read here; reusing it avoids a second opinion about how long a card may take
 * to resolve. The query is a ten-row scan of `idx_blotter_symbol_time`, so
 * anything slower is the network rather than the query. Unbounded is not an
 * option: against a server that accepts and never answers it leaves the card
 * reading for the life of the tab, which is the silent nothing this change
 * exists to end.
 */
const OPENING_DEADLINE_MS = 2_500;

/** Named columns, never a wildcard: the tape reads what it renders. */
const OPENING_COLUMNS = "id,symbol,side,notional,verdict,status,latency_ms,occurred_at";

/**
 * One mapper for both origins. The socket payload and the PostgREST row are the
 * same columns of one table, so a second mapper would be a second chance for
 * the two halves of one tape to disagree about a verdict or a null notional.
 */
function toTapeRow(row: Record<string, unknown>, origin: TapeOrigin): TapeRow {
  return {
    id: String(row.id ?? crypto.randomUUID()),
    symbol: String(row.symbol ?? ""),
    side: String(row.side ?? ""),
    notional: row.notional == null ? null : Number(row.notional),
    verdict: String(row.verdict ?? ""),
    status: row.status == null ? null : String(row.status),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    occurredAt: String(row.occurred_at ?? new Date().toISOString()),
    origin,
    // An opening row is never fresh. The flash means "this just landed while
    // you were watching", and a row read out of the past did not.
    fresh: origin === "stream",
  };
}

/**
 * What the tape shows: everything streamed since the pane opened, then the
 * opening page beneath it.
 *
 * Deliberately NOT a sort on `occurredAt`. The halves arrive as two different
 * text renderings of the same instant — Realtime forwards Postgres' own
 * `timestamptz` output (`2026-08-22 06:35:07.123456+00`), PostgREST returns
 * ISO-8601 (`...T06:35:07.123456+00:00`) — so a lexicographic compare across
 * the seam sorts by punctuation, and `Date.parse` would read the first as local
 * time. Concatenation needs neither: the page was read at mount, so every
 * streamed row is newer than every row in it, and PostgREST already returned it
 * newest-first.
 *
 * A row can legitimately appear in both — one committing after the socket
 * subscribes but before the read's snapshot. The streamed copy wins: the reader
 * really did watch that one land, and saying otherwise under-reports the
 * stream.
 */
export function mergeTape(streamed: TapeRow[], opening: TapeRow[]): TapeRow[] {
  const streamedIds = new Set(streamed.map((row) => row.id));
  return [...streamed, ...opening.filter((row) => !streamedIds.has(row.id))].slice(0, MAX_ROWS);
}

export function useDeskTape(symbol?: string): {
  state: TapeState;
  /** The whole tape, newest first, every row carrying its own origin. */
  rows: TapeRow[];
  /** Total seen on the stream this session — the count a poll cannot give you. */
  seen: number;
  /** What the opening read did, as its own state with its own reason. */
  opening: TapeOpening;
} {
  const configured = supabaseConfigured();
  const [state, setState] = useState<TapeState>(configured ? "connecting" : "unconfigured");
  /**
   * Two arrays, not one. Keeping the halves apart makes the origin structural
   * rather than a flag a later refactor can drop — no path appends to the
   * stream's list without saying `"stream"` — and it makes the rendered tape
   * derived state, so the rule `execution-stability.test.ts` pins (rows survive
   * a channel flap) is held by the hook's shape rather than by remembering it.
   */
  const [streamed, setStreamed] = useState<TapeRow[]>([]);
  const [openingRows, setOpeningRows] = useState<TapeRow[]>([]);
  const [opening, setOpening] = useState<TapeOpening>(() => ({
    state: configured ? "reading" : "unconfigured",
    count: 0,
    reason: null,
  }));
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
          setStreamed((current) => [
            toTapeRow(row, "stream"),
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

  /**
   * The opening read, declared after the channel effect so the socket is
   * already opening when the snapshot is taken; see THE SEAM above.
   *
   * Keyed on `symbol` where the channel is not, and the asymmetry is the point:
   * a resubscribe is a socket round trip that loses commits, this is one
   * bounded read against an index that exists for it. The card says "Filtered
   * to {symbol}", so a page for the previous instrument would falsify the
   * sentence directly above the table.
   */
  useEffect(() => {
    const supabase = supabaseBrowser();
    if (!supabase) {
      setOpening({ state: "unconfigured", count: 0, reason: null });
      return;
    }

    let cancelled = false;
    setOpening({ state: "reading", count: 0, reason: null });
    setOpeningRows([]);
    // Rows for the instrument just left are dropped here and nowhere else.
    // Not a transport state discarding measured data: they are still in the
    // record and still on the Blotter pane, they are simply no longer this
    // tape's subject, which the line above the table names.
    setStreamed((current) => current.filter((row) => !symbol || row.symbol === symbol));

    void (async () => {
      try {
        const base = supabase.from("order_blotter").select(OPENING_COLUMNS);
        const scoped = symbol ? base.eq("symbol", symbol) : base;
        const { data, error } = await scoped
          .order("occurred_at", { ascending: false })
          .limit(OPENING_ROWS)
          .abortSignal(AbortSignal.timeout(OPENING_DEADLINE_MS));
        if (cancelled) return;
        if (error) {
          // An abort is not proof the mirror is empty, and the state must not
          // become one: it says the read failed, and the copy says what is
          // therefore missing from the tape.
          setOpening({ state: "unavailable", count: 0, reason: error.message || null });
          return;
        }
        const page = ((data ?? []) as unknown as Record<string, unknown>[])
          .map((row) => toTapeRow(row, "opening"));
        setOpeningRows(page);
        setOpening({ state: "read", count: page.length, reason: null });
      } catch (cause) {
        // A belt: the builder turns a fetch failure into `{ error }` rather
        // than throwing, and a throw that escaped would leave the card reading
        // forever — the silent nothing this change exists to end.
        if (cancelled) return;
        setOpening({
          state: "unavailable",
          count: 0,
          reason: cause instanceof Error ? cause.message : null,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const rows = useMemo(() => mergeTape(streamed, openingRows), [streamed, openingRows]);

  return { state, rows, seen, opening };
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
