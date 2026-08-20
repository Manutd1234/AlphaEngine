/**
 * The equity curve that existed before this tab opened.
 *
 * The gateway persists equity snapshots from its risk monitor, but only from
 * the moment it started; whatever a tab observes live is appended to whatever
 * the endpoint can restore. Parsing that reply is arithmetic, not a hook, so it
 * sits here rather than inside `use-book`'s mount effect.
 *
 * A row that cannot be dated is dropped, never dated `0`: a point at the epoch
 * would draw a real line on a real chart. The two optional marks travel the
 * same way — `gross_exposure` and `kill_switch` are `null` when the row did not
 * carry them, so a leverage band and a halt shading are absent rather than
 * flat.
 */

import { probeGateway } from "@/lib/use-gateway-connection";
import type { EquityPoint } from "@/lib/portfolio";

export type PeriodReturns = Record<string, { pnl: number | null; return: number | null }>;

/** One history row as the gateway serves it. */
interface HistoryPoint {
  ts: string;
  equity: number;
  gross_exposure?: number;
  kill_switch?: boolean;
}

export interface EquityHistory {
  restored: EquityPoint[];
  periods: PeriodReturns | null;
}

/**
 * Reads the backfill, or reports that there was none.
 *
 * Deadlined like every other read, through `probeGateway`. The failure path is
 * deliberately silent — a missing history endpoint is not an error worth
 * showing — but silent and unbounded are different things: a bare fetch left
 * this promise pending for the life of the tab against a hung gateway.
 */
export async function fetchEquityHistory(): Promise<EquityHistory | null> {
  try {
    const outcome = await probeGateway<{ points?: unknown[]; periods?: PeriodReturns }>(
      "/api/gateway/portfolio/history?limit=400",
    );
    if (!outcome.ok) return null;
    const body = outcome.payload;
    if (!body?.points?.length) return null;
    const restored: EquityPoint[] = [];
    let hwm = -Infinity;
    // Each history row carries gross exposure and the kill-switch state
    // alongside the equity mark. Reading only `equity` threw away a leverage
    // band and a halt shading that cost nothing to draw.
    for (const point of body.points as HistoryPoint[]) {
      const t = Date.parse(point.ts.endsWith("Z") ? point.ts : `${point.ts}Z`);
      if (Number.isNaN(t)) continue;
      hwm = Math.max(hwm, point.equity);
      restored.push({
        t,
        equity: point.equity,
        highWaterMark: hwm,
        grossExposure: typeof point.gross_exposure === "number" ? point.gross_exposure : null,
        killSwitch: typeof point.kill_switch === "boolean" ? point.kill_switch : null,
      });
    }
    return { restored, periods: body.periods ?? null };
  } catch {
    return null;
  }
}
