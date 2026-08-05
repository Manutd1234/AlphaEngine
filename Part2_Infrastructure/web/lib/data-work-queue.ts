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
}

type DataWorkSeed = Omit<DataWorkItem, "openedAt" | "slaDueAt"> & {
  ageMinutes: number;
  slaHours: number | null;
};

/**
 * A deterministic case-assessment queue. It is intentionally sample workflow
 * data: the deployed console has live system telemetry, but no ticket-system
 * write credential or durable application database. The UI labels this scope
 * and keeps edits in the current browser session only.
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
  }));
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
