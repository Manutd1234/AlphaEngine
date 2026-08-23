export const DATA_WORK_KINDS = ["request", "ticket", "bug"] as const;
export type DataWorkKind = (typeof DATA_WORK_KINDS)[number];

export const DATA_WORK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type DataWorkPriority = (typeof DATA_WORK_PRIORITIES)[number];

export const DATA_WORK_STATUSES = ["intake", "ready", "progress", "resolved"] as const;
export type DataWorkStatus = (typeof DATA_WORK_STATUSES)[number];

export const DATA_WORK_SORTS = ["priority", "oldest", "newest"] as const;
export type DataWorkSort = (typeof DATA_WORK_SORTS)[number];

export interface DataWorkItem {
  id: string;
  kind: DataWorkKind;
  priority: DataWorkPriority;
  status: DataWorkStatus;
  title: string;
  summary: string;
  owner: string;
  area: string;
  openedAt: number;
  slaDueAt: number | null;
  /**
   * The gateway's row version — a PATCH must quote it, and a stale one is
   * refused with the current row. 1 for a seed or an item that has never
   * been persisted.
   */
  version: number;
  /** "seed" for the nine sample rows the gateway seeds once; a desk actor otherwise. */
  createdBy: string;
}

type DataWorkSeed = Omit<DataWorkItem, "openedAt" | "slaDueAt" | "version" | "createdBy"> & {
  ageMinutes: number;
  slaHours: number | null;
};

/**
 * The nine sample rows, in the same order the gateway seeds them
 * (`modules/work_items.py` SEED_ITEMS). They are still needed here: the
 * board renders them as its offline state before the first load and when
 * the gateway is unreachable, disclosed as such.
 */
const DATA_WORK_SEEDS: readonly DataWorkSeed[] = [
  {
    id: "BUG-091",
    kind: "bug",
    priority: "P0",
    status: "progress",
    title: "Duplicate SOLUSDT bars in the 4h backfill",
    summary: "Two timestamps survive normalisation and distort realised volatility.",
    owner: "Mei",
    area: "Market data",
    ageMinutes: 74,
    slaHours: 2,
  },
  {
    id: "BUG-094",
    kind: "bug",
    priority: "P1",
    status: "progress",
    title: "News timestamps parsed in the browser timezone",
    summary: "UTC vendor timestamps shift during enrichment and reorder the feed.",
    owner: "Ravi",
    area: "Normalisation",
    ageMinutes: 228,
    slaHours: 8,
  },
  {
    id: "TKT-322",
    kind: "ticket",
    priority: "P1",
    status: "intake",
    title: "Review changePercent schema drift",
    summary: "Three Alpha Vantage payloads were served with a renamed secondary field.",
    owner: "Unassigned",
    area: "Data contracts",
    ageMinutes: 96,
    slaHours: 8,
  },
  {
    id: "REQ-184",
    kind: "request",
    priority: "P2",
    status: "intake",
    title: "Add perpetual funding-rate lineage",
    summary: "Quant research needs provider and cache provenance on funding snapshots.",
    owner: "Unassigned",
    area: "Research data",
    ageMinutes: 41,
    slaHours: 24,
  },
  {
    id: "REQ-187",
    kind: "request",
    priority: "P2",
    status: "intake",
    title: "Define an SLO for cross-source spread",
    summary: "Alert when the quote consensus remains outside tolerance for five minutes.",
    owner: "Noah",
    area: "Observability",
    ageMinutes: 19,
    slaHours: 24,
  },
  {
    id: "TKT-319",
    kind: "ticket",
    priority: "P2",
    status: "ready",
    title: "Raise the interactive quota reserve",
    summary: "Protect manual traces while the background bars poll approaches its daily cap.",
    owner: "Lina",
    area: "Capacity",
    ageMinutes: 310,
    slaHours: 24,
  },
  {
    id: "REQ-179",
    kind: "request",
    priority: "P3",
    status: "ready",
    title: "Expose provider choice in research exports",
    summary: "Add source, route rank, and cache age to the experiment artifact.",
    owner: "Ravi",
    area: "Lineage",
    ageMinutes: 522,
    slaHours: 72,
  },
  {
    id: "TKT-311",
    kind: "ticket",
    priority: "P3",
    status: "resolved",
    title: "Publish the failover drill runbook",
    summary: "Document the bounded outage, expected route change, and restore check.",
    owner: "Mei",
    area: "Runbooks",
    ageMinutes: 1_460,
    slaHours: null,
  },
  {
    id: "BUG-088",
    kind: "bug",
    priority: "P2",
    status: "resolved",
    title: "BTC quote freshness label lagged one poll",
    summary: "The inspector now reports the response timestamp from the winning request.",
    owner: "Lina",
    area: "Pipeline",
    ageMinutes: 2_040,
    slaHours: null,
  },
];

export function createInitialDataWorkItems(now = Date.now()): DataWorkItem[] {
  return DATA_WORK_SEEDS.map(({ ageMinutes, slaHours, ...item }) => ({
    ...item,
    openedAt: now - ageMinutes * 60_000,
    slaDueAt: slaHours === null ? null : now + (slaHours * 60 - ageMinutes) * 60_000,
    version: 1,
    createdBy: "seed",
  }));
}

// --------------------------------------------------------------------------
// The persisted queue — the gateway's rows, through the workspace's proxies
// --------------------------------------------------------------------------

/** One row as the gateway sends it (`WorkItemView`, snake_case, epoch ms). */
export interface DataWorkItemWire {
  id: string;
  kind: DataWorkKind;
  priority: DataWorkPriority;
  status: DataWorkStatus;
  title: string;
  summary: string;
  owner: string;
  area: string;
  opened_at: number;
  sla_due_at: number | null;
  resolved_at: number | null;
  created_by: string;
  updated_at: number;
  updated_by: string;
  version: number;
}

/** Where the list on screen came from — the board says which. */
export type DataWorkSource =
  | { kind: "gateway"; backend: string; count: number; seeded: number; observedAt: string }
  | { kind: "local"; reason: string };

export function isDataWorkItemWire(value: unknown): value is DataWorkItemWire {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string"
    && (DATA_WORK_KINDS as readonly string[]).includes(String(v.kind))
    && (DATA_WORK_PRIORITIES as readonly string[]).includes(String(v.priority))
    && (DATA_WORK_STATUSES as readonly string[]).includes(String(v.status))
    && typeof v.title === "string"
    && typeof v.opened_at === "number"
    && typeof v.version === "number";
}

export function fromWire(row: DataWorkItemWire): DataWorkItem {
  return {
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    status: row.status,
    title: row.title,
    summary: row.summary,
    owner: row.owner,
    area: row.area,
    openedAt: row.opened_at,
    slaDueAt: row.sla_due_at,
    version: row.version,
    createdBy: row.created_by,
  };
}

const DATA_WORK_TIMEOUT_MS = 6_000;

export async function withDeadline(input: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DATA_WORK_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, cache: "no-store", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type DataWorkLoad =
  | { ok: true; items: DataWorkItem[]; source: Extract<DataWorkSource, { kind: "gateway" }> }
  | { ok: false; reason: string };

/** Read the persisted queue. Never throws: an unreachable gateway is a reason, not an exception. */
export async function loadDataWorkItems(): Promise<DataWorkLoad> {
  try {
    const response = await withDeadline("/api/gateway/data/work-items");
    const body = await response.json().catch(() => null) as
      | { backend?: string; items?: unknown[]; count?: number; seeded?: number; observed_at?: string; error?: string }
      | null;
    if (!response.ok || !body || !Array.isArray(body.items)) {
      return { ok: false, reason: body?.error ?? `the work queue answered HTTP ${response.status}` };
    }
    const items = body.items.filter(isDataWorkItemWire).map(fromWire);
    return {
      ok: true,
      items,
      source: {
        kind: "gateway",
        backend: body.backend ?? "sqlite",
        count: body.count ?? items.length,
        seeded: body.seeded ?? items.filter((i) => i.createdBy === "seed").length,
        observedAt: body.observed_at ?? new Date().toISOString(),
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { ok: false, reason: aborted ? "the work queue did not answer within the deadline" : "the work queue is unreachable" };
  }
}

export interface DataWorkDraft {
  kind: DataWorkKind;
  priority: DataWorkPriority;
  title: string;
  summary?: string;
  owner?: string;
  area?: string;
}

export type DataWorkWrite =
  | { ok: true; item: DataWorkItem }
  | { ok: false; code: "conflict"; current: DataWorkItem | null; error: string }
  | { ok: false; code: "not_found" | "rejected" | "unreachable" | "unauthorised"; error: string };

export function authHeaders(token: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function createDataWorkItem(draft: DataWorkDraft, token: string | null = null): Promise<DataWorkWrite> {
  try {
    const response = await withDeadline("/api/gateway/data/work-items", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(draft),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "unauthorised", error: String(body?.error ?? "an operator credential is required to create items") };
    }
    if (!response.ok || !isDataWorkItemWire(body)) {
      return { ok: false, code: response.status >= 500 || response.status === 0 ? "unreachable" : "rejected", error: String(body?.error ?? `HTTP ${response.status}`) };
    }
    return { ok: true, item: fromWire(body) };
  } catch {
    return { ok: false, code: "unreachable", error: "the work queue is unreachable" };
  }
}

export async function patchDataWorkItem(
  id: string,
  version: number,
  patch: Partial<Pick<DataWorkItem, "status" | "priority" | "owner" | "title" | "summary" | "area">>,
  token: string | null = null,
): Promise<DataWorkWrite> {
  try {
    const response = await withDeadline(`/api/gateway/data/work-items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({ version, ...patch }),
    });
    const body = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (response.status === 409) {
      const current = body?.current;
      return {
        ok: false,
        code: "conflict",
        current: isDataWorkItemWire(current) ? fromWire(current) : null,
        error: String(body?.error ?? "this item was changed elsewhere"),
      };
    }
    if (response.status === 404) return { ok: false, code: "not_found", error: `no work item ${id} on the gateway` };
    if (response.status === 401 || response.status === 403) {
      return { ok: false, code: "unauthorised", error: String(body?.error ?? "an operator credential is required to edit items") };
    }
    if (!response.ok || !isDataWorkItemWire(body)) {
      return { ok: false, code: response.status >= 500 || response.status === 0 ? "unreachable" : "rejected", error: String(body?.error ?? `HTTP ${response.status}`) };
    }
    return { ok: true, item: fromWire(body) };
  } catch {
    return { ok: false, code: "unreachable", error: "the work queue is unreachable" };
  }
}

/** Replace one row in a list by id, keeping order; append if it is new. */
export function upsertDataWorkItem(items: readonly DataWorkItem[], item: DataWorkItem): DataWorkItem[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [item, ...items];
  return items.map((candidate, i) => (i === index ? item : candidate));
}

export interface DataWorkFilter {
  query: string;
  kind: DataWorkKind | "all";
  sort: DataWorkSort;
}

const PRIORITY_RANK: Record<DataWorkPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

export function filterAndSortDataWorkItems(
  items: readonly DataWorkItem[],
  filter: DataWorkFilter,
): DataWorkItem[] {
  const needle = filter.query.trim().toLocaleLowerCase();
  const matches = items.filter((item) => {
    if (filter.kind !== "all" && item.kind !== filter.kind) return false;
    if (!needle) return true;
    return [item.id, item.title, item.summary, item.owner, item.area]
      .some((value) => value.toLocaleLowerCase().includes(needle));
  });

  return matches.sort((left, right) => {
    if (filter.sort === "oldest") return left.openedAt - right.openedAt;
    if (filter.sort === "newest") return right.openedAt - left.openedAt;
    return (
      PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || left.openedAt - right.openedAt
      || left.id.localeCompare(right.id)
    );
  });
}

export function moveDataWorkItem(
  items: readonly DataWorkItem[],
  id: string,
  status: DataWorkStatus,
): DataWorkItem[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}

export function nextDataWorkId(kind: DataWorkKind, items: readonly DataWorkItem[]): string {
  const prefix = kind === "request" ? "REQ" : kind === "ticket" ? "TKT" : "BUG";
  let largest = 0;
  for (const item of items) {
    if (!item.id.startsWith(`${prefix}-`)) continue;
    const value = Number(item.id.slice(prefix.length + 1));
    if (Number.isInteger(value) && value > largest) largest = value;
  }
  return `${prefix}-${String(largest + 1).padStart(3, "0")}`;
}
