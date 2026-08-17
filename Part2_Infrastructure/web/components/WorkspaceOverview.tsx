"use client";

/**
 * The command center — a composer since the four-feature upgrade.
 *
 * The hero pipeline, KPI deck and role launcher live in components/overview/;
 * this file derives their inputs from live page state. Provider readiness reads
 * the polled health snapshot (the old one-shot /api/providers summary froze at
 * load and duplicated a subset of it).
 *
 * The exception board that used to sit between the deck and the launcher is
 * gone: its four rows restated the four stages the hero pipeline already
 * derives from the same call, one screen higher.
 */

import NumberTicker from "@/components/common/NumberTicker";
import AuditTrail from "@/components/overview/AuditTrail";
import DecisionLoopPipeline from "@/components/overview/DecisionLoopPipeline";
import KpiDeck from "@/components/overview/KpiDeck";
import RoleCards, { type RoleContext } from "@/components/overview/RoleCards";
import Sparkline from "@/components/overview/Sparkline";
import PageHead from "@/components/workspace/PageHead";
import WorkspaceSubtabs, { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import { STRATEGY_LABELS, SweepRequest, SweepResponse } from "@/lib/types";
import { fmt, signedPct, usd } from "@/lib/format";
import { deriveDecisionLoop, downsample, type StageId } from "@/lib/overview-state";
import { OVERVIEW_SECTIONS, type OverviewSection } from "@/lib/sections";
import type { Side } from "@/lib/venues";
import type { WorkspaceView } from "@/components/WorkspaceHeader";
import type { BookView } from "@/lib/use-book";
import type { SystemHealthView } from "@/lib/use-system-health";

interface WorkspaceOverviewProps {
  request: SweepRequest;
  result: SweepResponse | null;
  running: boolean;
  researchStale: boolean;
  /** The previous run while the desk context is dirty — shown labelled. */
  staleResult: SweepResponse | null;
  side: Side;
  notional: number;
  book: BookView;
  systems: SystemHealthView;
  onNavigate: (view: WorkspaceView) => void;
  /** Opens the section a pipeline stage's own verdict is computed from. */
  onOpenStage: (stage: StageId) => void;
  onRun: () => void;
  section: OverviewSection;
  onSectionChange: (section: OverviewSection) => void;
  /**
   * False while this workspace is mounted but hidden behind another tab.
   * Panels persist across switches now; a hidden tab must not keep polling.
   */
  active?: boolean;
}

export default function WorkspaceOverview({
  request,
  result,
  running,
  researchStale,
  staleResult,
  side,
  notional,
  book,
  systems,
  onNavigate,
  onOpenStage,
  onRun,
  section,
  onSectionChange,
  active = true,
}: WorkspaceOverviewProps) {
  const summary = systems.health?.summary;
  const capabilitiesDown = systems.health
    ? Object.values(systems.health.capabilities).filter((c) => c.available.length === 0).length
    : 0;

  const stages = deriveDecisionLoop({
    healthPresent: systems.health !== null,
    healthError: Boolean(systems.healthError),
    degradedCount: systems.degraded,
    capabilitiesDown,
    quarantineSize: systems.health?.quarantine?.size ?? 0,
    providersReady: summary?.ready ?? 0,
    providersTotal: summary?.total ?? 0,
    running,
    researchStale,
    verdictLevel: result?.verdict.level ?? null,
    bookPresent: book.book !== null,
    bookSandbox: Boolean(book.book?.sandbox),
    bookStale: book.isStale,
    // Null while the first probe is still in flight: useBook reports "error"
    // for the no-book-no-error initial state, and a verdict must not be
    // rendered before anything was actually measured.
    bookConnection: book.book || book.error ? book.connectionState : null,
    bookErrorCode: book.error?.code ?? null,
    riskUtilisation: book.book?.risk_budget.binding_constraint?.[1] ?? null,
    bindingConstraint: book.book?.risk_budget.binding_constraint?.[0] ?? null,
    varZone: book.varValidation?.zone ?? null,
    tradingHalted: Boolean(book.book?.trading_halted),
    haltedSymbolCount: book.book?.halted_symbols.length ?? 0,
    // Real gateway blotter only; the sandbox blotter is generated data.
    fillRate: null,
  });

  const shown = result ?? staleResult;
  const candidate = shown
    ? `${STRATEGY_LABELS[shown.request.strategy]} · ${shown.best.fast}/${shown.best.slow}`
    : STRATEGY_LABELS[request.strategy];
  const validation = result
    ? result.walkForwardOosSharpe == null
      ? "Not available"
      : fmt(result.walkForwardOosSharpe, 2)
    : running
      ? "Running"
      : "Pending";
  const providers = summary ? `${summary.ready}/${summary.total}` : "Checking";
  const researchStatus = researchStale
    ? "Context changed · rerun required"
    : result
      ? `${result.verdict.level.toUpperCase()} · ${validation} OOS Sharpe`
      : running
        ? "Baseline running"
        : "Awaiting validation";
  const systemStatus = systems.degraded
    ? `${systems.degraded} degraded`
    : summary
      ? `${providers} ready`
      : "Checking routes";

  /**
   * The one primary action on the overview.
   *
   * The launcher used to carry seven, one per desk, all identical — which told
   * a reader nothing about which desk to open. The loop already knows: the
   * first stage that is not `ok` is the thing holding the desk up, so that
   * stage names the action. When everything is clear the loop continues at
   * research, which is where the next decision starts.
   */
  const blocking = stages.find((stage) => stage.state !== "ok" && stage.state !== "idle");
  const primaryAction: { label: string; run: () => void } = (() => {
    switch (blocking?.id) {
      case "data":
        return { label: "Inspect data health", run: () => onNavigate("data") };
      case "research":
        return researchStale || !result
          ? { label: running ? "Research running…" : "Run research", run: onRun }
          : { label: "Review the verdict", run: () => onNavigate("research") };
      case "risk":
        return { label: "Open risk limits", run: () => onNavigate("risk") };
      case "execution":
        return { label: "Open execution", run: () => onNavigate("live") };
      default:
        return { label: "Open research", run: () => onNavigate("research") };
    }
  })();

  /**
   * The hero band. Four figures the desk asks for before anything else, all
   * from state this component already receives — the strip adds no request.
   * Each carries its own provenance and its own honest empty state, because a
   * dash with no explanation reads as breakage rather than as absence.
   */
  const equity = book.book?.equity ?? null;
  const equitySpark = downsample(book.equityTrack.map((p) => p.equity), 64);
  const dayTone = equity ? (equity.daily_pnl >= 0 ? "up" : "down") : null;
  const risk = book.risk;
  const latency = summary?.latency ?? null;
  const latencyMeasured = latency?.p99 != null && (latency.n ?? 0) >= 20;

  const context: RoleContext = {
    symbol: request.symbol,
    candidate,
    researchStatus,
    side,
    notional,
    slippageBps: request.slippageBps,
    providers,
    systemStatus,
  };

  return (
    <div className="overview-page">
      {/* The command centre band. Two things are true of it at once, and the
          combination is the point.

          It keeps the dark plane the overview has always opened on — this is
          the desk's landing surface and it is meant to read as one. But it no
          longer owns a private colour system to do it. `data-plane="inverted"`
          scopes the DARK THEME'S OWN tokens to this subtree, so the head, the
          chips, the loop tiles, the button and the sparkline all render dark
          through the ordinary names. The ten `--hero-*` tokens that used to
          exist for this one band — a plane, five ink steps and a duplicate of
          the status ramp — are gone, and status colour has one spelling again.

          Inside it, the head is the same `PageHead` the other seven tabs
          render, with the same chip anatomy and the same height. */}
      <section className="overview-hero" data-plane="inverted">
      <PageHead
        kicker="AlphaEngine command center"
        /* The tagline, not "Overview" — the user's explicit choice for the
           landing tab. The nav rail already says Overview one row up, so the
           h1 is free to say what the desk does; the other seven tabs keep
           their one-word titles and their 171px parity. The `.overview-hero
           .page-heading h1` rule scales this up to headline size — the band
           is meant to be the eye-catching surface on the desk. */
        title="From market signal to governed decision."
        description={<>{request.symbol} research evidence, portfolio risk, execution intent and data health share one context — and reconcile to the same audit trail.</>}
        metrics={[
          {
            label: "Equity",
            value: equity ? <NumberTicker value={equity.current} format={(v) => usd(v, 0)} /> : "—",
            note: equity ? `start ${usd(equity.start_of_day, 0)} · gateway snapshot` : "book connecting",
            spark: equitySpark.length >= 2 ? (
              <Sparkline
                variant="area"
                points={equitySpark}
                width={90}
                height={26}
                ariaLabel={`Equity through the session, ending at ${usd(equitySpark[equitySpark.length - 1], 0)}`}
              />
            ) : undefined,
          },
          {
            label: "Day P&L",
            // The sign stays outside the ticker so the count never crosses zero
            // mid-animation with the wrong prefix.
            value: equity
              ? <>{equity.daily_pnl >= 0 ? "+" : "−"}<NumberTicker value={Math.abs(equity.daily_pnl)} format={(v) => usd(v, 0)} /></>
              : "—",
            note: equity ? `${signedPct(equity.daily_return)} · ${dayTone} on the session` : "book connecting",
            tone: equity ? (equity.daily_pnl >= 0 ? "good" : "critical") : "neutral",
          },
          {
            label: "VaR 95, 1 day",
            value: risk ? usd(risk.var95, 0) : "—",
            /* No CVaR here: the KPI deck's "Loss beyond VaR" card one screen
               down has it as its headline, and the deck's own rule is that it
               does not restate the band above it. */
            note: risk
              ? `${book.varValidation ? `zone ${book.varValidation.zone} · ` : ""}backtested in this browser`
              : "needs price history",
          },
          {
            label: "Data plane p99",
            value: latencyMeasured
              ? <NumberTicker value={latency!.p99!} format={(v) => `${Math.round(v)}ms`} />
              : "—",
            note: latencyMeasured
              ? `${summary?.ready ?? 0}/${summary?.total ?? 0} routes ready${systems.degraded ? ` · ${systems.degraded} degraded` : ""} · measured from this browser's polls`
              : "fewer than 20 polls measured",
          },
        ]}
        actions={
          <button
            type="button"
            className="overview-cta"
            onClick={primaryAction.run}
            disabled={running && primaryAction.label.endsWith("…")}
          >
            {primaryAction.label}
            <span aria-hidden>→</span>
          </button>
        }
      />

        <div className="overview-loop" aria-label="AlphaEngine decision loop">
          <DecisionLoopPipeline stages={stages} onOpenStage={onOpenStage} />
        </div>
      </section>

      {/* The band stays above the rail the way BookChrome does on
          Portfolio/Risk — it is the workspace's identity, not a section. The
          three sections below it are real locations. */}
      <WorkspaceSubtabs
        workspaceId="overview"
        label="Overview sections"
        tabs={OVERVIEW_SECTIONS}
        activeId={section}
        onChange={onSectionChange}
        active={active}
      />

      <WorkspaceSubtabPanel workspaceId="overview" tabId="loop" activeId={section}>
        <KpiDeck
          request={request}
          result={result}
          running={running}
          researchStale={researchStale}
          staleResult={staleResult}
          side={side}
          notional={notional}
          book={book}
          systems={systems}
        />
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="overview" tabId="desks" activeId={section}>
        <section className="overview-section" aria-label="Desk role workspaces">
          {/* No heading row. "Workspaces — one tab per desk role" restated
              what the rail tab the reader just pressed already says, and each
              card below names its role in its own kicker; the aria-label keeps
              the section named for a screen reader without spending a visual
              row on it. */}

          {/* Ordered the way work moves — an idea is researched, executed, held,
              and constrained — then the three roles that keep that possible.

              Six further props used to be threaded in here — a run handler, two
              refresh callbacks and the flags that would have disabled them. The
              launcher reads none of them: it has one button per card and always
              has, so two of those callbacks were wired to no control at all. */}
          <RoleCards context={context} onNavigate={onNavigate} />
        </section>
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="overview" tabId="audit" activeId={section}>
        {/* The same seed the rest of the desk generates from, so the audit
            rows here are the orders the Execution blotter lists. */}
        <AuditTrail active={active && section === "audit"} seed={book.seed} />
      </WorkspaceSubtabPanel>
    </div>
  );
}

