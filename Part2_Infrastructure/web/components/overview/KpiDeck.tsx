"use client";

/**
 * The command center's KPI deck — four cards, every number real.
 *
 * `KpiCard` is the canonical overview tile going forward (the app already has
 * four divergent stat-tile patterns; new overview surfaces use this one, and
 * consolidating the older four is deliberately out of scope). Styled with the
 * Tailwind token bridge; the shapes mirror the `.decision-metrics` look it
 * replaces.
 *
 * Hard rule inherited from the plan: nothing here reads sample datasets
 * (data-work-queue, developer-work, sandboxBlotter). A card without a real
 * number states its empty state instead.
 */

import { type ReactNode } from "react";

import Sparkline from "@/components/overview/Sparkline";
import { fmt, signedPct, usd } from "@/lib/format";
import { downsample, latencyTone } from "@/lib/overview-state";
import { STRATEGY_LABELS, type SweepRequest, type SweepResponse } from "@/lib/types";
import type { BookView } from "@/lib/use-book";
import type { SystemHealthView } from "@/lib/use-system-health";
import type { Side } from "@/lib/venues";

function KpiCard({
  label,
  value,
  note,
  spark,
  mono = true,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  spark?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="grid min-w-0 gap-0.5 rounded-[12px] border border-border bg-surface-1 px-4 py-3.5 shadow-card">
      <span className="text-[9.5px] font-bold uppercase tracking-[0.07em] text-text-muted">{label}</span>
      <div className="flex items-end justify-between gap-3">
        <strong
          className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[14px] leading-[1.25] ${mono ? "num" : ""}`}
        >
          {value}
        </strong>
        {spark}
      </div>
      <small className="overflow-hidden text-ellipsis whitespace-nowrap text-[10.5px] text-text-muted">{note}</small>
    </div>
  );
}

export default function KpiDeck({
  request,
  result,
  running,
  researchStale,
  staleResult,
  side,
  notional,
  book,
  systems,
}: {
  request: SweepRequest;
  result: SweepResponse | null;
  running: boolean;
  researchStale: boolean;
  /** The veiled previous run while the context is dirty — labelled, never
   *  passed off as current. */
  staleResult: SweepResponse | null;
  side: Side;
  notional: number;
  book: BookView;
  systems: SystemHealthView;
}) {
  const shown = result ?? staleResult;
  const summary = systems.health?.summary;

  // ---- research candidate ------------------------------------------------
  const candidateValue = shown
    ? `${STRATEGY_LABELS[shown.request.strategy]} · ${shown.best.fast}/${shown.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  const candidateNote = running
    ? "sweep in progress"
    : researchStale && shown
      ? `context changed — was ${shown.request.symbol} · rerun required`
      : shown
        ? `${shown.verdict.level.toUpperCase()} · Sharpe ${fmt(shown.best.sharpe, 2)}`
        : "no completed run";
  const equitySpark = shown ? downsample(shown.series.map((p) => p.equity), 64) : [];

  // ---- OOS validation ----------------------------------------------------
  const oos = shown?.walkForwardOosSharpe ?? null;
  const oosValue = shown ? (oos == null ? "Not available" : fmt(oos, 2)) : running ? "Running" : "Pending";
  const trl = shown?.minTrackRecord?.vsZero ?? null;
  const oosNote = shown
    ? trl
      ? trl.bars == null
        ? "no finite record proves this edge"
        : trl.sufficient
          ? `track record met · ${signedPct(shown.best.totalReturn)} in-sample`
          : `needs ~${fmt(trl.years, 1)}y of history · ${signedPct(shown.best.totalReturn)} in-sample`
      : `${signedPct(shown.best.totalReturn)} in-sample return`
    : "awaiting result";

  // ---- order intent ------------------------------------------------------
  const modeledCost = (notional * request.slippageBps) / 1e4;
  const exposure = book.book?.exposure;
  const headroom = book.book?.risk_budget.gross_exposure;
  const intentNote = book.book
    ? `${usd(modeledCost, 0)} modeled cost · gross ${usd(exposure?.gross ?? 0, 0)}${
        headroom ? ` · ${usd(headroom.remaining, 0)} headroom` : ""
      }${book.book.sandbox ? " · sandbox" : ""}`
    : "book connecting";

  // ---- data plane --------------------------------------------------------
  const latency = summary?.latency ?? null;
  const tone = latencyTone(latency?.p99 ?? null, latency?.n ?? 0, latency?.errorRate ?? 0);
  const p99History = systems.latencyHistory
    .map((p) => p.p99)
    .filter((v): v is number => v != null);
  const dataValue = summary ? `${summary.ready}/${summary.total} ready` : "Checking";
  const dataNote = systems.healthError
    ? `unreachable — snapshot from ${systems.updatedAt?.toLocaleTimeString() ?? "earlier"}`
    : summary
      ? `p99 ${latency?.p99 != null && (latency?.n ?? 0) >= 20 ? `${Math.round(latency.p99)}ms` : "—"} · `
        + `cache ${systems.cacheHitRate == null ? "no lookups yet" : `${Math.round(systems.cacheHitRate * 100)}%`}`
        + `${systems.health?.quarantine?.size ? ` · ${systems.health.quarantine.size} quarantined` : ""}`
      : "checking data plane";

  return (
    <section
      aria-label="Current decision context"
      className="relative z-[2] mt-3 grid grid-cols-4 gap-2.5 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1"
    >
      <KpiCard
        label="Research candidate"
        value={candidateValue}
        note={candidateNote}
        mono={false}
        spark={
          equitySpark.length >= 2 ? (
            <Sparkline
              variant="area"
              points={equitySpark}
              width={96}
              height={30}
              ariaLabel={`Equity curve of the current candidate, ending at ${fmt(equitySpark[equitySpark.length - 1], 2)}×`}
            />
          ) : undefined
        }
      />
      <KpiCard label="Out-of-sample Sharpe" value={oosValue} note={oosNote} />
      <KpiCard label="Order intent" value={`${side} ${usd(notional, 0)}`} note={intentNote} />
      <KpiCard
        label="Data plane"
        value={dataValue}
        note={dataNote}
        spark={
          p99History.length >= 2 ? (
            <Sparkline
              points={p99History}
              width={96}
              height={30}
              tone={tone.tone === "bad" ? "critical" : tone.tone === "warn" ? "warn" : tone.tone === "muted" ? "muted" : "good"}
              ariaLabel={`Upstream p99 latency over recent polls, currently ${Math.round(p99History[p99History.length - 1])} milliseconds, ${tone.label}`}
            />
          ) : undefined
        }
      />
    </section>
  );
}
