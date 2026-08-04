"use client";

/**
 * The cockpit: everything a trader needs about their own flow, in one place.
 *
 * The Execution tab used to show market data only — books, spreads, cost
 * estimates. Everything about what the desk had actually *done* lived on other
 * surfaces: positions on the portfolio tab, the decision trail in the gateway
 * console, alerts in Telegram. A trader watching a book cannot answer "did that
 * order fill, and what did it cost" without leaving the screen they are
 * watching, which is exactly when they should not be leaving it.
 *
 * So this composes four panels around one polled snapshot of gateway state:
 *
 *   P&L strip   what the book is worth and how close it is to a halt
 *   Ticket      send an order and see every gate's verdict
 *   Blotter     what was sent, what it cost, and which gate stopped it
 *   Alert feed  what the system decided on its own
 *
 * One poll drives all four. Four panels polling independently would show four
 * different moments of the same book, and a trader comparing a position against
 * the fill that created it would be comparing across time without knowing it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type BlotterRow, type RiskEventRow, summarise, toBlotterRow, toRiskEvent } from "@/lib/blotter";

import AlertFeed from "./AlertFeed";
import ExecutionQuality from "./ExecutionQuality";
import OrderBlotter from "./OrderBlotter";
import OrderTicket from "./OrderTicket";
import PnlStrip from "./PnlStrip";

const REFRESH_MS = 4_000;
const BLOTTER_LIMIT = 60;
const EVENT_LIMIT = 40;

interface PortfolioSnapshot {
  trading_halted: boolean;
  halted_symbols: string[];
  equity: { current: number; daily_pnl: number; daily_return: number; realized_pnl: number; unrealized_pnl: number };
  exposure: { gross: number; net: number; leverage: number; positions: Array<{
    symbol: string; side: string; notional: number; share_of_gross: number; total_pnl: number;
  }> };
  risk_budget: { daily_drawdown: { used_pct: number; limit_pct: number; utilisation: number; cushion_usd: number } };
}

export interface CockpitProps {
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  /** Strategy tag proposed by the research tab, when a run has been promoted. */
  researchStrategy?: string | null;
  /** Experiment id to stamp on the order so a fill can be traced to its idea. */
  researchExperimentId?: string | null;
  onOpenResearch?: () => void;
}

interface Unavailable { code?: string; error: string; hint?: string }

export default function ExecutionCockpit({
  symbol,
  side,
  notional,
  researchStrategy,
  researchExperimentId,
  onOpenResearch,
}: CockpitProps) {
  const [book, setBook] = useState<PortfolioSnapshot | null>(null);
  const [orders, setOrders] = useState<BlotterRow[]>([]);
  const [events, setEvents] = useState<RiskEventRow[]>([]);
  const [problem, setProblem] = useState<Unavailable | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++sequence.current;
    try {
      const [bookRes, orderRes, eventRes] = await Promise.all([
        fetch("/api/gateway/portfolio", { cache: "no-store" }),
        fetch(`/api/gateway/audit?feed=orders&limit=${BLOTTER_LIMIT}`, { cache: "no-store" }),
        fetch(`/api/gateway/audit?feed=events&limit=${EVENT_LIMIT}`, { cache: "no-store" }),
      ]);
      if (current !== sequence.current) return;

      const bookBody = await bookRes.json().catch(() => ({}));
      if (!bookRes.ok) {
        setProblem({
          code: bookBody.code,
          error: bookBody.error ?? `The gateway answered HTTP ${bookRes.status}.`,
          hint: bookBody.hint,
        });
        setBook(null);
      } else {
        setBook(bookBody as PortfolioSnapshot);
        setProblem(null);
      }

      // The audit panels are allowed to be empty without taking the whole
      // cockpit down: a gateway with no history yet is a working gateway.
      if (orderRes.ok) {
        const body = await orderRes.json().catch(() => ({ rows: [] }));
        setOrders(((body.rows ?? []) as unknown[]).map(toBlotterRow).filter((r): r is BlotterRow => r !== null));
      }
      if (eventRes.ok) {
        const body = await eventRes.json().catch(() => ({ rows: [] }));
        setEvents(((body.rows ?? []) as unknown[]).map(toRiskEvent).filter((r): r is RiskEventRow => r !== null));
      }
      setLastSyncAt(new Date());
    } catch {
      if (current === sequence.current) {
        setProblem({ error: "The cockpit could not reach its same-origin gateway routes." });
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      // A backgrounded tab polling a trading gateway is pure cost.
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      sequence.current += 1;
    };
  }, [refresh]);

  const summary = useMemo(() => summarise(orders), [orders]);
  const symbolOrders = useMemo(() => orders.filter((o) => o.symbol === symbol), [orders, symbol]);

  if (loading && !book && !problem) {
    return <div className="card cockpit-placeholder">Connecting to the risk gateway…</div>;
  }

  return (
    <div className="cockpit">
      <PnlStrip
        book={book}
        problem={problem}
        lastSyncAt={lastSyncAt}
        onRefresh={() => void refresh()}
      />

      <div className="cockpit-grid">
        <OrderTicket
          symbol={symbol}
          defaultSide={side}
          defaultNotional={notional}
          strategy={researchStrategy ?? null}
          experimentId={researchExperimentId ?? null}
          halted={book?.trading_halted ?? false}
          haltedSymbols={book?.halted_symbols ?? []}
          onSubmitted={() => void refresh()}
          onOpenResearch={onOpenResearch}
        />
        <ExecutionQuality summary={summary} symbol={symbol} symbolOrders={symbolOrders} />
      </div>

      <OrderBlotter rows={orders} focusSymbol={symbol} onOpenResearch={onOpenResearch} />
      <AlertFeed events={events} />
    </div>
  );
}
