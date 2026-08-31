import type { DataWorkItem } from "../../lib/data-work-queue";

type DataWorkSeed = Omit<DataWorkItem, "openedAt" | "slaDueAt" | "version" | "createdBy"> & {
  ageMinutes: number;
  slaHours: number | null;
};

/** Test-only rows for exercising queue transforms. Production receives rows
 * from the gateway and never imports or renders this fixture. */
const DATA_WORK_SEEDS: readonly DataWorkSeed[] = [
  {
    id: "BUG-091", kind: "bug", priority: "P0", status: "progress",
    title: "Duplicate SOLUSDT bars in the 4h backfill",
    summary: "Two timestamps survive normalisation and distort realised volatility.",
    owner: "Mei", area: "Market data", ageMinutes: 74, slaHours: 2,
  },
  {
    id: "BUG-094", kind: "bug", priority: "P1", status: "progress",
    title: "News timestamps parsed in the browser timezone",
    summary: "UTC vendor timestamps shift during enrichment and reorder the feed.",
    owner: "Ravi", area: "Normalisation", ageMinutes: 228, slaHours: 8,
  },
  {
    id: "TKT-322", kind: "ticket", priority: "P1", status: "intake",
    title: "Review changePercent schema drift",
    summary: "Three Alpha Vantage payloads were served with a renamed secondary field.",
    owner: "Unassigned", area: "Data contracts", ageMinutes: 96, slaHours: 8,
  },
  {
    id: "REQ-184", kind: "request", priority: "P2", status: "intake",
    title: "Add perpetual funding-rate lineage",
    summary: "Quant research needs provider and cache provenance on funding snapshots.",
    owner: "Unassigned", area: "Research data", ageMinutes: 41, slaHours: 24,
  },
  {
    id: "REQ-187", kind: "request", priority: "P2", status: "intake",
    title: "Define an SLO for cross-source spread",
    summary: "Alert when the quote consensus remains outside tolerance for five minutes.",
    owner: "Noah", area: "Observability", ageMinutes: 19, slaHours: 24,
  },
  {
    id: "TKT-319", kind: "ticket", priority: "P2", status: "ready",
    title: "Raise the interactive quota reserve",
    summary: "Protect manual traces while the background bars poll approaches its daily cap.",
    owner: "Lina", area: "Capacity", ageMinutes: 310, slaHours: 24,
  },
  {
    id: "REQ-179", kind: "request", priority: "P3", status: "ready",
    title: "Expose provider choice in research exports",
    summary: "Add source, route rank, and cache age to the experiment artifact.",
    owner: "Ravi", area: "Lineage", ageMinutes: 522, slaHours: 72,
  },
  {
    id: "TKT-311", kind: "ticket", priority: "P3", status: "resolved",
    title: "Publish the failover drill runbook",
    summary: "Document the bounded outage, expected route change, and restore check.",
    owner: "Mei", area: "Runbooks", ageMinutes: 1_460, slaHours: null,
  },
  {
    id: "BUG-088", kind: "bug", priority: "P2", status: "resolved",
    title: "BTC quote freshness label lagged one poll",
    summary: "The inspector now reports the response timestamp from the winning request.",
    owner: "Lina", area: "Pipeline", ageMinutes: 2_040, slaHours: null,
  },
];

export function createTestDataWorkItems(now = Date.now()): DataWorkItem[] {
  return DATA_WORK_SEEDS.map(({ ageMinutes, slaHours, ...item }) => ({
    ...item,
    openedAt: now - ageMinutes * 60_000,
    slaDueAt: slaHours === null ? null : now + (slaHours * 60 - ageMinutes) * 60_000,
    version: 1,
    createdBy: "test-fixture",
  }));
}
