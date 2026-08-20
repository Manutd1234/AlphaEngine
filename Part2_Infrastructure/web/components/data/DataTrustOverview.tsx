"use client";

/**
 * Trust Summary in three panes, Feeds & Contracts in two.
 *
 * Two structural facts drive this file.
 *
 * 1. THE COUNTERS SPLIT IN HALF. `validation.*`, `cache.byCapability`,
 *    `events.*` and `quarantine.*` are incremented only inside `dispatch()`,
 *    which runs in the `/api/quote`-family lambdas. `/api/system/health` is
 *    answered by a different serverless process with its own module scope, so
 *    those four are near-empty on a fully warm, heavily-trafficked deployment.
 *    The registry, failover graph, quota ledger and gateway ops snapshot are
 *    built DURING the health request and are populated every time. So the
 *    analytics live on the second half (Verdict and Response), and the
 *    ring-backed panels are kept, shrunk into one pane, and made to state the
 *    boundary they measure inside rather than implying a quiet desk.
 *
 * 2. IT WAS NINE CARDS IN ONE SCROLL. The house in-panel pattern is
 *    `.seg role="group"`, as `ReliabilityOverview` uses. Deliberately NOT a
 *    nested `<WorkspaceSubtabs>`: that publishes `--rail-h` from a
 *    ResizeObserver and asserts exactly one rail is mounted, so a second would
 *    fight the first over every sticky offset in the app. Panes are conditional
 *    renders, never `hidden` — a switched-away pane must stop observing.
 *
 *    Both halves now carry a switcher, and each keeps its own state. `view`
 *    decides which half an instance draws, and `DataConsole` mounts one
 *    instance per section, so the pane a reader left in Summary is not the
 *    pane they land on in Feeds & Contracts.
 *
 * 3. PROSE EARNS ITS PAINT. Methodology paragraphs fold into `.disclosure`
 *    blocks whose summaries state the fact they explain; measured figures,
 *    verdicts and every empty state's honest sentence stay outside the fold.
 *    A fact a chart's own legend or a section-note already prints is not
 *    restated in prose beside it — the house calls the repeat noise, not
 *    honesty.
 *
 * 4. THE PANES ARE FILES. Five of them were inline, and the file was 747 lines
 *    of one function. `view`/`pane` state, both segmented controls and the
 *    verdict pane stay here — the switcher has to own the state it switches —
 *    and each of the other four panes is a sibling component mounted by the
 *    same conditional it was rendered behind. Nothing became `hidden` in the
 *    move: a pane the reader is not on is still not mounted, so it is still not
 *    observing.
 */

import { useState } from "react";

import type { InspectResponse, SystemHealth } from "@/components/systems/types";
import { deriveDataTrust, type DataTrustDestination } from "@/lib/data-trust";

import FeedsContractsPane from "./FeedsContractsPane";
import FeedsFreshnessPane from "./FeedsFreshnessPane";
import InstanceScope from "./InstanceScope";
import SupplyPosture from "./SupplyPosture";
import TrustCompositionPane from "./TrustCompositionPane";
import TrustResponsePane from "./TrustResponsePane";
import { TONE_GLYPH } from "./trust-marks";

interface DataTrustOverviewProps {
  health: SystemHealth | null;
  healthError?: string | null;
  symbol: string;
  probe?: InspectResponse | null;
  probeError?: string | null;
  probeLoading?: boolean;
  onOpenSection?: (section: DataTrustDestination) => void;
  /** `summary` is the verdict, composition and boundary; `feeds` is the two
   *  monitors and the operator path. One derivation, two locations. */
  view?: "summary" | "feeds";
}

/**
 * Three, not four: `globals.css` records that four `flex: 1` buttons in a `.seg`
 * force abbreviated labels, and "Comp." is not a word a reader should have to
 * decode to find out what the desk validated.
 */
type TrustPane = "verdict" | "response" | "composition";

const TRUST_PANES: Array<{ id: TrustPane; label: string; hint: string }> = [
  {
    id: "verdict",
    label: "Verdict",
    hint: "Posture, the measurement boundary, and provider supply",
  },
  {
    id: "response",
    label: "Response",
    hint: "Feed tick rates, source response times and quota left",
  },
  {
    id: "composition",
    label: "Composition",
    hint: "What was contract-checked, and where each answer came from",
  },
];

/**
 * Two, and the section named them first. The rail label reads "Feeds &
 * Contracts", so the panes are pre-named by the thing a reader clicked to get
 * here. They also degrade separately: freshness comes from the gateway's venue
 * feeds, contract evidence from this function instance, and one of those can be
 * absent while the other is fully populated.
 */
type FeedsPane = "freshness" | "contracts";

const FEEDS_PANES: Array<{ id: FeedsPane; label: string; hint: string }> = [
  {
    id: "freshness",
    label: "Freshness",
    hint: "Book age, reconnects, and upstream or synthetic",
  },
  {
    id: "contracts",
    label: "Contracts",
    hint: "The active quote's contract result, and per-provider totals",
  },
];

export default function DataTrustOverview({
  health,
  healthError,
  symbol,
  probe,
  probeError,
  probeLoading,
  onOpenSection,
  view = "summary",
}: DataTrustOverviewProps) {
  const [pane, setPane] = useState<TrustPane>("verdict");
  const [feedsPane, setFeedsPane] = useState<FeedsPane>("freshness");
  const trust = deriveDataTrust(health, { symbol, healthError, probe, probeError, probeLoading });
  // Sorted once, here, because two panes draw the same rows: Composition as
  // bars, Contracts as a table. Deriving it twice would let them drift into
  // disagreeing about the order of the same numbers.
  const providerValidation = Object.entries(trust.validation?.byProvider ?? {})
    .sort((left, right) => right[1].evaluated - left[1].evaluated);

  const summary = view === "summary";
  const feedsView = view === "feeds";

  return (
    <div className="data-trust-overview">
      {/* One derivation, two locations: the summary carries the verdict,
          composition and boundary; feeds carries the two monitors and the
          operator path. Both halves render conditionally, so the instance
          mounted for one of them is not also drawing every chart of the
          other behind a `hidden` attribute. */}
      {summary && (
        <div className="seg" role="group" aria-label="Trust evidence view">
          {TRUST_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={pane === option.id}
              title={option.hint}
              onClick={() => setPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {summary && pane === "verdict" && (
        <>
          <section className={`card data-trust-hero is-${trust.verdict.tone}`} aria-labelledby="data-trust-heading">
            <div>
              <span className="page-kicker">Market data quality / freshness monitor</span>
              <h2 id="data-trust-heading">{trust.verdict.label}</h2>
              <p>{trust.verdict.detail}</p>
            </div>
            <div className={`data-trust-verdict is-${trust.verdict.tone}`}>
              <span aria-hidden>{TONE_GLYPH[trust.verdict.tone]}</span>
              <div>
                <strong>{symbol}</strong>
                <small>exact quote + observed platform scope</small>
              </div>
            </div>
          </section>

          {/* Before any figure: which process measured it, and for how long. */}
          <InstanceScope health={health} />

          <section className="data-trust-section" aria-labelledby="trust-evidence-heading">
            <div className="section-heading compact">
              <div>
                <span className="page-kicker">Decision evidence</span>
                <h2 id="trust-evidence-heading">What is known now</h2>
              </div>
              <span className="section-note">missing evidence remains unknown</span>
            </div>
            <div className="data-trust-evidence-grid">
              {trust.evidence.map((item) => (
                <article key={item.id} className={`card data-trust-evidence is-${item.tone}`}>
                  <div>
                    <span aria-hidden>{TONE_GLYPH[item.tone]}</span>
                    <small>{item.label}</small>
                  </div>
                  <strong className="num">{item.value}</strong>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </section>

          <SupplyPosture health={health} />
        </>
      )}

      {summary && pane === "response" && (
        <TrustResponsePane health={health} />
      )}

      {summary && pane === "composition" && (
        <TrustCompositionPane health={health} providerValidation={providerValidation} />
      )}

      {feedsView && (
        <div className="seg" role="group" aria-label="Feeds and contracts view">
          {FEEDS_PANES.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={feedsPane === option.id}
              title={option.hint}
              onClick={() => setFeedsPane(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {/* The two monitors sat side by side in a two-column grid, which gave a
          six-column feed table and a five-column provider table half the panel
          each. One at a time, full width, and the operator path travels with
          the contract evidence it is a response to. */}
      {feedsView && feedsPane === "freshness" && (
        <FeedsFreshnessPane health={health} symbol={symbol} gatewaySource={trust.gatewaySource} />
      )}

      {feedsView && feedsPane === "contracts" && (
        <FeedsContractsPane
          symbol={symbol}
          probe={probe}
          probeError={probeError}
          probeLoading={probeLoading}
          trust={trust}
          providerValidation={providerValidation}
          onOpenSection={onOpenSection}
        />
      )}

      {/*
        The assessment boundary block was here and is gone, asked for twice.

        An earlier pass shrank it instead — dropping seven "Implemented"
        bullets and keeping three "Remaining boundaries" — which was a
        substitution for the instruction rather than the instruction.

        Removing it is also the right answer on its own merits, because by the
        time it went it had drifted: it still said escalation reached ONE
        channel and that there was no paging rota, after E2.10 shipped a
        webhook channel and a rota grammar. That is what a hand-maintained
        claim block does against a system that moves, and it is why the seven
        implemented bullets were dropped before it.

        What still bounds the data plane is said where it is measured and stays
        true by construction: the container contract fails the build on
        `--workers`, `RAW_CALIBRATED` is derived from which providers have a
        committed healthy fixture, and the rota reports itself through
        `rota_health`.
      */}
    </div>
  );
}
