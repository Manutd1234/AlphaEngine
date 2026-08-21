"use client";

/**
 * The gateway's own components, its timing, and what this snapshot can prove.
 *
 * Split out of `ReliabilityOverview` when that file passed the length ceiling;
 * it is the Platform view of the Dependencies section, mounted by
 * `ReliabilityPlanes` only while that view is on screen.
 *
 * Two honesty rules do the work here and neither is decoration.
 *
 * **A missing snapshot is a missing measurement, not a set of failures.** The
 * deployed workspace's normal condition is no gateway, and the empty state says
 * that in those words. A blank panel reads to the desk sweep as a dead end and
 * to a reader as something broken.
 *
 * **Quantiles of nothing are not zeros.** Decision p99 renders "—" unless there
 * are samples and a figure; the core nanosecond plane is a different span from
 * the microsecond one and never borrows its numbers, and the startup
 * self-measure is named where it contributed rather than silently folded in.
 */

import { CrossLinkTile } from "@/components/portfolio/BookChrome";
import RouteLatencyBars from "@/components/systems/RouteLatencyBars";
import { fmt, formatDuration, metricRow } from "@/lib/format";
import { deriveReliabilityPosture, type ReliabilityPosture, type ReliabilityStatus } from "@/lib/reliability";
import type { SystemHealthView } from "@/lib/use-system-health";

const POSTURE_LABEL: Record<ReliabilityStatus, string> = {
  nominal: "Nominal",
  degraded: "Degraded",
  critical: "Critical",
  halted: "Trading halted",
  unknown: "Unknown",
};

export default function ReliabilityPlatform({
  view,
  onOpenData,
}: {
  view: SystemHealthView;
  onOpenData: () => void;
}) {
  const { health } = view;
  /**
   * Null, never zero: with no snapshot there is no quarantine count, and
   * `quarantine` is optional on the wire — an older instance's snapshot has
   * no count either. "0 records held out" is a measurement; neither of these
   * is one.
   */
  const quarantined = health?.quarantine ? health.quarantine.size : null;
  const posture = health ? deriveReliabilityPosture(health) : null;
  const planeTile = (plane: keyof ReliabilityPosture["paths"], title: string, waiting: string) => (
    <div>
      <span className={`reliability-evidence__state is-${posture?.paths[plane].status ?? "unknown"}`}>
        {posture ? POSTURE_LABEL[posture.paths[plane].status] : "Connecting"}
      </span>
      <strong>{title}</strong>
      <small>{posture?.paths[plane].reason ?? waiting}</small>
    </div>
  );
  const platform = health?.platform;
  const gatewaySource = health?.sources?.gateway;
  const realFeeds = platform?.market_data.feeds.filter((feed) => !feed.synthetic) ?? [];
  const connectedFeeds = realFeeds.filter((feed) => feed.connected).length;
  const books = realFeeds.flatMap((feed) => feed.symbols);
  const staleBooks = books.filter((book) => book.stale).length;
  const queueActive = (platform?.queue.by_status.queued ?? 0) + (platform?.queue.by_status.running ?? 0);

  return (
    <>
      <RouteLatencyBars platform={platform} />

      {platform ? (
        <section className="card reliability-platform" aria-labelledby="reliability-platform-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Authoritative gateway</span>
              <h2 id="reliability-platform-title">Quant infrastructure components</h2>
            </div>
            <span className={`reliability-source-state is-${gatewaySource?.state ?? "invalid"}`}>
              {gatewaySource?.state === "fresh" ? "Fresh snapshot" : gatewaySource?.state?.replace("_", " ") ?? "Source unknown"}
            </span>
          </div>

          <div className="reliability-platform__grid">
            <article className={`is-${platform.market_data.status}`}>
              <span>Market data</span>
              <strong>{platform.market_data.status.replace("_", " ")}</strong>
              <small>
                {realFeeds.length
                  ? `${connectedFeeds} of ${realFeeds.length} venue feeds connected, ${staleBooks} of ${books.length} books stale`
                  : "No live venue feeds observed"}
                {platform.market_data.synthetic_active ? "; synthetic fallback active" : ""}
              </small>
            </article>
            <article className={`is-${platform.risk.status}`}>
              <span>Pre-trade risk</span>
              <strong>{platform.risk.status.replace("_", " ")}</strong>
              <small>
                {platform.risk.working_orders} working orders, {fmt(platform.risk.drawdown_budget_used_pct * 100, 0)}% of the drawdown budget used
              </small>
            </article>
            <article className={platform.queue.broker_configured && platform.queue.backend !== "celery" ? "is-degraded" : "is-nominal"}>
              <span>Research queue</span>
              <strong>{platform.queue.backend}</strong>
              <small>
                {queueActive} queued or running; {platform.queue.workers} configured worker slots
              </small>
            </article>
            <article className={platform.audit.available ? "is-nominal" : "is-critical"}>
              <span>Audit store</span>
              <strong>{platform.audit.available ? "available" : "unavailable"}</strong>
              <small>{platform.audit.backend}; append-only decision evidence</small>
            </article>
            {/* The gateway has always emitted these counters; nothing rendered
                them, so the durability of the Postgres mirror was invisible in
                the console whose job is visibility.

                Three distinct states, deliberately not collapsed: absent (this
                gateway build predates the mirror), configured:false (mirror
                off), and configured-and-failing. Only the last is a fault.
                `dropped` leads because the queue is bounded and drops rather
                than blocking the order path — a non-zero value means the
                Postgres blotter is silently incomplete, which is exactly the
                kind of quiet loss nobody notices without a number. */}
            {platform.supabase && (
              <article
                className={
                  !platform.supabase.configured
                    ? "is-disabled"
                    : platform.supabase.dropped > 0 || platform.supabase.last_error_kind
                      ? "is-degraded"
                      : "is-nominal"
                }
              >
                <span>Postgres mirror</span>
                <strong>
                  {!platform.supabase.configured
                    ? "not configured"
                    : platform.supabase.dropped > 0
                      ? "lossy"
                      : platform.supabase.running ? "streaming" : "idle"}
                </strong>
                <small>
                  {platform.supabase.configured
                    ? <>
                        {platform.supabase.written} mirrored, {platform.supabase.queued} queued
                        {platform.supabase.dropped > 0 && `; ${platform.supabase.dropped} DROPPED`}
                        {platform.supabase.failed > 0 && `; ${platform.supabase.failed} failed`}
                        {platform.supabase.last_error_kind && `; last error: ${platform.supabase.last_error_kind}`}
                      </>
                    : "DuckDB stays authoritative; the mirror is optional durability"}
                </small>
              </article>
            )}
          </div>

          {/* The slowest-route and sample-count scalars that stood here are now
              the chart below, per route rather than reduced to one. Two places
              reporting the same reduction is two places that can disagree, so
              only the build — which nothing else carries — stays. */}
          <div className="reliability-platform__sli" aria-label="Gateway build and decision timing">
            <span>
              <small>Gateway build</small>
              <strong className="num">v{platform.version}</strong>
              <code>{platform.environment}</code>
            </span>
            {(() => {
              const d = platform.decision_latency;
              const measured = d && d.samples > 0 && d.p99_us != null;
              const dus = (v: number | null | undefined) => formatDuration(v, "us");
              return (
                <>
                  <span>
                    <small>Decision p99</small>
                    <strong className="num">{measured ? dus(d!.p99_us) : "—"}</strong>
                    <code title={measured
                      ? metricRow([`p50 ${dus(d!.p50_us)}`, `p99.9 ${d!.samples >= 1000 ? dus(d!.p999_us) : "—"}`, `max ${dus(d!.max_us)}`, `n=${d!.samples.toLocaleString("en-US")} since start`])
                      : "no decision measured yet"}>
                      {measured
                        ? metricRow([`p50 ${dus(d!.p50_us)}`, `n=${d!.samples.toLocaleString("en-US")}`])
                        : d ? "no orders yet" : "not published"}
                    </code>
                  </span>
                  <span>
                    <small>Core p99</small>
                    <strong className="num">
                      {d && d.core_p99_ns != null ? formatDuration(d.core_p99_ns, "ns") : "—"}
                    </strong>
                    <code title={d && d.core_self_test_samples
                      ? `${d.core_self_test_samples.toLocaleString("en-US")} core samples are the startup self-measure on a synthetic two-venue book; the decision µs figure never includes them`
                      : undefined}>
                      {d && d.core_p99_ns != null
                        ? metricRow([d.engine, `p50 ${formatDuration(d.core_p50_ns, "ns")}`, `max ${formatDuration(d.core_max_ns, "ns")}`, d.core_self_test_samples ? `self-measure ${d.core_self_test_samples.toLocaleString("en-US")}` : null])
                        : d?.engine === "python" ? "Python engine, no native core" : "no native core"}
                    </code>
                  </span>
                </>
              );
            })()}
          </div>
          <details className="disclosure">
            <summary>What the worker count measures</summary>
            <p className="reliability-platform__caveat">
              Queue workers are configured slots, not heartbeats. This is one gateway-process
              snapshot; fleet aggregation and order-to-ack timing belong in external telemetry.
            </p>
          </details>
        </section>
      ) : (
        // An honest empty state rather than nothing: the deployed workspace's
        // normal condition is no gateway, and a view that renders blank reads
        // to the sweep as a dead end and to a reader as a broken panel.
        <section className="card">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Authoritative gateway</span>
              <h2>Quant infrastructure components</h2>
            </div>
          </div>
          <p className="muted">
            No gateway ops snapshot is arriving, so its market-data, risk, audit and queue
            components cannot be observed from here — a missing measurement, not a set of failures.
          </p>
        </section>
      )}

      <section className="card reliability-evidence" aria-labelledby="reliability-evidence-title">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Evidence boundary</span>
            <h2 id="reliability-evidence-title">What this snapshot can prove</h2>
          </div>
        </div>
        {/* Three planes, and the third is why this grid is not two. Telegram
            used to reach the reader only by degrading the TRADING verdict; it
            reports itself here instead, next to — never as — the money path. */}
        <div className="reliability-evidence__grid">
          {planeTile("research", "Provider-routing plane", "Waiting for the provider-routing snapshot.")}
          {planeTile("trading", "Trading gateway plane", "A provider-only snapshot cannot prove market-data freshness, worker health or kill-switch state.")}
          {planeTile("notifications", "Notification plane", "Waiting for the notification-companion snapshot.")}
        </div>

        {/* The shared CrossLinkTile, not a hand-rolled copy: the anti-copy
            ratchet in portfolio-section-panes-cross-link.test.ts named this aside as the
            one cross-link its scan could not measure because it did not reuse
            .cross-link-metrics. Same words, same figures, shared chrome. */}
        <CrossLinkTile
          kicker="Owned by data engineering"
          title="Transport healthy, payload suspect?"
          actionLabel="Open Data quality"
          onNavigate={onOpenData}
          metrics={[
            {
              label: "Quarantined",
              value: quarantined == null ? "—" : String(quarantined),
              note: quarantined == null
                ? health
                  ? "this instance publishes no quarantine count"
                  : "no health snapshot yet"
                : "records held out of the desk's series",
              tone: quarantined ? "warn" : undefined,
            },
            {
              label: "Cache entries",
              value: health ? String(health.cache.entries) : "—",
              note: health ? "provider payloads currently held" : "no health snapshot yet",
            },
          ]}
        />
      </section>
    </>
  );
}
