export const DEVELOPER_WORK_KINDS = ["feature", "bug", "ticket"] as const;
export type DeveloperWorkKind = (typeof DEVELOPER_WORK_KINDS)[number];

export const DEVELOPER_WORK_PRIORITIES = ["P0", "P1", "P2", "P3"] as const;
export type DeveloperWorkPriority = (typeof DEVELOPER_WORK_PRIORITIES)[number];

export const DEVELOPER_WORK_STATUSES = ["triage", "planned", "progress", "review", "done"] as const;
export type DeveloperWorkStatus = (typeof DEVELOPER_WORK_STATUSES)[number];

export interface DeveloperWorkItem {
  id: string;
  kind: DeveloperWorkKind;
  priority: DeveloperWorkPriority;
  status: DeveloperWorkStatus;
  title: string;
  summary: string;
  owner: string;
  area: string;
  openedAt: number;
}

/** Dotted key, per the user-prefs convention. */
export const DEVELOPER_WORK_STORAGE_KEY = "alphaengine.developer.work";

function isDeveloperWorkItem(value: unknown): value is DeveloperWorkItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DeveloperWorkItem>;
  return (
    typeof item.id === "string"
    && (DEVELOPER_WORK_KINDS as readonly string[]).includes(item.kind as string)
    && (DEVELOPER_WORK_PRIORITIES as readonly string[]).includes(item.priority as string)
    && (DEVELOPER_WORK_STATUSES as readonly string[]).includes(item.status as string)
    && typeof item.title === "string"
    && typeof item.summary === "string"
    && typeof item.owner === "string"
    && typeof item.area === "string"
    && typeof item.openedAt === "number"
    && Number.isFinite(item.openedAt)
  );
}

/**
 * Read the stored user queue, or `null` when there is nothing usable — absent
 * key, blocked storage, corrupt JSON, or a shape from another deploy. A valid
 * stored array wins even when empty, because an emptied queue is a state the
 * reader chose, not an error.
 * Same failure-collapse contract as `loadExperiments`.
 */
export function loadDeveloperWorkItems(): DeveloperWorkItem[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEVELOPER_WORK_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    if (!parsed.every(isDeveloperWorkItem)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Persist the queue; quota and disabled storage degrade silently. */
export function saveDeveloperWorkItems(items: readonly DeveloperWorkItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DEVELOPER_WORK_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // The user-created in-memory queue still works for this session; silently
    // degrading beats an error dialog over optional browser persistence.
  }
}

export interface DeveloperWorkFilter {
  query: string;
  kind: DeveloperWorkKind | "all";
  status: DeveloperWorkStatus | "all";
}

const PRIORITY_RANK: Record<DeveloperWorkPriority, number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const STATUS_RANK: Record<DeveloperWorkStatus, number> = {
  progress: 0,
  review: 1,
  planned: 2,
  triage: 3,
  done: 4,
};

export function filterDeveloperWorkItems(
  items: readonly DeveloperWorkItem[],
  filter: DeveloperWorkFilter,
): DeveloperWorkItem[] {
  const needle = filter.query.trim().toLocaleLowerCase();
  return items
    .filter((item) => {
      if (filter.kind !== "all" && item.kind !== filter.kind) return false;
      if (filter.status !== "all" && item.status !== filter.status) return false;
      if (!needle) return true;
      return [item.id, item.title, item.summary, item.owner, item.area]
        .some((value) => value.toLocaleLowerCase().includes(needle));
    })
    .sort((left, right) => (
      STATUS_RANK[left.status] - STATUS_RANK[right.status]
      || PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
      || left.openedAt - right.openedAt
      || left.id.localeCompare(right.id)
    ));
}

export function moveDeveloperWorkItem(
  items: readonly DeveloperWorkItem[],
  id: string,
  status: DeveloperWorkStatus,
): DeveloperWorkItem[] {
  return items.map((item) => (item.id === id ? { ...item, status } : item));
}

/** The list without one id, order kept. */
export function removeDeveloperWorkItem(
  items: readonly DeveloperWorkItem[],
  id: string,
): DeveloperWorkItem[] {
  return items.filter((item) => item.id !== id);
}

export function nextDeveloperWorkId(
  kind: DeveloperWorkKind,
  items: readonly DeveloperWorkItem[],
): string {
  const prefix = kind === "feature" ? "FEAT" : kind === "bug" ? "BUG" : "TKT";
  let largest = 0;
  for (const item of items) {
    if (!item.id.startsWith(`${prefix}-`)) continue;
    const candidate = Number(item.id.slice(prefix.length + 1));
    if (Number.isInteger(candidate) && candidate > largest) largest = candidate;
  }
  return `${prefix}-${String(largest + 1).padStart(3, "0")}`;
}
