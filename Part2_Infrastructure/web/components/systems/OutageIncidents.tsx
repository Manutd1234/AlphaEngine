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
  const now = Date.now();

  /**
   * Says so, rather than vanishing.
   *
   * `return null` here left Reliability > Quality & Incidents as a button, a
   * definition list and two paragraphs on any healthy deployment — the thinnest
   * panel on the desk, on the subtab named Incidents. An absent card and a card
   * reporting an absence look identical to the reader and mean different
   * things, and only one of them tells them the check ran. It is also the same
   * verb `no-dead-ends.test.ts` already forbids on a provenance test; a count
   * is no different.
   */
  if (outages.length === 0) {
    return (
      <div className="card console-card" role="status" aria-label="Simulated outages">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Active incidents</span>
            <h2>Operator-simulated outages</h2>
          </div>
          <span className="section-note">none active</span>
        </div>
        <p className="muted">
          No provider is under a simulated outage right now. These are operator-caused and
          operator-cleared — a drill, never an upstream fault — so an empty list here says nothing
          about whether the providers themselves are healthy.
        </p>
        {onOpenProviders && (
          <button type="button" className="small" onClick={onOpenProviders}>
            Open providers &amp; capacity
          </button>
        )}
      </div>
    );
  }

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
