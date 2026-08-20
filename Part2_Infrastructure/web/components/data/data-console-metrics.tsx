/**
 * The Data console's page-head metrics, one honest set per rail section.
 *
 * Split out of DataConsole.tsx when the Quality / Incidents section split grew
 * that file past its `file-size.test.ts` ratchet entry. The seam is natural:
 * this is a pure derivation — the shared health view in, `DataBarMetric[]`
 * out — and nothing in it reads or writes the console's own state.
 */

import type { ReactNode } from "react";

import NumberTicker from "@/components/common/NumberTicker";
import { PROGRESS_WIP_LIMIT } from "@/components/data/DataWorkBoard";
import type { InspectResponse } from "@/components/systems/types";
import type { DataWorkItem, DataWorkSource } from "@/lib/data-work-queue";
import { deriveTrustSlis } from "@/lib/data-trust";
import { CONTRACTED_CAPABILITIES } from "@/lib/providers/contracts";
import { fmt } from "@/lib/format";
import type { DataSection } from "@/lib/sections";
import type { SystemHealthView } from "@/lib/use-system-health";

export interface DataBarMetric {
  label: string;
  /** ReactNode so a poll-fed figure can count through NumberTicker. */
  value: ReactNode;
  note: string;
  tone?: "good" | "warn" | "bad" | "neutral";
}

function absoluteTime(value: string | Date | null): string {
  if (!value) return "not observed";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().replace("T", " ").replace(".000Z", " UTC");
}

export function metricsForSection(
  view: SystemHealthView,
  section: DataSection,
  symbol: string,
  interval: string,
  workItems: DataWorkItem[],
  workSource: DataWorkSource | undefined,
  pendingWorkWrites: number,
  probe: InspectResponse | null,
  probeLoading: boolean,
  probeError: string | null,
): DataBarMetric[] {
  const health = view.health;
  const validation = health?.validation;
  const quarantined = health?.quarantine?.size ?? 0;
  const rejected = health?.quarantine?.byProvider.reduce((sum, row) => sum + row.rejected, 0) ?? 0;
  const openWork = workItems.filter((item) => item.status !== "resolved");
  const urgentWork = openWork.filter((item) => item.priority === "P0" || item.priority === "P1");
  const activeWork = openWork.filter((item) => item.status === "progress");

  if (section === "quality") {
    return [
      {
        // The scope word travels with the number: the gateway's durable ledger
        // when the sync returned one, else this instance's own window.
        label: "Payloads evaluated",
        value: validation ? String(validation.evaluated) : "—",
        note: validation?.scope === "gateway-ledger" && validation.ledger
          ? `gateway ledger, ${validation.ledger.windowMinutes >= 1440 ? `${Math.round(validation.ledger.windowMinutes / 60)} h` : `${validation.ledger.windowMinutes} min`}${validation.lastValidationAt ? `; last ${absoluteTime(validation.lastValidationAt)}` : ""}`
          : validation?.lastValidationAt ? `this instance; last ${absoluteTime(validation.lastValidationAt)}` : "no validation evidence",
        tone: validation?.evaluated ? "good" : "neutral",
      },
      {
        label: "Fatal findings",
        value: validation ? String(validation.fatal) : "—",
        note: (() => {
          const open = validation?.ledger?.escalations.filter((e) => e.resolved_at === null).length ?? 0;
          return open ? `individual contract findings; ${open} ${open === 1 ? "escalation" : "escalations"} open` : "individual contract findings";
        })(),
        tone: validation?.fatal ? "bad" : validation?.evaluated ? "good" : "neutral",
      },
      {
        label: "Warning / drift",
        value: validation ? `${validation.warn} / ${validation.drift}` : "—",
        note: "served but labelled",
        tone: validation && validation.warn + validation.drift > 0 ? "warn" : validation?.evaluated ? "good" : "neutral",
      },
    ];
  }

  if (section === "incidents") {
    return [
      {
        label: "Simulated outages",
        value: health ? String(health.outages.length) : "—",
        note: health
          ? health.outages.length
            ? "providers held out of routing on purpose"
            : "operator-caused drills only, none running"
          : "waiting for health snapshot",
        tone: health ? (health.outages.length ? "warn" : "good") : "neutral",
      },
      {
        label: "Quarantine buffer",
        value: health?.quarantine ? String(quarantined) : "—",
        note: health?.quarantine ? `${rejected} rejected across ${health.quarantine.byProvider.length} providers` : "not exposed by this deployment",
        tone: rejected
          ? "bad"
          : quarantined
            ? "warn"
            : health?.quarantine && validation?.evaluated
              ? "good"
              : "neutral",
      },
    ];
  }

  if (section === "lineage") {
    return [
      { label: "Instrument", value: symbol, note: interval, tone: "neutral" },
      {
        label: "Lineage events",
        value: health ? String(health.events.retained) : "—",
        // The value above is already the retained count; a note repeating it
        // with a denominator says the same number twice. The capacity is the
        // fact only the note has.
        note: health ? `ring capacity ${health.events.capacity}` : "waiting for health snapshot",
        tone: health && health.events.retained >= health.events.capacity ? "warn" : "neutral",
      },
      {
        label: "Cache hit rate",
        // Null stays a dash; the ticker wraps only the measured branch.
        value: view.cacheHitRate === null
          ? "—"
          : <NumberTicker value={view.cacheHitRate * 100} format={(v) => `${fmt(v, 1)}%`} />,
        note: health ? `${health.summary.cache.hits} hits, ${health.summary.cache.misses} misses` : "no observations",
        tone: "neutral",
      },
      {
        label: "Contract coverage",
        // From the list the façades attach contracts from, so this tile can
        // never claim a capability the registry does not check.
        value: CONTRACTED_CAPABILITIES.map((c) => c[0].toUpperCase() + c.slice(1)).join(", "),
        note: "search and scrape are free text, not contract-checked",
        tone: "good",
      },
    ];
  }

  if (section === "providers") {
    return [
      {
        label: "Providers ready",
        value: health ? <><NumberTicker value={health.summary.ready} />/{health.summary.total}</> : "—",
        note: health ? `${health.summary.configured} configured` : "checking registry",
        tone: view.degraded
          ? "warn"
          : health?.summary.configured && health.summary.ready === health.summary.configured
            ? "good"
            : "neutral",
      },
      {
        label: "Degraded / exhausted",
        value: health ? <NumberTicker value={view.degraded} /> : "—",
        note: "route-affecting states",
        tone: view.degraded ? "warn" : health ? "good" : "neutral",
      },
      {
        label: "Route graphs",
        value: health ? String(health.routes.length) : "—",
        note: "one per capability and asset class",
        tone: "neutral",
      },
      {
        label: "Cache entries",
        value: health ? String(health.cache.entries) : "—",
        note: health ? `${health.cache.stateEntries} state records` : "not observed",
        tone: "neutral",
      },
    ];
  }

  if (section === "queue") {
    return [
      { label: "Open items", value: String(openWork.length), note: workSource?.kind === "gateway" ? "gateway-persisted" : "local list", tone: openWork.length ? "warn" : "good" },
      { label: "P0 / P1", value: String(urgentWork.length), note: "priority labels", tone: urgentWork.length ? "warn" : "good" },
      // n/limit, the same fraction the board enforces — a bare count here
      // beside the board's own n/limit read as two different numbers.
      { label: "Active WIP", value: `${activeWork.length}/${PROGRESS_WIP_LIMIT}`, note: "not a live worker queue", tone: activeWork.length > PROGRESS_WIP_LIMIT ? "warn" : "neutral" },
      {
        label: "Persistence",
        value: workSource?.kind === "gateway" ? "Gateway SQLite" : "Local (offline)",
        note: workSource?.kind === "gateway"
          ? `${workSource.count} items, ${workSource.seeded} samples; audit-logged`
          : workSource?.kind === "local"
            ? `${workSource.reason}${pendingWorkWrites ? `; ${pendingWorkWrites} edits held` : ""}`
            : "loading",
        tone: workSource?.kind === "gateway" ? "good" : "warn",
      },
    ];
  }

  const feeds = health?.platform?.market_data.feeds ?? [];
  const freshFeeds = feeds.filter((feed) => feed.status === "up" && feed.connected).length;
  const probeContract = probe?.provenance?.contract;
  return [
    { label: "Instrument", value: symbol, note: interval, tone: "neutral" },
    {
      label: "Validation evidence",
      value: probeLoading
        ? "Checking"
        : probeError
          ? "Unavailable"
          : probeContract
            ? probeContract.violations.length
              ? `${probeContract.violations.length} findings`
              : "Quote checked"
            : "No proof",
      note: probeContract
        ? `active ${symbol} payload; ${probeContract.notEvaluated.length} checks not evaluated`
        : probeError ?? "exact-payload contract result not observed",
      tone: probeError
        ? "bad"
        : probeContract?.violations.some((finding) => finding.severity === "fatal")
          ? "bad"
          : probeContract?.violations.length || probeContract?.notEvaluated.length
            ? "warn"
            : probeContract
              ? "good"
              : "neutral",
    },
    /**
     * Three of the four tiles this section was asked for do not exist as
     * measurements in this system, so they are RENAMED rather than faked, and
     * each says what it actually counts. `deriveTrustSlis` carries the full
     * reasoning; the short version:
     *
     *   SLA %          no SLA target is defined anywhere → books within the
     *                  freshness budget the gateway publishes
     *   packet rate    no sequence-gap counter exists on any feed → reconnects,
     *                  each of which IS an unmeasured gap
     *   uptime %       providers are observed only when called, so per-provider
     *                  uptime is unmeasurable → success rate of the attempts
     *                  actually made, gated on a sample floor
     *
     * The fourth, last sync, ships as asked — and reads the GATEWAY's
     * observation time rather than `fetchedAt`, because fetching the health
     * response does not make an old feed fresh.
     */
    ...deriveTrustSlis(health).map((sli) => ({
      label: sli.label,
      value: sli.value,
      note: sli.note,
      tone: sli.tone === "unknown" ? ("neutral" as const) : sli.tone,
    })),
  ];
}
