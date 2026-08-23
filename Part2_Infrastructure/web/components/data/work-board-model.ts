/**
 * The board's vocabulary: its four columns, its SLA clock, and the shape of a
 * new item.
 *
 * Split out of `DataWorkBoard` when that file passed the length ceiling. What
 * lives here is everything that has an answer without a render — the WIP limit
 * the columns enforce, the hours each priority is allowed, and the two pure
 * functions that turn a timestamp into words.
 *
 * `slaState` returns null rather than a neutral label when there is nothing to
 * measure: a resolved item has no clock running and an item with no due date
 * never had one. The card prints nothing in that case rather than a zero or an
 * "on track" it cannot support.
 */

import {
  type DataWorkItem,
  type DataWorkKind,
  type DataWorkPriority,
  type DataWorkStatus,
} from "@/lib/data-work-queue";

/** What the board asks the workspace to persist; the workspace owns the network. */
export type DataWorkMutation =
  | { type: "move"; item: DataWorkItem; status: DataWorkStatus }
  | { type: "create"; item: DataWorkItem }
  | { type: "delete"; item: DataWorkItem };

export interface NewItemDraft {
  kind: DataWorkKind;
  priority: DataWorkPriority;
  title: string;
  owner: string;
  area: string;
}

export const KIND_LABEL: Record<DataWorkKind, string> = {
  request: "Request",
  ticket: "Ticket",
  bug: "Bug",
};

/** Read by the PageHead's Active WIP metric states the same n/limit this
 *  board enforces, rather than a bare count beside a second bare count here. */
export const PROGRESS_WIP_LIMIT = 3;

export const STATUS_META: ReadonlyArray<{
  id: DataWorkStatus;
  label: string;
  description: string;
  wipLimit: number | null;
}> = [
  { id: "intake", label: "Intake", description: "Needs triage", wipLimit: null },
  { id: "ready", label: "Ready", description: "Scoped and prioritised", wipLimit: null },
  { id: "progress", label: "In progress", description: "Actively owned", wipLimit: PROGRESS_WIP_LIMIT },
  { id: "resolved", label: "Resolved", description: "Verified complete", wipLimit: null },
];

export const STATUS_LABEL = Object.fromEntries(STATUS_META.map((status) => [status.id, status.label])) as Record<
  DataWorkStatus,
  string
>;

export const DEFAULT_DRAFT: NewItemDraft = {
  kind: "request",
  priority: "P2",
  title: "",
  owner: "Unassigned",
  area: "Pipeline",
};

export const AREA_OPTIONS = [
  "Pipeline",
  "Market data",
  "Data contracts",
  "Normalisation",
  "Lineage",
  "Capacity",
  "Observability",
] as const;

export const SLA_HOURS: Record<DataWorkPriority, number> = {
  P0: 2,
  P1: 8,
  P2: 24,
  P3: 72,
};

export function formatAge(openedAt: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - openedAt) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1_440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1_440)}d ago`;
}

export function slaState(
  item: DataWorkItem,
  now: number,
): { label: string; tone: "good" | "warn" | "bad" } | null {
  if (item.status === "resolved" || item.slaDueAt === null) return null;
  const remaining = Math.ceil((item.slaDueAt - now) / 60_000);
  if (remaining < 0) {
    const overdue = Math.abs(remaining);
    return { label: `SLA breached by ${overdue < 60 ? `${overdue}m` : `${Math.floor(overdue / 60)}h`}`, tone: "bad" };
  }
  if (remaining < 60) return { label: `SLA due in ${remaining}m`, tone: "warn" };
  return { label: `SLA due in ${Math.floor(remaining / 60)}h`, tone: remaining <= 120 ? "warn" : "good" };
}
