"use client";

/**
 * The family control and the three ways a family list can be absent.
 *
 * Two sections read `certify` against a chosen family — Coherence test and
 * Basket — and both have to tell the same three absences apart before they can
 * draw anything: a universe read still in flight, one that failed, and one that
 * answered with nothing. Those look identical if written twice and drift the
 * first time one of them is edited, and the drift is invisible: each version
 * still renders a sentence.
 *
 * The distinction is the point rather than the tidiness. A read on a
 * twenty-eight second deadline spends its first seconds with no data and no
 * error, and this section used to claim "none has been read" for all of them —
 * a slow open dressed as a dead pane.
 */

import type { ReactNode } from "react";

import type { CoherenceEventView } from "@/lib/coherence/types";
import FamilyPicker from "./FamilyPicker";

/** What a section built on one family is handed by the console. */
export interface FamilySectionProps {
  events: CoherenceEventView[];
  /** The family being read. Chosen in the console so two sections cannot disagree. */
  target: string;
  onFamily: (ticker: string) => void;
  active: boolean;
  /** True while the console's universe read has not answered either way. */
  eventsPending?: boolean;
  /** The universe read's failure, when that is why `events` is empty. */
  eventsError?: string | null;
}

export default function FamilyChoice({
  events,
  target,
  onFamily,
  eventsPending = false,
  eventsError = null,
  label,
  verdict = null,
  children,
}: Omit<FamilySectionProps, "active"> & {
  label: string;
  /** The last verdict for the chosen family, shown against it in the list. */
  verdict?: string | null;
  children: ReactNode;
}) {
  if (!events.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">{eventsError ? "✕" : "◌"}</span>{" "}
        {eventsError
          ? <>The families could not be read, so there is nothing to test: {eventsError}</>
          : eventsPending
            ? "Reading the families this engine prices…"
            : "Nothing to test yet — no family has been read on Universe."}
      </p>
    );
  }

  return (
    <>
      <FamilyPicker
        options={events.map((event) => ({
          ticker: event.event_ticker,
          shard: event.exchange_index,
          verdict: event.event_ticker === target ? verdict : null,
        }))}
        selected={target}
        onSelect={onFamily}
        label={label}
      />
      {children}
    </>
  );
}
