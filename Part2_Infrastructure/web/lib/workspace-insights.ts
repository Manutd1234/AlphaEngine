/**
 * The four-figure briefs that open Portfolio, Risk and Execution.
 *
 * These are `WorkspaceIntro`'s `insights` arrays and nothing else: no JSX, no
 * hooks, no routing. They left `app/dashboard/page.tsx` when the shell was cut
 * from 683 lines into a shell and its panels, because a panel's four tiles are
 * the longest thing in it and the least like the shell's job.
 *
 * Two rules travelled with them, and both are visible below. Nothing is
 * coerced: an unread book reports "Pending" or "Connecting" with the reason
 * beside it rather than a zero. And every tone is paired with a word — the
 * value already says "Halted", "Sandbox" or "Measured", so the colour is
 * never the only carrier.
 */

import type { WorkspaceInsight } from "@/components/WorkspaceIntro";
import { constraintLabel, fmt, usd } from "@/lib/format";
import type { useBook } from "@/lib/use-book";
import { STRATEGY_LABELS, type Strategy } from "@/lib/types";
import type { Side } from "@/lib/venues";

/** The live book view, exactly as the shell's `useBook()` returns it. */
type BookView = ReturnType<typeof useBook>;

/** The audited row for the sleeve Execution is carrying, when there is one. */
type SleeveAttribution = { filled: number } | null;

interface SleeveContext {
  book: BookView;
  executionStrategy: Strategy;
  /** "N accepted of M orders", or why there is no such count yet. */
  selectedSleeveDetail: string;
  selectedSleeveAttribution: SleeveAttribution;
}

/** Portfolio: where the book came from, what is in it, and what measured it. */
export function portfolioInsights({
  book, executionStrategy, selectedSleeveDetail, selectedSleeveAttribution,
}: SleeveContext): WorkspaceInsight[] {
  return [
    {
      label: "Book source",
      value: book.sandbox ? "Sandbox" : book.connectionState,
      detail: book.isStale ? "last good snapshot" : "shared with Risk",
      tone: book.isStale || book.sandbox ? "warn" : "good",
    },
    {
      label: "Positions",
      value: String(book.book?.exposure.positions.length ?? 0),
      detail: book.book ? "current book" : "connecting",
      tone: "accent",
      mono: true,
    },
    {
      label: "Risk model",
      value: book.riskLoading ? "Measuring" : book.risk ? "Measured" : "Pending",
      detail: book.risk ? `${book.risk.observations} aligned bars` : "no assumptions substituted",
      tone: book.risk ? "good" : "warn",
    },
    {
      label: "Execution sleeve",
      value: STRATEGY_LABELS[executionStrategy],
      detail: selectedSleeveDetail,
      tone: selectedSleeveAttribution?.filled ? "good" : "accent",
    },
  ];
}

/** Risk: whether trading is open, what binds first, and the tail beneath it. */
export function riskInsights({
  book, executionStrategy, selectedSleeveDetail, selectedSleeveAttribution,
}: SleeveContext): WorkspaceInsight[] {
  return [
    {
      label: "Trading state",
      value: book.book?.trading_halted ? "Halted" : book.book ? "Active" : "Connecting",
      detail: book.sandbox ? "sandbox book" : "gateway decision",
      tone: book.book?.trading_halted ? "critical" : book.book ? "good" : "warn",
    },
    {
      label: "Binding constraint",
      value: book.book
        ? constraintLabel(book.book.risk_budget.binding_constraint[0])
        : "Pending",
      detail: book.book
        ? `${fmt(book.book.risk_budget.binding_constraint[1] * 100, 1)}% utilised`
        : "waiting for the book",
      tone: (book.book?.risk_budget.binding_constraint[1] ?? 0) >= 0.9 ? "critical" : "warn",
    },
    {
      label: "Tail risk",
      value: book.risk
        ? usd(book.risk.historicalVar95 ?? book.risk.var95, 0)
        : book.riskLoading ? "Measuring" : "Pending",
      detail: book.varValidation
        ? `${book.varValidation.zone} validation, ${book.varValidation.observations} obs`
        : "historical VaR 95, 1 day",
      tone: book.varValidation?.zone === "red" ? "critical" : book.varValidation?.zone === "yellow" ? "warn" : "accent",
    },
    {
      label: "Execution sleeve",
      value: STRATEGY_LABELS[executionStrategy],
      detail: `${selectedSleeveDetail}; aggregate book risk below`,
      tone: selectedSleeveAttribution?.filled ? "good" : "accent",
    },
  ];
}

/** Execution: the instrument, the intent staged against it, and the authority. */
export function executionInsights(
  { symbol, side, notional }: { symbol: string; side: Side; notional: number },
): WorkspaceInsight[] {
  return [
    { label: "Instrument", value: symbol, detail: "consolidated L2", tone: "accent", mono: true },
    { label: "Intent", value: `${side} ${usd(notional, 0)}`, detail: "editable in the ticket", tone: side === "BUY" ? "good" : "warn", mono: true },
    { label: "Authority", value: "Paper only", detail: "pre-trade gates stay in control", tone: "good" },
  ];
}
