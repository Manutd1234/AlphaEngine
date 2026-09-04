"use client";

/** Direct REST clients and the current two-sided-book evidence behind them. */

import type { SystemHealth } from "@/components/systems/types";
import { fmt, metricRow } from "@/lib/format";

type Venue = SystemHealth["venues"][number];

function latencyCell(venue: Venue) {
  const latency = venue.latency;
  if (!latency.n) return <span className="muted">not yet called</span>;
  return (
    <span className="console-latency-cell">
      <strong className="num">{fmt(latency.p95 ?? 0, 0)}ms</strong>
      <small className="muted num">
        {metricRow([`p50 ${fmt(latency.p50 ?? 0, 0)}`, `p99 ${fmt(latency.p99 ?? 0, 0)}`, `n=${latency.n}`])}
      </small>
    </span>
  );
}

export default function DirectVenueTable({
  observed,
  venues,
  onInspectEvents,
}: {
  observed: boolean;
  venues: SystemHealth["venues"];
  onInspectEvents: (query: string, label: string) => void;
}) {
  if (!observed) return null;
  return (
    <>
      <p className="console-subhead">
        Direct venue clients
        <small className="muted">
          {venues.length > 0
            ? <>{" "}— reached by <code>/api/depth</code> and <code>/api/tca</code> without the registry, so they have no failover chain and no breaker.</>
            : <>{" "}— none registered in this deployment, so nothing reaches an exchange without the registry here. An empty registry, not a failed probe.</>}
        </small>
      </p>

      {venues.length > 0 && (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">Live-book status and latency of exchange clients bypassing the provider registry.</caption>
            <thead>
              <tr>
                <th scope="col">Client</th>
                <th scope="col">Latest live book</th>
                <th scope="col">p50 / p95 / p99</th>
                <th scope="col">Error rate</th>
                <th scope="col">Investigate</th>
              </tr>
            </thead>
            <tbody>
              {venues.map((venue) => {
                const observation = venue.observation;
                return (
                  <tr key={venue.id}>
                    <td>{venue.label}</td>
                    <td className="console-status-cell">
                      {observation ? (
                        <>
                          <span style={{
                            color: observation.state === "fresh"
                              ? "var(--success-text)"
                              : observation.state === "failed"
                                ? "var(--critical-text)"
                                : "var(--text-secondary)",
                          }}>
                            <span aria-hidden>
                              {observation.state === "fresh" ? "●" : observation.state === "failed" ? "✕" : "◌"}
                            </span>{" "}
                            {observation.state}
                          </span>
                          <small className="muted console-wrap">{observation.detail}</small>
                        </>
                      ) : <span className="muted">not observed</span>}
                    </td>
                    <td>{latencyCell(venue)}</td>
                    <td>
                      {venue.latency.n
                        ? `${fmt(venue.latency.errorRate * 100, 1)}%`
                        : <span className="muted">—</span>}
                    </td>
                    <td>
                      <button
                        type="button"
                        onClick={() => onInspectEvents(venue.id, venue.label)}
                        title={`Open Logs & Traces filtered to ${venue.label}`}
                      >
                        Logs
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
