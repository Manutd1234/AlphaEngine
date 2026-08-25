"use client";

/**
 * Basket — the portfolio the coherence test hands back, and what it pays.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `portfolio` was a rail section for
 * part of 2026-08-24, was folded into Dutch book as a one-view group that
 * evening, and returns on 2026-08-25 with the id it was published under — so
 * this restores a `#coherence/portfolio` link rather than costing one.
 *
 * WHY IT IS NOT A VIEW OF THE TEST. Duality is the argument the whole engine
 * rests on: where no probability measure fits a family's prices, the
 * certificate of infeasibility IS the trade. A view is component state that no
 * URL can name and `desk-sweep.mjs` never walks, which is the wrong shape for
 * the thing the tab exists to show.
 *
 * THE HONEST PROBLEM WITH THAT, STATED HERE BECAUSE IT IS THIS SECTION'S: the
 * common answer is coherent, so the common answer hands back NO portfolio, and
 * a rail section whose usual state is one sentence of absence is a dead end the
 * sweep would be right to flag. That is why the gateway now reports the
 * programme's margin on the coherent path (`kernel/dutchbook.py`): the section
 * opens on what the solver concluded and how far it fell short, and the empty
 * text is the fallback for a read that genuinely produced nothing.
 */

import type { CoherenceCertificate } from "@/lib/coherence/types";
import { certifyRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import FamilyChoice, { type FamilySectionProps } from "./FamilyChoice";
import PortfolioPane from "./PortfolioPane";

export default function BasketSection({
  events,
  target,
  onFamily,
  active,
  eventsPending = false,
  eventsError = null,
}: FamilySectionProps) {
  // The same URL Coherence test reads, so the cache answers this one for free.
  const { data, error } = useCoherenceRead<CoherenceCertificate>(
    certifyRoute(target),
    active && Boolean(target),
  );
  const answer: CoherenceCertificate | null = data && data.component_id === target ? data : null;
  const chosen = events.find((event) => event.event_ticker === target) ?? null;

  return (
    <section className="card console-card coh-certificate" aria-labelledby="coherence-portfolio-heading">
      <PaneHead
        kicker="Basket"
        title="The portfolio the test hands back"
        id="coherence-portfolio-heading"
        note="one basket per family, priced through all three fee components"
        lede="Where no probability measure fits a family's prices, duality hands back the basket that wins in every state — so the certificate of infeasibility IS the trade."
      />

      <FamilyChoice
        events={events}
        target={target}
        onFamily={onFamily}
        eventsPending={eventsPending}
        eventsError={eventsError}
        label="Choose a family to price"
        verdict={answer?.verdict ?? null}
      >
        {error && !answer ? (
          <p className="console-empty">
            <span aria-hidden="true">✕</span> The test could not be run: {error}
          </p>
        ) : !answer ? (
          <p className="console-empty muted">Pricing this family…</p>
        ) : (
          <PortfolioPane certificate={answer} chosen={chosen} />
        )}
      </FamilyChoice>
    </section>
  );
}
