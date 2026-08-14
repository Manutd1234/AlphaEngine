"use client";

/**
 * The boundary every zero on this tab is measured inside.
 *
 * `instance.scope`, `instance.shared` and `instance.uptimeMs` have been on the
 * wire, typed, and read by exactly one line in the whole tree (`.id`, for a
 * label). `scope` states outright whether the counters here were merged across
 * instances through the gateway ledger or measured by this lambda alone, and
 * that single sentence is the difference between "the desk validated nothing"
 * and "the process answering this request validates nothing, by design".
 *
 * It is the highest-value block on the tab and it is not a chart. Four facts,
 * in the same tile grid the decision evidence uses, so the reader does not have
 * to learn a second layout to read the caveat for the first.
 */

import type { SystemHealth } from "@/components/systems/types";
import { deriveInstanceScope } from "@/lib/data-trust";

import { TONE_GLYPH } from "./trust-marks";

export default function InstanceScope({ health }: { health: SystemHealth | null }) {
  const facts = deriveInstanceScope(health);

  return (
    <section className="data-trust-section" aria-labelledby="trust-scope-heading">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Measurement scope</span>
          <h2 id="trust-scope-heading">Whose numbers these are</h2>
        </div>
        <span className="section-note">read from the snapshot, not assumed</span>
      </div>

      <div className="data-trust-evidence-grid">
        {facts.map((fact) => (
          <article key={fact.id} className={`card data-trust-evidence is-${fact.tone}`}>
            <div>
              <span aria-hidden>{TONE_GLYPH[fact.tone]}</span>
              <small>{fact.label}</small>
            </div>
            <strong className="num" title={fact.value}>{fact.value}</strong>
            <p>{fact.detail}</p>
          </article>
        ))}
      </div>

      {/* The mechanism folds; the caveat does not. The scope tile above already
          carries "Per-instance" with a warn tone, so what collapses here is WHY
          — which routes increment which counters — and the summary still states
          the fact plainly for a reader who never opens it. */}
      <details className="disclosure">
        <summary>
          Why validation, cache, lineage and quarantine read empty here however busy the desk is
        </summary>
        <p className="research-note">
          Those four counters are incremented inside the quote and bar routes, and this response is
          built by a <strong>different function instance</strong> — a deployment boundary, not a
          quiet system. The feed, provider, route and quota evidence on the other panes is gathered
          while this request is served, which is why it is populated when they are not.
        </p>
      </details>
    </section>
  );
}
