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
import { verdictChip } from "./certificate-verdict";
import FamilyChoice, { type FamilySectionProps } from "./FamilyChoice";
import { StateChip } from "./Figure";
import BasketWhatIf from "./BasketWhatIf";
import PortfolioPane from "./PortfolioPane";
import SectionVerdict from "./SectionVerdict";

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
        lede="Where no probability measure fits, duality hands back a basket that wins in every state: the certificate of infeasibility IS the trade."
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
        {/* The same band, in the same place, as the other five sections. This
            one has no switcher — it is a single-view section — so the pinned
            row above it carries the family picker alone. */}
        <SectionVerdict
          pending={
            error && !answer
              ? <><span aria-hidden="true">✕</span> The test could not be run: {error}</>
              : !answer
                ? "Pricing this family…"
                : null
          }
        >
          {answer ? (
            <>
              <StateChip {...verdictChip(answer)} value={answer.net_edge} />
              <StateChip
                mark="◇"
                word={answer.legs.length ? "Legs in the basket" : "No basket returned"}
                value={answer.legs.length ? String(answer.legs.length) : null}
                tone="muted"
              />
              <StateChip
                mark="→"
                word="Fees on the basket"
                value={answer.total_fees ?? "—"}
                tone="muted"
              />
            </>
          ) : null}
        </SectionVerdict>

        {/* NOT GATED ON `answer`, and that is the point of drawing it here.
            The certificate takes seconds on a 188-strike family; the QUOTES it
            is about are already in memory, off the universe read the picker
            above is built from. Gated, the one operated figure on this tab
            vanished exactly while a reader was waiting for something to look
            at. `BasketWhatIf` moved here from the Coherence test on 2026-08-26:
            it is the cost of a cover, which is this section's subject. */}
        {chosen ? <BasketWhatIf event={chosen} /> : null}

        {answer ? <PortfolioPane certificate={answer} chosen={chosen} /> : null}
      </FamilyChoice>
    </section>
  );
}
