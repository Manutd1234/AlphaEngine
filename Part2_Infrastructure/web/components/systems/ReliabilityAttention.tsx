"use client";

/**
 * Reliability triage: what is wrong right now, and the order to look in.
 *
 * Split out of `ReliabilityOverview` when that file passed the length ceiling.
 * This is the `attention` half of the section — the symptom list and the
 * incident path — and it derives that list from the one health snapshot the
 * console already polls. Nothing here fetches.
 *
 * Every item is a SYMPTOM with a destination, never a colour. A missing
 * telemetry snapshot is reported as unreachable with its reason attached rather
 * than as an empty list, because "no signals" and "we could not look" are
 * different findings and only one of them is good news.
 */

import LatencyTrend from "@/components/systems/LatencyTrend";
import { fmt } from "@/lib/format";
import { deriveReliabilityPosture } from "@/lib/reliability";
import type { SystemHealthView } from "@/lib/use-system-health";
import type { ProviderRow } from "./types";
import type { ReliabilityDrilldown } from "./ReliabilityOverview";

interface AttentionItem {
  id: string;
  title: string;
  detail: string;
  tone: "warn" | "critical" | "neutral";
  destination: ReliabilityDrilldown | "data";
  action: string;
}

function names(ids: string[], providers: ProviderRow[]): string {
  const labels = new Map(providers.map((provider) => [provider.id, provider.label]));
  return ids.map((id) => labels.get(id) ?? id).join(", ");
}

export default function ReliabilityAttention({
  view,
  onOpenSection,
  onOpenData,
}: {
  view: SystemHealthView;
  onOpenSection: (section: ReliabilityDrilldown) => void;
  onOpenData: () => void;
}) {
  const { health, healthError } = view;
  const providers = health?.providers ?? [];
  const summary = health?.summary;
  const latency = summary?.latency;
  const hasTraffic = Boolean(latency?.n);
  const openBreakers = summary?.degraded ?? [];
  const exhausted = summary?.exhausted ?? [];
  const simulated = summary?.simulated ?? [];
  const unavailableCapabilities = health
    ? Object.entries(health.capabilities)
        .filter(([, capability]) => capability.available.length === 0)
        .map(([capability]) => capability)
    : [];
  const atReserve = providers.filter(
    (provider) => provider.quota
      && provider.quota.remaining > 0
      && provider.quota.remaining <= provider.quota.reserve,
  );
  const quarantined = health?.quarantine?.size ?? 0;
  const posture = health ? deriveReliabilityPosture(health) : null;

  const attention: AttentionItem[] = [];
  if (healthError) {
    attention.push({
      id: "telemetry-unreachable",
      title: "Health telemetry is unreachable",
      detail: healthError,
      tone: "critical",
      destination: "events",
      action: "Inspect logs",
    });
  }
  if (!healthError && posture && posture.paths.trading.status !== "nominal") {
    const tradingStatus = posture.paths.trading.status;
    attention.push({
      id: "trading-path-posture",
      title: tradingStatus === "halted"
        ? "Authoritative trading is halted"
        : tradingStatus === "critical"
          ? "Trading-path component is unavailable"
          : tradingStatus === "degraded"
            ? "Trading path is restricted"
            : "Trading-path health is unverified",
      detail: posture.paths.trading.reason,
      tone: tradingStatus === "critical" || tradingStatus === "halted" ? "critical" : "warn",
      destination: "events",
      action: "Inspect telemetry",
    });
  }
  if (!healthError && posture?.paths.notifications.status === "degraded") {
    // Warn, never critical: desk alerting is degraded, the order path is not.
    attention.push({ id: "alerting-degraded", title: "Desk alerting is degraded", detail: posture.paths.notifications.reason, tone: "warn", destination: "events", action: "Inspect telemetry" });
  }
  if (hasTraffic && (latency?.errorRate ?? 0) > 0.01) {
    attention.push({
      id: "request-errors",
      title: "Upstream attempt errors are elevated",
      detail: `${fmt((latency?.errorRate ?? 0) * 100, 1)}% of ${latency?.n ?? 0} provider / venue attempts failed`,
      tone: (latency?.errorRate ?? 0) >= 0.05 ? "critical" : "warn",
      destination: "events",
      action: "Correlate logs",
    });
  }
  if (unavailableCapabilities.length) {
    attention.push({
      id: "unavailable-capabilities",
      title: `${unavailableCapabilities.length} service path${unavailableCapabilities.length === 1 ? " is" : "s are"} unavailable`,
      detail: unavailableCapabilities.join(", "),
      tone: "critical",
      destination: "services",
      action: "Inspect routing",
    });
  }
  if (openBreakers.length) {
    attention.push({
      id: "open-breakers",
      title: `${openBreakers.length} circuit${openBreakers.length === 1 ? "" : "s"} open`,
      detail: names(openBreakers, providers),
      tone: "critical",
      destination: "services",
      action: "Inspect services",
    });
  }
  if (exhausted.length) {
    attention.push({
      id: "quota-exhausted",
      title: `${exhausted.length} provider quota${exhausted.length === 1 ? "" : "s"} exhausted`,
      detail: names(exhausted, providers),
      tone: "critical",
      destination: "services",
      action: "Inspect capacity",
    });
  }
  if (simulated.length) {
    attention.push({
      id: "active-drills",
      title: `${simulated.length} controlled failure drill${simulated.length === 1 ? "" : "s"} active`,
      detail: names(simulated, providers),
      tone: "warn",
      destination: "services",
      action: "Follow failover",
    });
  }
  if (atReserve.length) {
    attention.push({
      id: "quota-reserve",
      title: `${atReserve.length} provider${atReserve.length === 1 ? " is" : "s are"} at reserve`,
      detail: atReserve.map((provider) => provider.label).join(", "),
      tone: "warn",
      destination: "services",
      action: "Review headroom",
    });
  }
  if (quarantined) {
    attention.push({
      id: "quarantine",
      title: `${quarantined} payload${quarantined === 1 ? "" : "s"} quarantined`,
      detail: "Transport may be healthy while a data contract is failing",
      tone: "warn",
      destination: "data",
      action: "Open Data quality",
    });
  }

  return (
    <div className="reliability-overview">
      {/* SYMPTOMS FIRST, THEN THE TREND. The trend chart used to open this
          section, which put a 168px plot plus its heading and legend between
          the rail and the only list on the tab that says what is wrong right
          now — on a laptop the first symptom sat below the fold. The chart
          answers "since when", and that is the second question: the console
          header already prints the current p99 as a tile, so nothing here is
          the reader's only route to the number. */}
      <div className="reliability-overview__split">
        <section className="card reliability-attention" aria-labelledby="reliability-attention-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Triage</span>
              <h2 id="reliability-attention-title">Active attention</h2>
            </div>
            <span className="section-note">{attention.length} signal{attention.length === 1 ? "" : "s"}</span>
          </div>

          {health && attention.length === 0 ? (
            <div className="reliability-all-clear" role="status">
              <span aria-hidden>✓</span>
              <div>
                <strong>No active symptoms in the observed planes</strong>
                <small>Provider routes have headroom; no dependency drill is running.</small>
              </div>
            </div>
          ) : !health && !healthError ? (
            <div className="reliability-all-clear is-loading" role="status">
              <span aria-hidden>…</span>
              <div>
                <strong>Waiting for telemetry</strong>
                <small>No health snapshot has arrived yet.</small>
              </div>
            </div>
          ) : (
            <ul className="reliability-attention-list">
              {attention.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className={`is-${item.tone}`}
                    onClick={() => item.destination === "data" ? onOpenData() : onOpenSection(item.destination)}
                  >
                    <span className="reliability-attention-list__marker" aria-hidden />
                    <span className="reliability-attention-list__copy">
                      <strong>{item.title}</strong>
                      <small>{item.detail}</small>
                    </span>
                    <span className="reliability-attention-list__action">{item.action} →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card reliability-response" aria-labelledby="reliability-response-title">
          <div className="section-heading compact">
            <div>
              <span className="page-kicker">Incident path</span>
              <h2 id="reliability-response-title">Diagnose, correlate, recover</h2>
            </div>
          </div>
          {/* Not the rail again. These three are the same destinations as the
              three tabs one row above, and the temptation on noticing that is
              to delete the card as duplication.

              The rail is an index: five sections in a fixed order, none of
              which says which one to open first, or that Logs is worth reading
              before Remediation rather than after. This is a procedure — 01,
              02, 03 — and the ordering is the information. An `<ol>` says that
              in markup as well as in the numerals.

              Delete it only when the rail itself can express a sequence. */}
          <ol className="reliability-response-steps">
            <li>
              <button type="button" onClick={() => onOpenSection("services")}>
                <span className="num">01</span>
                <span><strong>Inspect services</strong><small>Find the provider, circuit, venue or quota under pressure.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenSection("events")}>
                <span className="num">02</span>
                <span><strong>Correlate logs</strong><small>Read server dispatch and browser wire events on one timeline.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
            <li>
              <button type="button" onClick={() => onOpenSection("controls")}>
                <span className="num">03</span>
                <span><strong>Recover safely</strong><small>Preview the target, cost and scope before a guarded mutation.</small></span>
                <span aria-hidden>→</span>
              </button>
            </li>
          </ol>
        </section>
      </div>

      {/* Conditional at the section boundary, not `hidden` here: the parent
          mounts this half only when the reader is on it, so nothing below is a
          hidden subtree quietly holding an observer. */}
      <LatencyTrend history={view.latencyHistory} />
    </div>
  );
}
