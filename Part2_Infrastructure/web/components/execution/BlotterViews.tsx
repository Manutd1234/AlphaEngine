"use client";

/**
 * The blotter, split by the question a reader is actually asking.
 *
 * One table did three jobs badly. "What is still working", "what did we get
 * done" and "why did nothing happen" want different columns — a resting order
 * has no fill price, and a refusal has no venue — so a single column set meant
 * every row carried dashes where another view's answer would have been.
 *
 * THREE THINGS WORTH KNOWING ABOUT THE SHAPE:
 *
 * 1. Active Orders reads a DIFFERENT SOURCE. The audit feed carries terminal
 *    decisions; the resting book is a separate endpoint and a separate row type
 *    (`WorkingOrderRow`), because a resting order has no verdict, no fill and no
 *    latency and giving it those as nulls would invite a table to render "—"
 *    where the honest answer is "not yet". So this view mounts `WorkingOrders`,
 *    which already owns that poll — and with it the cancel and amend controls,
 *    without which an "active orders" view is a list rather than a view.
 *
 * 2. The views are CONDITIONAL, not hidden. Unlike the workspace rail, where
 *    panels stay mounted so drafts survive, there is nothing to preserve here —
 *    and leaving Active Orders mounted would keep its 5s poll running behind a
 *    tab nobody is reading.
 *
 * 3. `.seg`, not a nested `<WorkspaceSubtabs>`. That component publishes
 *    `--rail-h` on the document element and its own comment asserts exactly one
 *    rail is mounted at a time; a second instance would fight the first over
 *    that variable on every resize. Local state, not a third hash level: the
 *    hash parser splits into two parts and the workspace suite pins the
 *    hash-builder's exact form, which a three-button control does not justify
 *    rewriting.
 */

import { useState } from "react";

import OrderBlotter from "@/components/execution/OrderBlotter";
import WorkingOrders from "@/components/portfolio/WorkingOrders";

type View = "active" | "fills" | "unfilled";

const VIEWS: Array<{ id: View; label: string; hint: string }> = [
  { id: "active", label: "Active", hint: "Resting and partially filled" },
  { id: "fills", label: "Fills", hint: "Executed, with price, size and fee" },
  { id: "unfilled", label: "Cancelled & rejected", hint: "With the gate that refused it" },
];

export default function BlotterViews({
  rows,
  focusSymbol,
  source,
  isStale,
  active,
  operatorToken,
  onChanged,
  onOpenResearch,
  onFocusSymbol,
}: {
  rows: React.ComponentProps<typeof OrderBlotter>["rows"];
  focusSymbol: string;
  source: "live" | "sandbox" | "unavailable";
  isStale?: boolean;
  /** False while the Blotter subtab is hidden — gates the resting-book poll. */
  active?: boolean;
  operatorToken?: string;
  onChanged?: () => void;
  onOpenResearch?: () => void;
  onFocusSymbol?: (symbol: string) => void;
}) {
  const [view, setView] = useState<View>("fills");
  const [query, setQuery] = useState("");

  return (
    <div className="blotter-views">
      <div className="blotter-views__bar">
        <div className="seg" role="group" aria-label="Blotter view">
          {VIEWS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={view === option.id}
              title={option.hint}
              onClick={() => setView(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        {/* One box across all three, so a symbol typed once survives switching
            between "did it fill" and "why didn't it". */}
        <input
          type="search"
          className="blotter-views__search"
          value={query}
          /* Short enough not to clip in the box: the five searchable fields
             are named in full by the aria-label below. */
          placeholder="Search orders…"
          aria-label="Search orders by symbol, order id, strategy, venue or gate"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {view === "active" ? (
        <WorkingOrders
          source={source}
          focusSymbol={focusSymbol}
          isStale={isStale}
          active={active && view === "active"}
          operatorToken={operatorToken}
          onChanged={onChanged}
          onFocusSymbol={onFocusSymbol}
          query={query}
          /* Lands in the gateway's audit trail, so it has to name the surface
             the operator actually acted from. */
          origin="execution blotter"
        />
      ) : (
        <OrderBlotter
          rows={rows}
          focusSymbol={focusSymbol}
          onOpenResearch={onOpenResearch}
          source={source}
          view={view}
          query={query}
        />
      )}
    </div>
  );
}
