"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { Slot } from "radix-ui";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HotSource, useHot } from "@/lib/coherence/use-hot";

export function QuantInspectionPair({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <HotSource><div className={cn("quant-inspection", className)}>{children}</div></HotSource>;
}

export function QuantInspectionReadout<T>({
  rows,
  reading,
}: {
  rows: T[];
  reading: (row: T) => string;
}) {
  const { hot } = useHot();
  const row = hot === null ? null : rows[hot];
  return (
    <output
      className="quant-inspection__readout"
      data-active={row ? "true" : "false"}
      aria-live="polite"
      aria-atomic="true"
    >
      {row ? reading(row) : <span className="sr-only">Focus a figure mark or exact-value row to inspect it.</span>}
    </output>
  );
}

function moveRow(event: KeyboardEvent<HTMLTableRowElement>, edge: number | "step") {
  const body = event.currentTarget.closest("tbody");
  const rows = body ? Array.from(body.querySelectorAll<HTMLElement>("[data-quant-row]")) : [];
  const current = rows.indexOf(event.currentTarget);
  if (current < 0 || !rows.length) return;
  const next = edge === "step"
    ? Math.max(0, Math.min(rows.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))
    : Math.max(0, Math.min(rows.length - 1, edge));
  event.preventDefault();
  rows[next]?.focus();
}

export function QuantInspectionRow({
  index,
  asChild = false,
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"tr"> & { index: number; asChild?: boolean }) {
  const { hot, setHot } = useHot();
  const Comp = asChild ? Slot.Root : TableRow;
  return (
    <Comp
      {...props}
      data-quant-row={index}
      data-state={hot === index ? "selected" : undefined}
      className={cn("quant-inspection__row", hot === index && "is-hot", className)}
      tabIndex={hot === null ? (index === 0 ? 0 : -1) : hot === index ? 0 : -1}
      onPointerEnter={(event) => { props.onPointerEnter?.(event); setHot(index); }}
      onPointerLeave={(event) => { props.onPointerLeave?.(event); setHot(null); }}
      onFocus={(event) => { props.onFocus?.(event); setHot(index); }}
      onBlur={(event) => { props.onBlur?.(event); setHot(null); }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") moveRow(event, "step");
        else if (event.key === "Home") moveRow(event, 0);
        else if (event.key === "End") moveRow(event, Number.MAX_SAFE_INTEGER);
        else if (event.key === "Escape") event.currentTarget.blur();
      }}
    />
  );
}
