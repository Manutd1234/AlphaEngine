"use client";

/**
 * The command centre's KPI deck — eight cards, every number real.
 *
 * The first four answer "what is the desk deciding"; the second four answer
 * "what is the desk carrying". They deliberately do not restate the hero band
 * above them (equity, day P&L, VaR 95, p99): where the hero gives the headline
 * figure, these give the shape behind it — the constraint that binds, the loss
 * beyond the quantile, the concentration under the gross.
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

import NumberTicker from "@/components/common/NumberTicker";
import Sparkline from "@/components/overview/Sparkline";
import { constraintLabel, fmt, signedPct, usd } from "@/lib/format";
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
  titleText,
}: {
  label: string;
  value: ReactNode;
  note: ReactNode;
  spark?: ReactNode;
  mono?: boolean;
  /** Hover text when `value` is JSX (NumberTicker) rather than a plain string. */
  titleText?: string;
}) {
  /*
   * rounded-card and the card padding tokens, not a literal 12px and py-4: this
   * was the only tile in the app that hand-rolled the card look, and a radius
   * differing from every other card by 2px reads as a rendering fault rather
   * than a choice. --card-pad-tight is the house step-down for dense panels,
   * which is exactly what a KPI deck is.
   */
  return (
    <div className="grid min-w-0 gap-0.5 rounded-card border border-border bg-surface-1 px-[var(--card-pad)] py-[var(--card-pad-tight)]">
      <span className="text-fs-2xs font-bold uppercase tracking-[0.07em] text-text-muted">{label}</span>
      {/* The value owns its own row.
          It used to share one with the sparkline, and that row carried no
          `min-w-0` — so as a grid item its automatic minimum size was its
          max-content width (a 246px strategy label + a rigid 96px chart in a
          311px card). Neither child could shrink, the row simply overflowed,
          and the chart drew itself outside the card's right border. Here the
          value gets the full width and truncates on its own terms, and the
          chart shares the quieter bottom line with the note. */}
      <strong
        /* Narrow decks truncate "Moving-average crossover · 30/200" past the
           parameters, which are the half worth reading. The full string stays
           available on hover. */
        title={typeof value === "string" ? value : titleText}
        className={`min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-fs-h2 leading-[1.25] ${mono ? "num" : ""}`}
      >
        {value}
      </strong>
      {/* The note wraps to two lines rather than truncating on one.
          `whitespace-nowrap` cost the order-intent card 165px of its own text
          at 1024px — "$5 modelled cost · gross $8,600,000 · $3,…" losing the
          headroom figure, which is the number the sentence exists to deliver.
          A tooltip is not the fix here: this deck is read on tablets and
          phones, where there is no hover to recover a clipped line with. */}
      <div className="flex min-w-0 items-start justify-between gap-2">
        <small className="kpi-card__note min-w-0 text-fs-sm text-text-muted">{note}</small>
        {spark}
      </div>
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
  const candidateTitle = shown
    ? `${STRATEGY_LABELS[shown.request.strategy]} ${shown.best.fast}/${shown.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  // The parameters tick when a sweep lands on a new winner; the label never
  // animates — a strategy name has no intermediate values.
  const candidateValue = shown
    ? (
      <>
        {STRATEGY_LABELS[shown.request.strategy]} <NumberTicker value={shown.best.fast} />/<NumberTicker value={shown.best.slow} />
      </>
    )
    : STRATEGY_LABELS[request.strategy];
  const candidateNote = running
    ? "sweep in progress"
    : researchStale && shown
      ? `context changed — was ${shown.request.symbol}; rerun required`
      : shown
        ? `${shown.verdict.level.toUpperCase()}, Sharpe ${fmt(shown.best.sharpe, 2)}`
        : "no completed run";
  const equitySpark = shown ? downsample(shown.series.map((p) => p.equity), 64) : [];

  // ---- OOS validation ----------------------------------------------------
  const oos = shown?.walkForwardOosSharpe ?? null;
  const oosValue = shown
    ? oos == null
      ? "Not available"
      : <NumberTicker value={oos} format={(v) => fmt(v, 2)} />
    : running ? "Running" : "Pending";
  const trl = shown?.minTrackRecord?.vsZero ?? null;
  const oosNote = shown
    ? trl
      ? trl.bars == null
        ? "no finite record proves this edge"
        : trl.sufficient
          ? `track record met; ${signedPct(shown.best.totalReturn)} in-sample`
          : `needs ~${fmt(trl.years, 1)} y of history; ${signedPct(shown.best.totalReturn)} in-sample`
      : `${signedPct(shown.best.totalReturn)} in-sample return`
    : "awaiting result";

  // ---- order intent ------------------------------------------------------
  const modelledCost = (notional * request.slippageBps) / 1e4;
  const exposure = book.book?.exposure;
  const headroom = book.book?.risk_budget.gross_exposure;
  // Gross and headroom are not repeated here: Gross exposure is a card in
  // this same grid with that figure as its headline, and Binding constraint's
  // note is "<limit>; <headroom> left of <limit>". What only this card knows
  // is what the intent would cost and whose book it would touch.
  const intentNote = book.book
    ? `${usd(modelledCost, 0)} modelled cost${book.book.sandbox ? "; sandbox" : ""}`
    : "book connecting";

  // ---- data plane --------------------------------------------------------
  const latency = summary?.latency ?? null;
  const tone = latencyTone(latency?.p99 ?? null, latency?.n ?? 0, latency?.errorRate ?? 0);
  const p99History = systems.latencyHistory
    .map((p) => p.p99)
    .filter((v): v is number => v != null);
  const dataValue = summary
    ? <><NumberTicker value={summary.ready} />/{summary.total} ready</>
    : "Checking";
  const dataNote = systems.healthError
    ? `unreachable — snapshot from ${systems.updatedAt?.toLocaleTimeString() ?? "earlier"}`
    : summary
      // No p99 here — it is the headline of the band's own Data plane p99
      // tile, directly above this grid. The cache and the quarantine are
      // this card's alone.
      ? `cache ${systems.cacheHitRate == null ? "no lookups yet" : `${Math.round(systems.cacheHitRate * 100)}%`}`
        + `${systems.health?.quarantine?.size ? `; ${systems.health.quarantine.size} quarantined` : ""}`
      : "checking data plane";

  // ---- what the desk is carrying ----------------------------------------
  const risk = book.risk;
  const concentration = book.book?.concentration ?? null;
  const budget = book.book?.risk_budget ?? null;
  const [constraintName, constraintUse] = budget?.binding_constraint ?? [null, null];

  return (
    <section
      aria-label="Current decision context"
      // No mt-3: the overview page's grid gap plus the rail's own margin
      // already open every pane 28px below the rail. This margin made the
      // Decision loop pane alone start at ~39px, so content jumped
      // vertically on every tab switch.
      className="relative z-[2] grid grid-cols-4 gap-3 max-[900px]:grid-cols-2 max-[520px]:grid-cols-1"
    >
      <KpiCard
        label="Research candidate"
        value={candidateValue}
        note={candidateNote}
        mono={false}
        titleText={candidateTitle}
        spark={
          equitySpark.length >= 2 ? (
            <Sparkline
              variant="area"
              points={equitySpark}
              width={120}
              height={34}
              ariaLabel={`Equity curve of the current candidate, ending at ${fmt(equitySpark[equitySpark.length - 1], 2)}×`}
            />
          ) : undefined
        }
      />
      <KpiCard label="Out-of-sample Sharpe" value={oosValue} note={oosNote} />
      <KpiCard
        label="Order intent"
        value={<>{side} <NumberTicker value={notional} format={(v) => usd(v, 0)} /></>}
        note={intentNote}
        titleText={`${side} ${usd(notional, 0)}`}
      />
      <KpiCard
        label="Data plane"
        value={dataValue}
        note={dataNote}
        spark={
          p99History.length >= 2 ? (
            <Sparkline
              points={p99History}
              width={120}
              height={34}
              tone={tone.tone === "bad" ? "critical" : tone.tone === "warn" ? "warn" : tone.tone === "muted" ? "muted" : "good"}
              ariaLabel={`Upstream p99 latency over recent polls, currently ${Math.round(p99History[p99History.length - 1])} milliseconds, ${tone.label}`}
            />
          ) : undefined
        }
      />

      <KpiCard
        label="Gross exposure"
        value={exposure ? usd(exposure.gross, 0) : "—"}
        note={
          exposure
            ? `net ${usd(exposure.net, 0)}, ${fmt(exposure.leverage, 2)}× leverage`
            : "book connecting"
        }
      />
      <KpiCard
        label="Binding constraint"
        value={
          constraintName && constraintUse != null
            ? `${Math.round(constraintUse * 100)}% used`
            : "—"
        }
        note={
          constraintName && headroom
            ? `${constraintLabel(constraintName)}; ${usd(headroom.remaining, 0)} left of ${usd(headroom.limit, 0)}`
            : constraintName
              ? constraintLabel(constraintName)
              : "no limit engaged yet"
        }
      />
      <KpiCard
        label="Loss beyond VaR"
        value={risk ? usd(risk.cvar95, 0) : "—"}
        /* The zone belongs to the band's VaR tile, which states it under the
           figure it validates. This deck's rule is that it does not restate
           the band above it — the same rule that keeps CVaR out of that tile
           and puts it here. */
        note={risk ? `${signedPct(risk.annualisedVolatility)} annualised vol` : "needs price history"}
      />
      <KpiCard
        label="Book concentration"
        value={
          concentration
            ? `${fmt(concentration.effective_positions, 1)} effective`
            : "—"
        }
        /* No quarantine count: the Data plane card in this same grid carries
           it, and the deck's rule is that a figure is printed once. */
        note={
          concentration
            ? `${concentration.positions} held, largest ${Math.round(concentration.largest_share * 100)}%`
            : "book connecting"
        }
      />
    </section>
  );
}
