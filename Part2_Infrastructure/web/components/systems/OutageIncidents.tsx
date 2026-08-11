"use client";

/**
 * Active operator-simulated outages, rendered as incident rows where a data
 * engineer triages: Quality & Incidents. QuarantinePanel next to this reports
 * *content* failures; an outage is a *transport* incident — a provider held
 * out of routing on purpose — and before this strip existed it was visible
 * only on the Providers & Capacity failover graph, so the one subtab named
 * "Incidents" was silent about the incident the operator just caused.
 */

interface OutageIncidentsProps {
  outages: Array<{ provider: string; expiresAt: number; note: string }>;
  /** id → display label, from the provider matrix. */
  providerLabels: Record<string, string>;
  onOpenProviders: () => void;
}

export default function OutageIncidents({
  outages,
  providerLabels,
  onOpenProviders,
}: OutageIncidentsProps) {
  if (outages.length === 0) return null;
  const now = Date.now();

  return (
    <div className="card console-card" role="status" aria-label="Active simulated outages">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Active incidents</span>
          <h2>Operator-simulated outages</h2>
        </div>
        <span className="section-note">
          Held out of routing on purpose — requests fall through to the next provider in the chain.
        </span>
      </div>
      <ul className="console-incident-list">
        {outages.map((outage) => {
          const seconds = Math.max(0, Math.ceil((outage.expiresAt - now) / 1000));
          return (
            <li key={outage.provider} className="console-incident-list__row">
              <span aria-hidden style={{ color: "var(--warning-text)" }}>▲</span>
              <div>
                <strong>{providerLabels[outage.provider] ?? outage.provider}</strong>{" "}
                held out of routing · restores in {seconds}s
                {outage.note && <small className="console-wrap"> {outage.note}</small>}
              </div>
              <button type="button" className="console-node__action" onClick={onOpenProviders}>
                Manage in Providers
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
