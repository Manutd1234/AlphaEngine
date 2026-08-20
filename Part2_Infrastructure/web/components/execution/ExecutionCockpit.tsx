"use client";

/**
 * The cockpit: everything a trader needs about their own flow, in one place.
 *
 * The Execution tab used to show market data only — books, spreads, cost
 * estimates. Everything about what the desk had actually *done* lived on other
 * surfaces: positions on the portfolio tab, the decision trail in the gateway
 * console, alerts in Telegram. A trader watching a book cannot answer "did that
 * order fill, and what did it cost" without leaving the screen they are
 * watching, which is exactly when they should not be leaving it.
 *
 * So this composes four panels around one polled snapshot of gateway state:
 *
 *   P&L strip   what the book is worth and how close it is to a halt
 *   Ticket      send an order and see every gate's verdict
 *   Blotter     what was sent, what it cost, and which gate stopped it
 *   Alert feed  what the system decided on its own
 *
 * One poll drives all four. Four panels polling independently would show four
 * different moments of the same book, and a trader comparing a position against
 * the fill that created it would be comparing across time without knowing it.
 *
 * The cockpit runs in one of three modes, decided by the gateway routes'
 * failure codes and never guessed:
 *
 *   live          the gateway answered; everything is authoritative
 *   sandbox       there IS no gateway in this deployment
 *                 (`gateway_not_configured` from every route) — the desk runs
 *                 on generated, banner-labelled data, and the ticket judges
 *                 orders locally with the gateway's own gate logic
 *   outage        a gateway is configured but failing — nothing is generated,
 *                 because fake data is most dangerous during a real incident
 *
 * What is in THIS file is the composition: which panels exist, which subtab
 * each belongs to, and which pane of a subtab is open. The poll that feeds
 * them all — its deadlines, its backoff, its hidden-tab gate and the mode it
 * decides — is `useCockpitFeed`, called once at the top of the component and
 * above the bail-out, which is the whole reason it is a hook and not a fetch
 * in each panel. `CockpitChrome` holds the first-load placeholder and the two
 * mode banners.
 */

import { useState } from "react";

import { WorkspaceSubtabPanel } from "@/components/WorkspaceSubtabs";
import type { ExecutionSection } from "@/lib/sections";
import type { Strategy } from "@/lib/types";

import AlertFeed from "./AlertFeed";
import BlotterViews from "./BlotterViews";
import { CockpitBanners, CockpitPlaceholder } from "./CockpitChrome";
import DeskTape from "./DeskTape";
import ExecutionQuality from "./ExecutionQuality";
import FillQualityHeatmap from "./FillQualityHeatmap";
import OrderTicket, { type OrderSubmissionResult } from "./OrderTicket";
import PnlStrip from "./PnlStrip";
import SpreadDecomposition from "./SpreadDecomposition";
import VenueMixDonut from "./VenueMixDonut";
import { useCockpitFeed } from "./use-cockpit-feed";

// Re-exported so the mode union keeps one name in the tree: the panels below
// take it as a prop and the hook is what decides it.
export type { CockpitMode } from "./use-cockpit-feed";

/**
 * Fill quality was the densest section in the app: four analyses, three tables
 * and three charts in one scroll, which is two readings stacked rather than one.
 *
 * Cost is the headline — what execution cost against the model, and the latency
 * distribution behind it. Where is the attribution: which venue, which part of
 * the spread, and at which hour. Splitting on that seam also stops
 * `FillQualityHeatmap` from pushing the primary metric off screen; it draws only
 * above its own sample floor, so on a short window it is a paragraph explaining
 * how far along the collection is, and that paragraph does not belong between a
 * trader and their fill rate.
 *
 * Two panes, not three: the decomposition and the venue mix answer one question
 * between them and the pane below keeps them side by side.
 */
type QualityPane = "cost" | "where";

const QUALITY_PANES: Array<{ id: QualityPane; label: string; hint: string }> = [
  { id: "cost", label: "Cost", hint: "Fill rate, realised slippage, fees and the decision-latency tail" },
  { id: "where", label: "Where", hint: "Which venue, which part of the spread, and which hour the cost came from" },
];

/**
 * Activity, split along the record/stream seam.
 *
 * The blotter, the decision tape and the alert feed sat in one scroll, and the
 * only thing keeping them straight was order: the tape came after the blotter
 * so the record was read before the stream. A split states the same argument
 * with geometry instead of position. The Blotter pane is the record — every
 * order the desk sent, polled from the gateway's authoritative store, with the
 * resting book beside it. The Tape & alerts pane is the desk happening: the
 * realtime mirror of decisions as Postgres commits them, and what the risk
 * system decided on its own. The seg opens on Blotter for the reason the old
 * ordering existed — reading the stream first invites treating it as the
 * record, which is exactly what a channel that drops silently cannot be.
 */
type ActivityPane = "blotter" | "tape";

const ACTIVITY_PANES: Array<{ id: ActivityPane; label: string; hint: string }> = [
  { id: "blotter", label: "Blotter", hint: "The record: every order sent, what it cost, which gate stopped it, and the resting book" },
  { id: "tape", label: "Tape & alerts", hint: "The stream: decisions as Postgres commits them, and the alerts risk raised on its own" },
];


export interface CockpitProps {
  /**
   * This visitor's sandbox seed, from `useBook` so there is one of them.
   * Undefined is a valid value — the server pass and the first client render —
   * and means the shared worked example.
   */
  seed?: number;
  symbol: string;
  side: "BUY" | "SELL";
  notional: number;
  orderType: "MARKET" | "LIMIT";
  limitPrice: number | null;
  section: ExecutionSection;
  onSideChange: (side: "BUY" | "SELL") => void;
  onNotionalChange: (notional: number) => void;
  onOrderTypeChange: (orderType: "MARKET" | "LIMIT") => void;
  onLimitPriceChange: (price: number | null) => void;
  /** Operator credential shared with the Reliability tab and the header. */
  operatorToken?: string;
  operatorGuard?: "token" | "open-dev" | "open-demo" | "locked";
  operatorTokenEnv?: string;
  paperOrderDefaultAvailable?: boolean;
  onOperatorTokenChange?: (token: string) => void;
  /** Execution-owned strategy sleeve; promotion may seed it, the ticket may override it. */
  strategy: Strategy;
  onStrategyChange: (strategy: Strategy) => void;
  /** Experiment id to stamp on the order so a fill can be traced to its idea. */
  researchExperimentId?: string | null;
  /** Invalidates the shared Portfolio/Risk snapshot after a live decision. */
  onOrderSettled?: (result: OrderSubmissionResult) => void;
  onOpenResearch?: () => void;
}

export default function ExecutionCockpit({
  seed,
  symbol,
  side,
  notional,
  orderType,
  limitPrice,
  section,
  onSideChange,
  onNotionalChange,
  onOrderTypeChange,
  onLimitPriceChange,
  operatorToken,
  operatorGuard,
  operatorTokenEnv,
  paperOrderDefaultAvailable,
  onOperatorTokenChange,
  strategy,
  onStrategyChange,
  researchExperimentId,
  onOrderSettled,
  onOpenResearch,
}: CockpitProps) {
  /**
   * One poll, one mode, one invalidation path — see `use-cockpit-feed`.
   *
   * Called before anything else in this component and never behind a
   * condition: the bail-out below returns, and a hook after a return is the
   * shape React throws "rendered more hooks than during the previous
   * render" on.
   */
  const {
    mode, book, problem, loading, lastSyncAt, unconfigured, sandboxOff, setSandboxOff,
    refresh, revalidate, judge, effectiveBook, effectiveEvents, effectiveOrders,
    feedSource, summary, symbolOrders,
  } = useCockpitFeed({ seed, symbol, onOrderSettled });
  /**
   * Above the loading bail-out below, with the rest of them, and a fixed
   * default rather than one derived from the reader's complexity tier: a pane
   * that opens somewhere different depending on a setting is a different
   * screen for every reader, and Cost is the metric the section is named for.
   */
  const [qualityPane, setQualityPane] = useState<QualityPane>("cost");
  /** Same discipline, and "blotter" for the reason ACTIVITY_PANES argues: the
   *  record is what opens first. */
  const [activityPane, setActivityPane] = useState<ActivityPane>("blotter");

  if (loading && !book && !problem) {
    return <CockpitPlaceholder section={section} />;
  }

  return (
    <div className="cockpit">
      <CockpitBanners
        mode={mode}
        unconfigured={unconfigured}
        sandboxOff={sandboxOff}
        onSandboxOff={setSandboxOff}
      />

      {(section === "trade" || mode === "outage") && (
        <PnlStrip
          book={effectiveBook}
          mode={mode}
          problem={problem}
          lastSyncAt={lastSyncAt}
          onRefresh={() => void refresh()}
          onEnterSandbox={unconfigured ? () => setSandboxOff(false) : undefined}
          compact={section === "trade"}
        />
      )}

      <WorkspaceSubtabPanel workspaceId="execution" tabId="trade" activeId={section}>
        <div className="cockpit-grid cockpit-grid--ticket">
          <OrderTicket
            symbol={symbol}
            side={side}
            notional={notional}
            orderType={orderType}
            limitPrice={limitPrice}
            onSideChange={onSideChange}
            onNotionalChange={onNotionalChange}
            onOrderTypeChange={onOrderTypeChange}
            onLimitPriceChange={onLimitPriceChange}
            operatorToken={operatorToken}
            operatorGuard={operatorGuard}
            operatorTokenEnv={operatorTokenEnv}
            paperOrderDefaultAvailable={paperOrderDefaultAvailable}
            onOperatorTokenChange={onOperatorTokenChange}
            strategy={strategy}
            onStrategyChange={onStrategyChange}
            experimentId={researchExperimentId ?? null}
            halted={effectiveBook?.trading_halted ?? false}
            haltedSymbols={effectiveBook?.halted_symbols ?? []}
            mode={mode}
            judge={mode === "sandbox" ? judge : undefined}
            onSubmitted={revalidate}
          />
        </div>
      </WorkspaceSubtabPanel>

      {/* Two reading modes, and they were sharing a section. Quality is the
          analysis — what execution cost against the model. The blotter below
          is the record: what was actually sent, what landed, what alerted. */}
      <WorkspaceSubtabPanel workspaceId="execution" tabId="quality" activeId={section}>
        <div className="seg" role="group" aria-label="Fill quality view">
          {QUALITY_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={qualityPane === option.id}
              title={option.hint}
              onClick={() => setQualityPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Conditional renders, not `hidden`. Nothing here holds typed input to
            preserve, and every panel below reads the same `effectiveOrders`
            array the cockpit already polls — so a switched-away pane that
            stayed mounted would buy nothing and keep three charts measuring
            their own width behind something nobody is reading. */}
        {qualityPane === "cost" && (
          <ExecutionQuality
            summary={summary}
            symbol={symbol}
            symbolOrders={symbolOrders}
            rows={effectiveOrders}
            source={feedSource}
          />
        )}

        {qualityPane === "where" && (
          <>
            {/* What each fill cost, and where it was filled. Side by side
                because they answer one question between them: the decomposition
                says how much, the mix says where — and a spread that only looks
                bad on one venue is a routing problem rather than a market one.
                The cut goes above this pair, never through it. */}
            <div className="cockpit-grid">
              <SpreadDecomposition rows={effectiveOrders} source={feedSource} />
              <VenueMixDonut rows={effectiveOrders} source={feedSource} />
            </div>
            {/* Renders only above its own sample floor — see the component. Its
                two neighbours have no floor, so this pane still says something
                on a short window rather than going quiet. */}
            <FillQualityHeatmap rows={effectiveOrders} source={feedSource} />
          </>
        )}
      </WorkspaceSubtabPanel>

      <WorkspaceSubtabPanel workspaceId="execution" tabId="activity" activeId={section}>
        <div className="seg" role="group" aria-label="Activity view">
          {ACTIVITY_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={activityPane === option.id}
              title={option.hint}
              onClick={() => setActivityPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Conditional renders, not `hidden`, like Fill quality above — with
            one cost the quality panes do not pay: switching away unmounts the
            tape, and the rows its channel gathered this session are gone when
            it remounts. Accepted, on the tape's own doctrine — it is watched,
            not counted on, and every decision it ever showed is in the store
            the Blotter pane polls. Keeping it mounted to preserve a window
            nobody may read again would promote the stream toward being a
            record, which is the one thing this split exists to prevent. */}
        {activityPane === "blotter" && (
          <BlotterViews
            rows={effectiveOrders}
            focusSymbol={symbol}
            source={feedSource}
            active={section === "activity"}
            operatorToken={operatorToken}
            onChanged={revalidate}
            onOpenResearch={onOpenResearch}
          />
        )}

        {activityPane === "tape" && (
          <>
            <DeskTape symbol={symbol} />
            <AlertFeed events={effectiveEvents} source={feedSource} />
          </>
        )}
      </WorkspaceSubtabPanel>
    </div>
  );
}
