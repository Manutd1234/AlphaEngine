"use client";

/**
 * Dutch book — the coherence test, its proof, the basket it hands back, and the
 * parlays whose own legs bound them.
 *
 * SIX VIEWS, ONE `.seg`, AND THAT IS THE WIDEST CONTROL ON THE DESK. Verdict,
 * Proof and Certificate come from one `certify` call on the chosen family;
 * Bands, Parlays and Bounds come from one `combos` call on the exchange's own
 * listings. The seg WRAPS rather than shrinking its type — a per-tab seg size
 * is the defect `nav-type-markets-coherence.test.ts` was written against, so
 * `14r` gives this control a second row and a `flex-basis` floor instead, and
 * says so where it does it.
 *
 * WHAT CAME BACK ON 2026-08-24, TWICE OVER
 * ------------------------------------------------------------------------
 * The pane had three views; the promotion pass that morning made the third —
 * the legs, their fee columns and the payoff-by-state figure — the `portfolio`
 * rail section, because answering its own question from behind a `.seg` meant
 * no URL reached it and `desk-sweep.mjs` never walked it. The merge took the
 * tenth tab back and the subject with it. The consolidation that evening then
 * folded `combos` in as well, and that fold is the expensive one: `combos` was
 * PUBLISHED on `origin/main`, so `#coherence/combos` is a link someone holds.
 * `RELOCATED_SECTIONS` lands it here rather than on the rail default; it lands on
 * the SECTION, and which view opens is component state no hash can name.
 *
 * WHY THE PARLAYS BELONG HERE and are not a section of their own: the Fréchet
 * bounds test IS a coherence test. Same failure, same verdict vocabulary, run
 * on a conjunction the venue quotes rather than on strikes this engine reads a
 * measure off. A reader who has just been told these prices admit a probability
 * is one press from "and here is the same question asked of the parlays".
 *
 * PAYOFF AND LEGS BECAME ONE VIEW, and that reverses a split made hours
 * earlier. They were two because `PayoffByState` shows the payoff in EVERY
 * state ("wins in every state" is a claim about a set, and a table cannot show
 * "every") while the leg table shows what each leg costs through all three fee
 * components — one answers "is it true", the other "check it by hand". Both
 * still do. What changed is the cost of a button: at six views a seventh would
 * have made the switcher the loudest object in the card. So Certificate draws
 * the figure and puts the eight-column leg table behind a `<details>` that
 * names what is in it — "summarise the content more, use dropdowns, hide,
 * summarise, remove but keep the details". Nothing was removed; the reader who
 * came for the claim meets the claim, and the reader checking it by hand opens
 * one disclosure instead of pressing one more segment.
 *
 * THE TWO READS ARE NEVER IN FLIGHT TOGETHER, and that gate is the reason the
 * `view` state lives here rather than inside either half. `certify` is a 25s
 * gateway call behind a 28s browser deadline; a `combos` read is a book call
 * per leg on top of its own and takes about as long. Each is gated on the three
 * views that draw it, so opening Dutch book costs one slow call and never two —
 * the same shape as `BooksSection`'s gate against the signed RFQ channel.
 *
 * THE FOURTH REVIEW OF THE DAY, and the one that touched no structure: "use
 * dropdowns, hide, summarise, remove but keep the details", plus a drawing in
 * every view. All six now open on a figure — the verdict's four money rows and
 * the proof's coverage as signed strips, the payoff by state, the band strips,
 * the per-parlay band, the slack against each bound — and the detail behind
 * each one took a `<details>` whose summary says what is inside and how much.
 * Nothing was deleted. What that buys is the thing the reader has asked for
 * three times: the answer is the first thing on screen and the audit is one
 * press away, rather than the audit being the scroll between them.
 *
 * REFUSED here: hiding the proof text on the Proof view. It is what the view
 * is named for; a summary over it would be a section that hides its own
 * subject. Its NOTES went behind one, because those describe the run.
 *
 * The family picker and the chip row stay OUTSIDE the switcher and are drawn
 * only on the three certificate views: all three are read relative to them, and
 * the parlays are a property of the exchange's listings rather than of a chosen
 * family, so a picker above them would claim a relationship that is not there.
 * The verdict and proof drawings are `CertificateViews.tsx` and the parlays are
 * `CombosPane.tsx`; the ceiling's rule is to split rather than shave prose.
 */

import { useState } from "react";

import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import { certifyRoute } from "@/lib/coherence/routes";
import PaneHead from "./PaneHead";
import { useCoherenceRead } from "@/lib/coherence/use-coherence";
import CertificateGroups, { GROUP_VIEWS, type CertificateGroup } from "./CertificateGroups";
import { verdictChip, verdictReading } from "./CertificateViews";
import FamilyPicker from "./FamilyPicker";
import { StateChip } from "./Figure";

/**
 * The three groups, in reading order, and the labels are the argument.
 *
 * "Coherence test" and "Basket" are one `certify` read drawn two ways — is
 * there a Dutch book, and here is the portfolio that would take it — while
 * "Parlays" is the second read. A reader moves from the claim to the thing the
 * claim hands back to the same question asked of the venue's own conjunctions.
 *
 * The views inside each are `GROUP_VIEWS` in `CertificateGroups.tsx`, so this
 * file names the groups once and cannot offer one that holds nothing.
 */
const GROUPS: ReadonlyArray<[CertificateGroup, string]> = [
  ["test", "Coherence test"],
  ["basket", "Basket"],
  ["parlays", "Parlays"],
];

export default function CertificatePane({
  events,
  active,
  eventsPending = false,
  eventsError = null,
}: {
  events: CoherenceEventView[];
  active: boolean;
  /** True while the console's universe read has not yet answered either way. */
  eventsPending?: boolean;
  /** The universe read's failure, when that is why `events` is empty. */
  eventsError?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [group, setGroup] = useState<CertificateGroup>("test");
  // The GROUP is the gate, not the view. Its three parlay views are exactly the
  // `combos` read, so pressing between two views of one group re-arms nothing.
  const onParlays = group === "parlays";
  const target = selected ?? events[0]?.event_ticker ?? "";
  const { data, error } = useCoherenceRead<CoherenceCertificate>(
    certifyRoute(target),
    active && !onParlays && Boolean(target),
  );

  const head = {
    kicker: "Dutch book",
    title: "The coherence test, its proof & the parlays it bounds",
    id: "coherence-certificate-heading",
    note: "one test per family, one band per parlay",
    lede: "The usual answer is “coherent”, and that is the claim — a detector that spoke only on a hit would leave “no opportunity” and “the feed is down” looking identical.",
  };

  return (
    <section className="card console-card coh-certificate" aria-labelledby="coherence-certificate-heading">
      <PaneHead {...head} />

      {/* Drawn before either branch, and unconditionally: the parlays need no
          family, so a reader who arrives while the universe read is in flight —
          or has failed — must still reach them. Gating this on `events` is how
          the merge made three views unreachable for the slowest seconds of a
          first visit. Three groups where there were six flat views: the row is
          a row again, and `GROUP_VIEWS` holds what is inside each. */}
      <div className="seg" role="group" aria-label="Certificate group">
        {GROUPS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={group === name} onClick={() => setGroup(name)}>
            {label}
          </button>
        ))}
      </div>

      {onParlays ? (
        // `key` remounts on a group change so the view resets to the group's
        // first, rather than an effect rendering the old group's view for a
        // frame — which here is a frame of a figure drawn from the other read.
        <CertificateGroups
          key={group}
          group={group}
          // Redundant against the branch that renders it, and kept anyway: the
          // conjunction is where the gate is READABLE, and it is what
          // `coherence-sections.test.ts` pins. A gate that holds only because a
          // branch happens not to mount is a gate nobody can see.
          active={active && onParlays}
          data={null}
          target=""
          chosen={null}
        />
      ) : !events.length ? (
        // Three different absences, told apart: a read still in flight looks
        // like reading, a failed read names the failure, and only a read that
        // answered with nothing claims nothing has been read. The universe read
        // is a live one on a 28-second deadline, so for its first seconds this
        // section used to claim "none has been read" while the read was under
        // way — a slow open dressed as a dead pane.
        <p className="console-empty">
          <span aria-hidden="true">{eventsError ? "✕" : "◌"}</span>{" "}
          {eventsError
            ? <>The families could not be read, so there is nothing to test: {eventsError}</>
            : eventsPending
              ? "Reading the families this engine prices…"
              : "Nothing to test yet — no family has been read on Universe."}
        </p>
      ) : (
        <>
          <FamilyPicker
            tickers={events.map((event) => event.event_ticker)}
            selected={target}
            onSelect={setSelected}
            label="Choose a family to test"
          />

          {error && !data ? (
            <p className="console-empty">
              <span aria-hidden="true">✕</span> The test could not be run: {error}
            </p>
          ) : !data ? (
            <p className="console-empty muted">Testing this family…</p>
          ) : (
            <>
              <div className="coh-status__chips">
                <StateChip {...verdictChip(data)} value={data.net_edge} />
                <StateChip
                  mark="◇"
                  word={data.engine === "highs" ? "Linear programme" : "Closed-form checks"}
                  value={`${data.rows_tested} tested`}
                  tone="muted"
                />
                <StateChip mark="→" word={`Legging tier ${data.tier}`} tone={data.tier > 2 ? "warn" : "muted"} />
              </div>
              <p className="coh-event__note">{verdictReading(data)}</p>

              <CertificateGroups
                key={group}
                group={group}
                active={active && !onParlays}
                data={data}
                target={target}
                chosen={events.find((event) => event.event_ticker === target) ?? null}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}
