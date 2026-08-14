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
 */

import { useState } from "react";

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import GappedSparkline from "@/components/charts/GappedSparkline";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { InspectResponse, SystemHealth } from "@/components/systems/types";
import {
  deriveDataTrust,
  resolveLatencySource,
  type DataTrustDestination,
  type DataTrustTone,
} from "@/lib/data-trust";
import { DATA_SECTIONS } from "@/lib/sections";

import FeedThroughput from "./FeedThroughput";
import InstanceScope from "./InstanceScope";
import QuotaHeadroom from "./QuotaHeadroom";
import SupplyPosture from "./SupplyPosture";
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
    hint: "The posture, the measurement boundary every number below sits inside, and the supply behind the next answer",
  },
  {
    id: "response",
    label: "Response",
    hint: "How fast each venue book is ticking, how each source has been responding, and how much budget is left to keep asking",
  },
  {
    id: "composition",
    label: "Composition",
    hint: "What this one function instance re-checked against a contract, and where its answers came from",
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
    hint: "How old each venue book is, how often it has reconnected, and whether the feed is upstream or synthetic",
  },
  {
    id: "contracts",
    label: "Contracts",
    hint: "What the exact active quote was checked against, what this instance has aggregated by provider, and which evidence to open next",
  },
];

/**
 * The rail's own label for a destination.
 *
 * `DataTrustAction.destination` is a section id — `quality`, `lineage`,
 * `providers` — and the rail above these buttons reads "Quality & Incidents",
 * "Lineage & Payloads" and "Providers & Capacity". Printing the id named a
 * destination the reader cannot find on screen. Ids are public deep links and
 * never change, so every destination resolves; the id remains the fallback
 * because a button that still routes correctly should not lose its caption.
 */
function destinationLabel(destination: DataTrustDestination): string {
  return DATA_SECTIONS.find((section) => section.id === destination)?.label ?? destination;
}

function absoluteTime(value: string | null | undefined): string {
  if (!value) return "not observed";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed)
    ? value
    : new Date(parsed).toISOString().replace("T", " ").replace(".000Z", " UTC");
}

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
  const feeds = health?.platform?.market_data.feeds ?? [];
  const providerValidation = Object.entries(trust.validation?.byProvider ?? {})
    .sort((left, right) => right[1].evaluated - left[1].evaluated);
  const probeContract = probe?.provenance?.contract;
  const probeTone: DataTrustTone = probeLoading
    ? "unknown"
    : probeError || probeContract?.passed === false
      ? "bad"
      : !probeContract
        ? "unknown"
        : probeContract.violations.length || probeContract.notEvaluated.length
          ? "warn"
          : "good";

  // One row per capability that has actually answered something. Cache hits are
  // counted separately from validated fetches because a cached answer was never
  // re-checked — folding them together would report contract coverage the
  // instance never performed.
  const validationWindow = health?.validation ?? null;
  const latencyWindow = health?.latencyWindow ?? null;
  const provenanceRows: BarRow[] = Object.entries(health?.cache.byCapability ?? {})
    .map(([capability, counters]) => {
      const checks = validationWindow?.byCapability?.[capability];
      const flagged = (checks?.fatal ?? 0) + (checks?.warn ?? 0) + (checks?.drift ?? 0);
      const hits = counters?.hits ?? 0;
      const rate = counters?.hitRate;
      return {
        label: capability,
        note: rate == null ? `${hits} cached` : `${Math.round(rate * 100)}% cached`,
        segments: [
          { label: "served from cache", value: hits, color: "var(--series-3)" },
          { label: "fetched · contract passed", value: checks?.passed ?? 0, color: "var(--series-1)" },
          { label: "fetched · flagged", value: flagged, color: "var(--status-warning)" },
          { label: "fetched · not evaluated", value: checks?.notEvaluated ?? 0, color: "var(--axis)" },
        ],
      };
    })
    .filter((row) => row.segments.some((segment) => segment.value > 0));

  /**
   * The composition ring. Same numbers as the per-capability bars, asked as
   * one question instead of N: of everything this instance answered, how much
   * was re-checked against a contract and how much was replayed from cache.
   * Cache hits stay their own slice — folding them into "passed" would report
   * contract coverage the instance never performed.
   */
  const provenanceTotals = provenanceRows.reduce(
    (acc, row) => {
      for (const segment of row.segments) {
        acc[segment.label] = (acc[segment.label] ?? 0) + segment.value;
      }
      return acc;
    },
    {} as Record<string, number>,
  );
  const provenanceSlices: DonutSlice[] = [
    { label: "served from cache", value: provenanceTotals["served from cache"] ?? 0, colour: "var(--series-3)" },
    { label: "contract passed", value: provenanceTotals["fetched · contract passed"] ?? 0, colour: "var(--series-1)" },
    { label: "flagged", value: provenanceTotals["fetched · flagged"] ?? 0, colour: "var(--status-warning)" },
    { label: "not evaluated", value: provenanceTotals["fetched · not evaluated"] ?? 0, colour: "var(--axis)" },
  ];
  const provenanceAnswers = provenanceSlices.reduce((acc, slice) => acc + slice.value, 0);

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
        <>
          <FeedThroughput health={health} />

          {/* ------------------------------------------------------------------
              Response history per source.

              The samples behind these have existed on the server the whole time
              and only the aggregates ever escaped, so this tab could report a
              p95 and had no way to say whether it had been climbing.

              The BUCKET statistic is p50 and the HEADLINE is the 15-minute p95,
              and they are labelled apart: a 60-second bucket holds single-digit
              calls here, and a "p95" over three of them is the maximum wearing a
              percentile's name.
              ------------------------------------------------------------------ */}
          <section className="card" aria-labelledby="trust-latency-heading">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Freshness</span>
                <h2 id="trust-latency-heading">Per-source response history</h2>
              </div>
              <span className="section-note">
                {latencyWindow ? `${latencyWindow.buckets} × ${Math.round(latencyWindow.bucketMs / 1000)}s` : "no history"}
              </span>
            </div>

            {!latencyWindow?.series.length ? (
              <p className="muted">
                No source has been called often enough in the last fifteen minutes to plot. This is a
                quiet instance, not a broken one — the window fills as the desk asks for data.
              </p>
            ) : (
              <ul className="spark-rows">
                {latencyWindow.series.map((row) => {
                  /**
                   * Resolved rather than pattern-matched. The previous branch
                   * tested `venue:*` and then provider ids, so `plane:gateway`
                   * — recorded on EVERY health poll by this very route, and
                   * therefore the densest line here — matched neither and its
                   * stat chip read "—" permanently, beside a fully drawn line.
                   */
                  const source = resolveLatencySource(health, row.key);
                  const windowSamples = row.n.reduce((sum, n) => sum + n, 0);
                  const gaps = row.p50.filter((v) => v == null).length;
                  return (
                    <li key={row.key}>
                      <span className="spark-rows__label" title={row.key}>{source.label}</span>
                      <GappedSparkline
                        points={row.p50}
                        ariaLabel={`${source.label} response time per minute`}
                        emptyNote="too few calls to plot"
                        tone={source.stats && source.stats.errorRate > 0.05 ? "warn" : "accent"}
                      />
                      <span className="spark-rows__stat num" title={source.note ?? undefined}>
                        {/* Withheld, not zeroed: no fifteen-minute aggregate is
                            published for a plane probe, and "p95 0ms" would be
                            the fastest possible lie. */}
                        {source.stats?.p95 != null ? `p95 ${Math.round(source.stats.p95)}ms` : "p95 n/a"}
                        {` · n=${source.stats?.n ?? windowSamples}`}
                        {gaps ? ` · ${gaps} quiet min` : ""}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="research-note">
              Each spark is the <strong>median per minute</strong>; the figure beside it is the
              fifteen-minute <strong>p95</strong>. They answer different questions and are not the same
              number. A minute with fewer than {latencyWindow?.minSamplesPerBucket ?? 3} calls is drawn
              as a gap rather than joined across, because too little traffic to measure and a fast
              minute look identical once the line is bridged. A source shown as{" "}
              <strong>p95 n/a</strong> is one the wire publishes no aggregate for — the gateway probe
              is one — and its sample count is read from the window&rsquo;s own buckets instead.
            </p>
          </section>

          <QuotaHeadroom health={health} />
        </>
      )}

      {summary && pane === "composition" && (
        <>
          <p className="research-note">
            Everything on this pane is counted by the function instance that answered this request,
            and the counters are incremented in the quote and bar routes rather than here. Read a
            zero as <strong>&ldquo;not measured in this process&rdquo;</strong>, never as
            &ldquo;nothing went wrong&rdquo;. The Verdict pane names the instance and its scope.
          </p>

          {/* ------------------------------------------------------------------
              Payload verdict and findings composition — TWO MARKS, TWO DENOMINATORS.

              The obvious chart, "passed vs fatal+warn+drift", cannot be drawn:
              `ValidationCounts` documents that `passed` is a PAYLOAD count while
              fatal/warn/drift are FINDING counts — one payload can carry three
              warnings — so a single ring mixing them would not sum to `evaluated`.
              That is exactly the arithmetic this tab exists to be trusted about.

              So: a ring over payloads, bars over findings, and a sentence saying a
              green ring means no FATAL finding rather than a clean one.
              ------------------------------------------------------------------ */}
          <section className="card data-trust-verdict-ring" aria-labelledby="trust-verdict-ring-heading">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Contract validation</span>
                <h2 id="trust-verdict-ring-heading">Payload verdict &amp; findings</h2>
              </div>
              <span className="section-note">
                {validationWindow ? `${validationWindow.evaluated} evaluated` : "nothing evaluated yet"}
              </span>
            </div>

            <div className="data-trust-verdict-ring__grid">
              <DonutChart
                slices={[
                  { label: "no fatal finding", value: validationWindow?.passed ?? 0, colour: "var(--status-good)" },
                  {
                    label: "fatal finding",
                    value: Math.max(0, (validationWindow?.evaluated ?? 0) - (validationWindow?.passed ?? 0)),
                    colour: "var(--status-critical)",
                  },
                ]}
                total={validationWindow?.evaluated || undefined}
                centreValue={String(validationWindow?.evaluated ?? 0)}
                centreLabel="payloads"
                emptyNote="No payload has been evaluated in this function instance. Zero evidence is not a clean bill of health."
                ariaLabel="Evaluated payloads by verdict"
              />

              <CategoryBars
                rows={[
                  {
                    label: "Findings",
                    note: `${validationWindow?.fatal ?? 0} fatal · ${validationWindow?.warn ?? 0} warn · ${validationWindow?.drift ?? 0} drift`,
                    segments: [
                      { label: "fatal", value: validationWindow?.fatal ?? 0, color: "var(--status-critical)" },
                      { label: "warn", value: validationWindow?.warn ?? 0, color: "var(--status-warning)" },
                      { label: "drift", value: validationWindow?.drift ?? 0, color: "var(--series-2)" },
                      { label: "not evaluated", value: validationWindow?.notEvaluated ?? 0, color: "var(--axis)" },
                    ],
                  },
                ]}
                ariaLabel="Validation findings by severity"
                emptyNote="No finding has been raised in this window."
              />
            </div>

            <p className="research-note">
              Findings, not payloads — one payload can carry several, so the two marks above have
              different denominators and are deliberately not combined. A green ring means{" "}
              <strong>no fatal finding</strong>; warnings and drift may remain.
            </p>
          </section>

          {/* `byProvider` is `Record<string, ValidationCounts>` — the same shape
              as `byCapability`, which is drawn as bars above, and already sorted
              by `evaluated` descending. It was reaching the browser and being
              rendered only as a table in the other view. Drawn when non-empty;
              a bar chart of nothing is not an honest empty state. */}
          {providerValidation.length > 0 && (
            <section className="card" aria-labelledby="trust-provider-validation-heading">
              <div className="portfolio-card-heading">
                <div>
                  <span className="page-kicker">Contract validation</span>
                  <h2 id="trust-provider-validation-heading">Checked payloads by provider</h2>
                </div>
                <span className="section-note">
                  {providerValidation.length} provider{providerValidation.length === 1 ? "" : "s"} represented
                </span>
              </div>
              <CategoryBars
                rows={providerValidation.map(([provider, counts]) => ({
                  label: provider,
                  note: `${counts.evaluated} evaluated · ${counts.fatal} fatal · ${counts.warn}w/${counts.drift}d`,
                  segments: [
                    { label: "no fatal finding", value: counts.passed, color: "var(--status-good)" },
                    {
                      label: "fatal finding",
                      value: Math.max(0, counts.evaluated - counts.passed),
                      color: "var(--status-critical)",
                    },
                  ],
                }))}
                ariaLabel="Per provider, evaluated payloads split by whether any fatal contract finding was raised against them."
                emptyNote="No provider has had a payload evaluated on this instance."
              />
              <p className="research-note">
                One denominator per bar: both segments are <strong>payloads</strong> and sum to that
                provider&rsquo;s evaluated count. The fatal, warn and drift figures in each note are{" "}
                <strong>findings</strong> — one payload can carry several — which is why they are
                printed rather than stacked into the same bar.
              </p>
            </section>
          )}

          <section className="card data-trust-provenance" aria-labelledby="trust-provenance-heading">
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Evidence composition</span>
                <h2 id="trust-provenance-heading">Where each answer came from</h2>
              </div>
              <span className="section-note">
                {validationWindow
                  ? `${validationWindow.retained}/${validationWindow.capacity} of the instance window retained`
                  : "no validation window yet"}
              </span>
            </div>
            {/* The ring answers the whole question at a glance; the bars answer it
                per capability. Same counters, two altitudes. */}
            <div className="data-trust-composition">
              <DonutChart
                slices={provenanceSlices}
                centreValue={provenanceAnswers ? String(provenanceAnswers) : undefined}
                centreLabel="answers"
                ariaLabel="Composition of every answer this instance served, by whether it was re-checked against a contract or replayed from cache."
                emptyNote="Nothing served yet."
              />
              <CategoryBars
                ariaLabel="Per capability, how many answers were served from cache versus fetched and contract-checked."
                rows={provenanceRows}
                emptyNote="No capability has served a request on this instance yet, so there is nothing to attribute."
              />
            </div>
          </section>
        </>
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
        <section className="card data-trust-monitor" aria-labelledby="feed-monitor-heading">
          {/* portfolio-card-heading, like the four sibling cards in this file
              and every card on this surface: the two monitor cards alone
              borrowed the non-card section grammar, so equal-rank titles
              rendered at two sizes as the reader switched panes. */}
          <div className="portfolio-card-heading">
            <div>
              <span className="page-kicker">Freshness</span>
              <h2 id="feed-monitor-heading">Observed market feeds</h2>
            </div>
            <span className="section-note">
              gateway {trust.gatewaySource?.state?.replace("_", " ") ?? "not observed"}
            </span>
          </div>

          {feeds.length ? (
            <div className="table-wrap" tabIndex={0}>
              <table>
                <caption className="sr-only">Gateway market-feed freshness and update evidence.</caption>
                <thead>
                  <tr>
                    <th scope="col">Venue</th>
                    <th scope="col">State</th>
                    <th scope="col">{symbol} age</th>
                    <th scope="col">Updates</th>
                    <th scope="col">Reconnects</th>
                    <th scope="col">Mode</th>
                  </tr>
                </thead>
                <tbody>
                  {feeds.map((feed) => {
                    const instrument = feed.symbols.find((row) => row.symbol === symbol);
                    return (
                      <tr key={feed.venue}>
                        <td><strong>{feed.venue}</strong></td>
                        <td>
                          <span className={`data-trust-inline-state is-${feed.status === "up" ? "good" : feed.status === "down" ? "bad" : "warn"}`}>
                            <span aria-hidden>{feed.status === "up" ? "●" : feed.status === "down" ? "✕" : "▲"}</span>
                            {feed.status}
                          </span>
                        </td>
                        <td className="num">
                          {!instrument ? "not covered" : instrument.age_seconds == null ? "—" : `${instrument.age_seconds.toFixed(2)}s`}
                        </td>
                        <td className="num">{instrument?.updates_total?.toLocaleString() ?? "—"}</td>
                        <td className="num">{feed.reconnects}</td>
                        <td>{feed.synthetic ? "synthetic" : "upstream"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="data-trust-empty">
              <strong>No gateway feed evidence.</strong>
              <p>
                The provider registry may still answer requests, but it cannot prove streaming feed
                freshness. Gateway source: {trust.gatewaySource?.state?.replace("_", " ") ?? "not exposed"}.
              </p>
            </div>
          )}

          <p className="console-footnote">
            Gateway observed at {absoluteTime(trust.gatewaySource?.observedAt)}. Feed ages belong to
            each venue and symbol; the health response fetch time does not make an old feed fresh.
          </p>
        </section>
      )}

      {feedsView && feedsPane === "contracts" && (
        <>
          <section className="card data-trust-monitor" aria-labelledby="contract-monitor-heading">
            {/* portfolio-card-heading — same reasoning as the feeds monitor. */}
            <div className="portfolio-card-heading">
              <div>
                <span className="page-kicker">Validation</span>
                <h2 id="contract-monitor-heading">Exact payload &amp; instance sample</h2>
              </div>
              <span className="section-note">quote + bars only</span>
            </div>

            <div className={`data-trust-probe is-${probeTone}`}>
              <span>Active quote</span>
              <strong>
                {probeLoading
                  ? `checking ${symbol}`
                  : probeError
                    ? "probe failed"
                    : probe?.provenance?.contract
                      ? `${probe.provenance.provider} · ${probe.cache.state} · contract attached`
                      : "no exact-payload contract result"}
              </strong>
              <small>
                {probe?.provenance?.contract
                  ? `${probe.provenance.contract.violations.length} findings · ${probe.provenance.contract.notEvaluated.length} checks not evaluated · fetched ${absoluteTime(probe.provenance.fetchedAt)}`
                  : probeError ?? "A green verdict is withheld until this exact response carries validation evidence."}
              </small>
            </div>

            {providerValidation.length ? (
              <div className="table-wrap" tabIndex={0}>
                <table>
                  <caption className="sr-only">Bounded contract-validation evidence by provider.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Provider</th>
                      <th scope="col">Evaluated</th>
                      <th scope="col">No fatal</th>
                      <th scope="col">Fatal</th>
                      <th scope="col">Warn / drift</th>
                    </tr>
                  </thead>
                  <tbody>
                    {providerValidation.map(([provider, counts]) => (
                      <tr key={provider}>
                        <td><strong>{provider}</strong></td>
                        <td className="num">{counts.evaluated}</td>
                        <td className="num">{counts.passed}</td>
                        <td className="num">{counts.fatal}</td>
                        <td className="num">{counts.warn} / {counts.drift}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="data-trust-empty">
                <strong>No aggregate in the health-route instance.</strong>
                <p>
                  Serverless routes do not reliably share module memory. The exact active-quote result
                  above is request-bound evidence; an empty health-route aggregate is not evidence that
                  every payload passed.
                </p>
              </div>
            )}

            <p className="console-footnote">
              Window {trust.validation ? `${trust.validation.retained}/${trust.validation.capacity}` : "not exposed"}
              {trust.validation?.windowStart ? ` · since ${absoluteTime(trust.validation.windowStart)}` : ""}
              {trust.validation?.lastValidationAt ? ` · last ${absoluteTime(trust.validation.lastValidationAt)}` : ""}.
              Aggregate counts reset with the health-route function instance and are not tied to {symbol}.
            </p>
          </section>

          <section className="data-trust-section" aria-labelledby="trust-actions-heading">
            <div className="section-heading compact">
              <div>
                <span className="page-kicker">Operator path</span>
                <h2 id="trust-actions-heading">Next evidence to inspect</h2>
              </div>
              <span className="section-note">read-only diagnostics</span>
            </div>
            <div className="data-trust-actions">
              {trust.actions.map((action) => (
                <button
                  key={action.destination}
                  type="button"
                  className={`card data-trust-action is-${action.priority}`}
                  onClick={() => onOpenSection?.(action.destination)}
                  disabled={!onOpenSection}
                >
                  <span>{action.priority}</span>
                  <strong>{action.label}</strong>
                  <small>{action.detail}</small>
                  <i aria-hidden>Open {destinationLabel(action.destination)} →</i>
                </button>
              ))}
            </div>
          </section>
        </>
      )}

      {/*
        Static documentation, and the only block on this tab that is not a
        reading of the running system: it states what the data plane implements
        and where the production gap is.

        OUTSIDE the pane switcher on purpose. A boundary that disappears when a
        reader changes view is a boundary they can miss entirely, and this one
        qualifies every number in all three panes. Collapsed, it costs ~40px and
        its summary line still says exactly what is inside.
      */}
      {summary && (
        <section className="card data-trust-boundaries" aria-labelledby="trust-boundaries-heading">
          <details className="disclosure">
            <summary>
              Assessment boundary — what is implemented, and where the production gap is
            </summary>
            <div className="section-heading compact">
              <div>
                <span className="page-kicker">Assessment boundary</span>
                <h2 id="trust-boundaries-heading">Implemented evidence vs production gap</h2>
              </div>
              <span className="section-note">claims match the running system</span>
            </div>
            <div>
              <article>
                <h3><span aria-hidden>✓</span> Implemented</h3>
                <ul>
                  <li>Ranked provider failover with circuit, quota, reserve and cache state.</li>
                  <li>Quote/bar contracts, rejected-payload failover and bounded quarantine evidence.</li>
                  <li>On-demand cross-source reconciliation and real request lineage for the active symbol and interval.</li>
                  <li>Gateway venue freshness, reconnect and synthetic-feed disclosure when configured.</li>
                </ul>
              </article>
              <article>
                <h3><span aria-hidden>△</span> Explicit production gaps</h3>
                <ul>
                  <li>No durable, cross-instance quality ledger or automated alert escalation.</li>
                  <li>No orchestrator, replay service or backfill scheduler is wired to this UI.</li>
                  <li>Contracts do not yet cover news, fundamentals or every raw vendor schema.</li>
                  <li>The Work Queue is mocked browser-session state, not a ticket or worker backend.</li>
                </ul>
              </article>
            </div>
          </details>
        </section>
      )}
    </div>
  );
}
