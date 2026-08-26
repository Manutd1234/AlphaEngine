"use client";

/**
 * Coherence test — is there a Dutch book in this family, and the proof.
 *
 * ONE READ, ONE QUESTION, ONE CONTROL ROW. Until 2026-08-25 this section was
 * "Dutch book" and carried six views under three groups over a wrapping row of
 * family pills: three rows of chrome before any drawing, which is what the
 * reader meant by "too many subtabs and subsubtabs". The three groups were
 * three questions and are now three sections — this one, `portfolio` (Basket)
 * and `combos` (Parlays) — each an id that was already published, so the split
 * DELETED two entries from `RELOCATED_SECTIONS` rather than inventing any.
 *
 * What is left here is the verdict and the proof of it: two views of one
 * `certify` answer, which is one `.seg` and no group level at all.
 *
 * THE FAMILY IS NOT THIS PANE'S. It belongs to `CoherenceConsole` and is shared
 * with Basket, because the two sections read the SAME certify answer for the
 * same family — a verdict and the portfolio that verdict hands back. Two
 * sections disagreeing about which family they are describing is the defect
 * that hoisting prevents; the argument for keeping it local is recorded in
 * `FamilyPicker` and was written when this was one section.
 *
 * THE STALE-ANSWER GUARD IS THE `component_id` COMPARISON, not a spinner.
 * `useCoherenceRead` keeps the last good payload across a failed poll, which is
 * right, and until 2026-08-25 it kept it across a CHANGED URL too — so pressing
 * a new family left the previous family's verdict, chips and proof text on
 * screen under the new family's name for up to twenty-eight seconds. The hook
 * now resets on a URL change; this comparison is the second belt, and it is
 * readable at the point where the disagreement would be visible.
 */

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { certifyRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import { ProofView, VerdictView, verdictReading } from "./CertificateViews";
import { verdictChip } from "./certificate-verdict";
import FamilyChoice, { type FamilySectionProps } from "./FamilyChoice";
import LadderPrices from "./LadderPrices";
import { StateChip } from "./Figure";
import SectionVerdict from "./SectionVerdict";

type CertificateView = "verdict" | "proof";

const VIEWS: ReadonlyArray<[CertificateView, string]> = [
  ["verdict", "Verdict"],
  ["proof", "Proof"],
];

export default function CertificatePane({
  events,
  target,
  onFamily,
  active,
  eventsPending = false,
  eventsError = null,
  view,
  onView,
}: FamilySectionProps & {
  /** The view this section is standing on, and how a press changes it — owned
   *  by the console since 2026-08-26: a view is an address, and a `useState`
   *  here is unreachable from the hash. See `lib/section-views.ts`. */
  view: CertificateView;
  onView: (next: CertificateView) => void;
}) {
  const { data, error } = useCoherenceRead<CoherenceCertificate>(
    certifyRoute(target),
    active && Boolean(target),
  );
  // The answer on screen must be about the family named above it.
  const answer: CoherenceCertificate | null = data && data.component_id === target ? data : null;
  // THE PRICES THE VERDICT IS ABOUT. This section argued that a family's quotes
  // do or do not admit a probability measure and drew none of them — 574px, the
  // thinnest on the tab — while the universe read it already warms carries every
  // leg's two sides, its strike and its open interest. No new route: this is the
  // payload the family picker above is already built from.
  const chosen = events.find((event) => event.event_ticker === target) ?? null;

  return (
    <section className="card console-card coh-certificate" aria-labelledby="coherence-certificate-heading">
      <PaneHead
        kicker="Coherence test"
        title="Whether these prices admit a probability measure"
        id="coherence-certificate-heading"
        note="one test per family"
        lede="The usual answer is “coherent”, and that is the claim: a detector that spoke only on a hit would leave “no opportunity” and “the feed is down” identical."
      />

      <FamilyChoice
        events={events}
        target={target}
        onFamily={onFamily}
        eventsPending={eventsPending}
        eventsError={eventsError}
        label="Choose a family to test"
        verdict={answer?.verdict ?? null}
        switcher={
          <div className="seg" role="group" aria-label="Certificate view">
            {VIEWS.map(([name, label]) => (
              <button key={name} type="button" aria-pressed={view === name} onClick={() => onView(name)}>
                {label}
              </button>
            ))}
          </div>
        }
      >
        {/* THE ANSWER FIRST, IN THE SAME PLACE ON ALL SIX SECTIONS. These three
            chips were below the control row and above the reading; they are the
            band now, so a reader who switches section meets the verdict where
            they last met one. The chips themselves are unchanged. */}
        <SectionVerdict
          pending={
            error && !answer
              ? <><span aria-hidden="true">✕</span> The test could not be run: {error}</>
              : !answer
                ? "Testing this family…"
                : null
          }
        >
          {answer ? (
            <>
              <StateChip {...verdictChip(answer)} value={answer.net_edge} />
              <StateChip
                mark="◇"
                word={answer.engine === "highs" ? "Linear programme" : "Closed-form checks"}
                value={`${answer.rows_tested} tested`}
                tone="muted"
              />
              <StateChip mark="→" word={`Legging tier ${answer.tier}`} tone={answer.tier > 2 ? "warn" : "muted"} />
            </>
          ) : null}
        </SectionVerdict>

        {answer ? (
          <>
            {/* Only what the figures below cannot say. The sentence this used
                to open with — no portfolio pays more than it costs, so a
                measure exists — is `MarginAxis`'s own reading, drawn under the
                axis that measures it, and a reader met both on one screen. */}
            {verdictReading(answer) ? (
              <p className="coh-event__note">{verdictReading(answer)}</p>
            ) : null}

            {view === "proof"
              ? <ProofView data={answer} event={chosen} />
              : <VerdictView data={answer} target={target} />}
          </>
        ) : null}

        {/* NOT INSIDE THE BLOCK ABOVE, and that is the point. These prices come
            from the universe read, not from the certificate: they are what the
            test is ABOUT, not something it returns. Gated on `answer` they
            vanished exactly when they were most wanted — a 188-strike family
            takes seconds to certify, and for those seconds the section showed a
            spinner and nothing else while the whole book sat in memory.

            Verdict only: on Proof the subject is the certificate itself. */}
        {/* THE PRICES THE VERDICT IS ABOUT, and only those. `BasketWhatIf` was
            drawn here too until 2026-08-26 and has moved to Basket, which is
            the section it names: it is the operated figure of what a cover
            COSTS, and Basket is where a reader goes for the portfolio rather
            than for the verdict. It also left this section with two figures
            about prices and Basket with two that degenerate on the ordinary
            answer, which is the imbalance the reader saw. */}
        {view === "verdict" && chosen ? <LadderPrices event={chosen} /> : null}
      </FamilyChoice>
    </section>
  );
}
