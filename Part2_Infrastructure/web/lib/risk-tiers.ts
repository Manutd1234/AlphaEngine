/**
 * Risk control precedence, tier gating, and operator access control.
 */

import type { RiskAction } from "@/lib/risk-control";

export type RiskTierId =
  | "cancel_all"
  | "cancel_symbol"
  | "flatten_all"
  | "flatten_symbol"
  | "halt_symbol"
  | "halt"
  | "resume"
  | "soft_halt"
  | "soft_resume";

export interface RiskTierSpec {
  id: RiskTierId;
  level: "L1" | "L2" | "L3";
  label: string;
  action: RiskAction;
  scoped: boolean;
  blockedByHalt: boolean;
  recovery: boolean;
  prose: string;
  confirmWord: string;
}

export const RISK_TIERS: readonly RiskTierSpec[] = [
  {
    id: "cancel_all",
    level: "L1",
    label: "Cancel all resting orders",
    action: "cancel_all",
    scoped: false,
    blockedByHalt: false,
    recovery: false,
    prose: "Cancels all resting orders on the gateway. Releases committed capital without closing open positions.",
    confirmWord: "CANCEL",
  },
  {
    id: "flatten_all",
    level: "L2",
    label: "Flatten entire book",
    action: "flatten",
    scoped: false,
    blockedByHalt: true,
    recovery: false,
    prose: "Irreversible. Submits market orders for every position through pre-trade risk gates.",
    confirmWord: "FLATTEN",
  },
  {
    id: "halt",
    level: "L3",
    label: "Halt trading",
    action: "halt",
    scoped: false,
    blockedByHalt: false,
    recovery: false,
    prose: "Engages emergency kill switch. Rejects ALL orders, including closing orders.",
    confirmWord: "HALT",
  },
  {
    id: "resume",
    level: "L3",
    label: "Resume trading",
    action: "resume",
    scoped: false,
    blockedByHalt: false,
    recovery: true,
    prose: "Restores trading permissions. Re-enables order submission.",
    confirmWord: "RESUME",
  },
];

export interface OperatorBlockedInput {
  operatorToken?: string | null;
  sandbox?: boolean;
  halted?: boolean;
  busy?: boolean;
  /**
   * The server's guard mode. A token is demanded only when the server would
   * demand one — on an open-demo or open-dev deployment this control must not
   * ask for a credential the server will never check. Omitted means "token",
   * the strictest reading, so a caller that has not probed yet fails closed.
   */
  guard?: "token" | "open-dev" | "open-demo" | "locked";
}

export function operatorBlockedReason(input: OperatorBlockedInput): string | null {
  if (input.busy) return "Operation in progress...";
  if (input.sandbox) return "Sandbox mode — live operator controls disabled";
  if (input.guard === "locked") return "Operator actions are disabled on this deployment";
  const tokenRequired = (input.guard ?? "token") === "token";
  if (tokenRequired && !input.operatorToken) return "Operator authentication required";
  return null;
}
