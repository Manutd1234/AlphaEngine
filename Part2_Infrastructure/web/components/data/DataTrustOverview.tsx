"use client";

import CategoryBars, { type BarRow } from "@/components/charts/CategoryBars";
import DonutChart, { type DonutSlice } from "@/components/common/DonutChart";
import type { InspectResponse, SystemHealth } from "@/components/systems/types";
import {
  deriveDataTrust,
  type DataTrustDestination,
  type DataTrustTone,
} from "@/lib/data-trust";

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

const TONE_GLYPH: Record<DataTrustTone, string> = {
  good: "●",
  warn: "▲",
  bad: "✕",
  unknown: "◌",
};

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
          operator path. `hidden` rather than a conditional render so the
          derived state above is computed once for both. */}
      <section className={`card data-trust-hero is-${trust.verdict.tone}`} aria-labelledby="data-trust-heading" hidden={!summary}>
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

      {/* Where every answer on this desk came from.
          The tab is eleven text panels and no chart, which for the surface that
          exists to certify trust is the wrong way round: "234 evaluated, 0
          fatal" is a sentence a reader has to reassemble into a proportion.
          Each capability's bar is that proportion already — cache hits carry no
          contract check because nothing was fetched, and every fetch that did
          happen is shown as passed, flagged, or unevaluated. */}
      <section className="card data-trust-provenance" aria-labelledby="trust-provenance-heading" hidden={!summary}>
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

      <section className="data-trust-section" aria-labelledby="trust-evidence-heading" hidden={!summary}>
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

      <div className="data-trust-detail-grid" hidden={!feedsView}>
        <section className="card data-trust-monitor" aria-labelledby="feed-monitor-heading">
          <div className="section-heading compact">
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

        <section className="card data-trust-monitor" aria-labelledby="contract-monitor-heading">
          <div className="section-heading compact">
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
      </div>

      <section className="data-trust-section" aria-labelledby="trust-actions-heading" hidden={!feedsView}>
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
              <i aria-hidden>Open {action.destination} →</i>
            </button>
          ))}
        </div>
      </section>

      <section className="card data-trust-boundaries" aria-labelledby="trust-boundaries-heading" hidden={!summary}>
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
      </section>
    </div>
  );
}
