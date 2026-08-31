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
import PortfolioPane, { type BasketViewId } from "./PortfolioPane";
import SectionVerdict from "./SectionVerdict";
import ProofsViewControl from "./ProofsViewControl";
import ProofsTransportNotice from "./ProofsTransportNotice";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Three questions, in the order a reader asks them: what a cover would cost,
 * what the test handed back, and whether it could be put on.
 */
const VIEWS: ReadonlyArray<[BasketViewId, string]> = [
  ["cover", "Cover"],
  ["basket", "Basket"],
  ["size", "Size"],
];

type DeferredBasketView = Exclude<BasketViewId, "cover">;
type BasketReadState = "pending" | "stale-target" | "unavailable";

/**
 * Basket and Size both depend on the matching certificate. Keep the selected
 * view visible while that read changes underneath it: a blank body makes a
 * working view control indistinguishable from a dead one, especially during a
 * family switch when the cache still holds the previous family's answer.
 */
function BasketViewReadStatus({
  view,
  state,
  target,
  onRetry,
}: {
  view: DeferredBasketView;
  state: BasketReadState;
  target: string;
  onRetry: () => void;
}) {
  const subject = view === "basket" ? "Basket" : "Size";
  const copy = state === "unavailable"
    ? {
        title: `${subject} view unavailable`,
        detail: "The matching coherence certificate could not be read. No result from another family is substituted.",
      }
    : state === "stale-target"
      ? {
          title: `Switching ${subject} to the selected family`,
          detail: "The cached certificate belongs to the previous family, so it stays hidden until this family's read arrives.",
        }
      : {
          title: `Preparing the ${subject} view`,
          detail: view === "basket"
            ? "Waiting for the matching certificate before drawing returned legs and their state-by-state payoff."
            : "Waiting for the matching certificate before comparing every returned leg with venue capacity.",
        };

  return (
    <Alert
      variant={state === "unavailable" ? "destructive" : "default"}
      className="basket-view-read-state"
      data-basket-view-state={state}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={state !== "unavailable"}
    >
      <AlertTitle>{copy.title}</AlertTitle>
      <AlertDescription>
        <p>{copy.detail}</p>
        {target ? <code>{target}</code> : null}
        {state === "unavailable" ? (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry {subject.toLowerCase()} read
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export default function BasketSection({
  events,
  target,
  onFamily,
  active,
  eventsPending = false,
  eventsError = null,
  view,
  onView,
}: FamilySectionProps & {
  view: BasketViewId;
  onView: (next: BasketViewId) => void;
}) {
  // The same URL Coherence test reads, so the cache answers this one for free.
  const read = useCoherenceRead<CoherenceCertificate>(
    certifyRoute(target),
    active && Boolean(target),
  );
  const { data, error } = read;
  const answer: CoherenceCertificate | null = data && data.component_id === target ? data : null;
  const readState: BasketReadState = error
    ? "unavailable"
    : data && data.component_id !== target
      ? "stale-target"
      : "pending";
  const chosen = events.find((event) => event.event_ticker === target) ?? null;

  return (
    <section className="card console-card coh-certificate" aria-labelledby="coherence-portfolio-heading">
      <PaneHead
        kicker="Basket"
        title="Infeasibility dual basket"
        id="coherence-portfolio-heading"
        note="one basket per family; three fees"
        ledeSummary="Duality condition"
        lede="If no measure fits, Farkas duality returns the basket that wins in every state."
      />

      <FamilyChoice
        events={events}
        target={target}
        onFamily={onFamily}
        eventsPending={eventsPending}
        eventsError={eventsError}
        label="Choose a family to price"
        verdict={answer?.verdict ?? null}
        switcher={
          <ProofsViewControl
            className="seg"
            label="Basket view"
            options={VIEWS}
            value={view}
            onValue={onView}
          />
        }
      >
        <ProofsTransportNotice
          subject="Basket read"
          error={error}
          hasSnapshot={Boolean(answer)}
          transport={read.transport}
          retryAt={read.retryAt}
          consecutiveFailures={read.consecutiveFailures}
          onRetry={read.refresh}
        />
        {/* The same band, in the same place, as the other five sections. The
            switcher joined it on 2026-08-26 with the three-view redo; the
            pinned row above carries it beside the family picker. */}
        <SectionVerdict
          pending={
            !error && !answer ? "Pricing this family…" : null
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
            it is the cost of a cover, which is this view's subject — so it
            rides on Cover and stays ungated. */}
        {view === "cover" && chosen ? (
          /* The sliders are a local counterfactual over one family. A family
             change must start from that family's own quotes: without the key,
             React preserves the previous family's `asks` array and can pair
             stale prices with a different (or shorter) market list. */
          <BasketWhatIf key={chosen.event_ticker} event={chosen} />
        ) : null}

        {answer ? (
          <PortfolioPane certificate={answer} chosen={chosen} view={view} />
        ) : view === "basket" || view === "size" ? (
          <BasketViewReadStatus view={view} state={readState} target={target} onRetry={read.refresh} />
        ) : null}
      </FamilyChoice>
    </section>
  );
}
