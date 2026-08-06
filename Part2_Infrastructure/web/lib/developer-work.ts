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

type DeveloperWorkSeed = Omit<DeveloperWorkItem, "openedAt"> & { ageHours: number };

/**
 * Representative engineering work for the assessment UI. This is not imported
 * from GitHub or another ticket system; the console labels it as sample data and
 * keeps all edits in the current browser session.
 */
const DEVELOPER_WORK_SEEDS: readonly DeveloperWorkSeed[] = [
  {
    id: "BUG-204",
    kind: "bug",
    priority: "P1",
    status: "progress",
    title: "Developer deep links do not restore the active subtab",
    summary: "The top-level hash restores Developer, but a refresh returns the engineer to Overview.",
    owner: "Ian",
    area: "Web shell",
    ageHours: 9,
  },
  {
    id: "FEAT-074",
    kind: "feature",
    priority: "P1",
    status: "planned",
    title: "Generate a typed client from the OpenAPI snapshot",
    summary: "Remove hand-maintained request shapes between the gateway and its TypeScript consumers.",
    owner: "Unassigned",
    area: "Contracts",
    ageHours: 28,
  },
  {
    id: "TKT-412",
    kind: "ticket",
    priority: "P2",
    status: "review",
    title: "Expose the repository through a safe committed manifest",
    summary: "Index every repository path without serving arbitrary files from the Vercel runtime.",
    owner: "Ian",
    area: "Developer portal",
    ageHours: 5,
  },
  {
    id: "FEAT-076",
    kind: "feature",
    priority: "P2",
    status: "triage",
    title: "Add property-based fuzzing for risk payloads",
    summary: "Exercise boundary combinations beyond the committed parity and contract fixtures.",
    owner: "Unassigned",
    area: "Risk engine",
    ageHours: 18,
  },
  {
    id: "BUG-201",
    kind: "bug",
    priority: "P2",
    status: "triage",
    title: "Session work is lost when the dashboard reloads",
    summary: "Connect an authenticated issue backend before this queue is treated as a system of record.",
    owner: "Unassigned",
    area: "Developer portal",
    ageHours: 42,
  },
  {
    id: "FEAT-071",
    kind: "feature",
    priority: "P3",
    status: "planned",
    title: "Connect pull requests to verification evidence",
    summary: "Show review state and the latest CI conclusion beside a linked engineering item.",
    owner: "Noah",
    area: "Delivery",
    ageHours: 63,
  },
  {
    id: "TKT-405",
    kind: "ticket",
    priority: "P2",
    status: "done",
    title: "Guard CI against files missing from the committed tree",
    summary: "The repository audit now verifies an export of HEAD rather than the local working tree.",
    owner: "Ian",
    area: "Delivery",
    ageHours: 96,
  },
  {
    id: "BUG-199",
    kind: "bug",
    priority: "P2",
    status: "done",
    title: "API inventory omitted supported route methods",
    summary: "The Developer API catalog now lists every supported web operation by domain.",
    owner: "Ian",
    area: "Developer portal",
    ageHours: 120,
  },
];

export function createInitialDeveloperWorkItems(now = Date.now()): DeveloperWorkItem[] {
  return DEVELOPER_WORK_SEEDS.map(({ ageHours, ...item }) => ({
    ...item,
    openedAt: now - ageHours * 3_600_000,
  }));
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
