import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export type QuantSurfaceState = "loading" | "empty" | "stale" | "unavailable";

/**
 * One accessible frame for non-happy workspace states. It keeps state wording
 * separate from the geometry a specific panel reserves, so future empty and
 * stale views can share the same status contract without sharing their copy.
 */
export default function QuantStateSurface({
  state,
  label,
  busy = false,
  children,
}: {
  state: QuantSurfaceState;
  label: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Card
      className="quant-state-surface gap-0 py-0 shadow-none"
      data-state={state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={busy}
    >
      <span className="sr-only">{label}</span>
      {children}
    </Card>
  );
}
