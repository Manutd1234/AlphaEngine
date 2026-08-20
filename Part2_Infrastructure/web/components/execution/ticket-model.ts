/**
 * The order ticket's shapes and its three gate demonstrations.
 *
 * Shared by `OrderTicket`, which submits, and `OrderTicketForm` /
 * `OrderVerdict`, which collect the intent and render the answer. A second copy
 * of `Decision` in either of them would let the gateway's reply and the panel
 * that draws it drift apart field by field, with nothing to catch it.
 */

import { type GateCheck } from "@/lib/blotter";
import { strategiesByFamily } from "@/lib/strategy-progress";

/** One gateway verdict, as the route returns it plus what the client stamps. */
export interface Decision {
  accepted: boolean;
  order_id?: string;
  reason?: string | null;
  rejected_by?: string[];
  latency_ms?: number;
  checks?: GateCheck[];
  fill?: { price: number; quantity: number; venue: string; slippage_bps: number; fee_usd: number } | null;
  /** Stamped client-side so the verdict can label a LIMIT fill honestly even
   *  after the type seg has moved on. */
  order_type?: "MARKET" | "LIMIT";
}

export type Preset = {
  id: string;
  label: string;
  hint: string;
  notional: number;
  repeat?: number;
  /** Risk intent, so a gate-tripping demo never looks like a neutral chip. */
  tone?: "warn" | "notice";
};

/**
 * "Fat finger" and "rate limit" are the two rejections worth seeing before they
 * happen for real, and a demo that requires typing a plausible-looking bad
 * order is a demo nobody runs.
 */
export const PRESETS: Preset[] = [
  { id: "valid", label: "Valid $25k", hint: "Passes every gate and fills on the live ladder.", notional: 25_000 },
  { id: "fat-finger", label: "Fat finger $500k", hint: "Blocked by the per-order notional cap.", notional: 500_000, tone: "warn" },
  { id: "burst", label: "Rate-limit burst", hint: "Twelve $1k orders — the token bucket stops the tail.", notional: 1_000, repeat: 12, tone: "notice" },
];

export const STRATEGY_GROUPS = [...strategiesByFamily()];
