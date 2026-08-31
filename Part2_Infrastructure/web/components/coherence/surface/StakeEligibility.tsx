"use client";

/**
 * Which watched families the solver can size, and why this one is not among them.
 *
 * THE BRANCH A READER MEETS MOST OFTEN HAD NO DRAWING. Fed the market's own
 * mids the solver usually declines, and when it declines a family outright this
 * is the whole view — so "the empty branch draws too" was being broken in the
 * one place it costs most. What stood here instead was three paragraphs and a
 * row of buttons: the reader had to read that a family needs the exchange's
 * mutually-exclusive flag, then read how many others carry it, then find them
 * in a button row that said nothing about why they were listed.
 *
 * Drawn, it is one picture: every watched family, the ones carrying the flag
 * marked and the ones not marked hatched, and the family the reader is standing
 * on outlined. "Why not this one, and where can I go" stops being two
 * paragraphs and becomes a glance.
 *
 * THE MARK CARRIES IT, NOT THE FILL. A hatch and a `✕` rather than a colour,
 * for the reason every figure on this engine is built that way — in Windows
 * High Contrast two fills collapse to one and the texture is what survives.
 *
 * NO REFERENCE LINE, and its absence is a decision rather than an omission.
 * A reference is a level a reader judges marks against; eligibility is a
 * property each family either has or does not, so a line would be drawing a
 * threshold where there is a predicate.
 */

import type { CoherenceEventView } from "@/lib/coherence/types";
import { DIAGRAM_LABEL_PX, glyphClassOf, glyphsWithin } from "@/lib/coherence/label-metrics";
import Figure, { FigureEmpty, Plot } from "../Figure";

const TOP = 10;
const BOX_H = 40;
const GAP = 10;
const PAD = 7;

/** Trim a ticker to its box, by the measured advance for its own glyph class. */
function fit(text: string, boxWidth: number): string {
  const budget = Math.max(4, glyphsWithin(boxWidth - PAD * 2, DIAGRAM_LABEL_PX, glyphClassOf(text)));
  return text.length <= budget ? text : `${text.slice(0, budget - 1)}…`;
}

export default function StakeEligibility({ events, target }: {
  events: readonly CoherenceEventView[];
  /** The family the reader is standing on, which is the one that was declined. */
  target: string;
}) {
  if (!events.length) {
    return (
      <Figure
        caption="Every watched family, and which of them the solver can size"
        ariaLabel="No family eligibility diagram is available because this poll returned no watched families"
        reading="The eligibility comparison resumes when the universe gateway returns at least one watched family."
        missing="No family is invented from a stale poll or a configured ticker."
      >
        <FigureEmpty reason="No watched family was returned in this poll." />
      </Figure>
    );
  }

  // The target first, so the family the reader asked about is where their eye
  // already is. The rest keep the order the universe read sent them in — a
  // sort by eligibility would put the answer before the question.
  const drawn = [...events].sort((a, b) =>
    a.event_ticker === target ? -1 : b.event_ticker === target ? 1 : 0);
  const eligible = drawn.filter((event) => event.mutually_exclusive).length;
  const height = TOP + BOX_H + 30;

  return (
    <Figure
      caption="Every watched family, and which of them the solver can size"
      ariaLabel={
        `${drawn.length} watched families. ${eligible} carry the exchange's mutually-exclusive flag and can be sized; `
        + `${drawn.length - eligible} do not. This family, ${target}, is the one that was declined.`
      }
      reading={
        eligible
          ? `${eligible} of ${drawn.length} watched families carry the flag the solver needs. Pressing one below sizes it instead.`
          : "No watched family carries the flag on this poll, so nothing here can be sized until the watchlist names one."
      }
      missing="The flag is the exchange's own, read off the event; a family without it is refused by name rather than scored badly."
      notes={[
        // The phrase "declines this family by name" is pinned by
        // `tests/helpers/prices-claims.ts` and kept verbatim. It moved file
        // rather than changing: a ladder refused by name is a different claim
        // from a ladder scored badly, and rewording it here would have retired
        // a load-bearing sentence while looking like a copy edit.
        "Correct rather than a gap: on a strike ladder a threshold wins wherever the one above it wins, so one market"
        + " pays in several bins; the exclusive-family solver states one market per state and declines this family"
        + " by name.",
        "A family carrying the flag can still be refused: one with an unquoted leg is refused too, because dropping"
        + " the leg would let a partial basket read as certain.",
        "Lattice draws this family in full — the survival curve, the mass between the strikes and the moments all come"
        + " from the distribution read, which a ladder answers. The measure is readable; only the bet is not.",
      ]}
    >
      <Plot height={height}>
        {(width) => {
          const count = drawn.length;
          const boxW = Math.max(70, (width - (count - 1) * GAP) / count);
          return (
            <>
              {drawn.map((event, index) => {
                const x = index * (boxW + GAP);
                const here = event.event_ticker === target;
                const ok = event.mutually_exclusive;
                return (
                  <g key={event.event_ticker}>
                    <rect
                      x={x}
                      y={TOP}
                      width={boxW}
                      height={BOX_H}
                      rx={6}
                      className="coh-form__box"
                      fill={ok ? undefined : "url(#diff-hatch)"}
                    >
                      <title>
                        {ok
                          ? `${event.event_ticker} carries the exchange's mutually-exclusive flag, so the solver can size it.`
                          : `${event.event_ticker} does not carry the flag, so the solver declines it by name.`}
                      </title>
                    </rect>
                    <text x={x + PAD} y={TOP + 17} className="coh-form__title">
                      <tspan aria-hidden="true">{ok ? "✓" : "✕"}</tspan> {fit(event.event_ticker, boxW)}
                      <title>{event.event_ticker}</title>
                    </text>
                    <text x={x + PAD} y={TOP + 33} className="coh-figure__key">
                      {event.markets.length} outcome{event.markets.length === 1 ? "" : "s"}
                    </text>
                    {here ? (
                      <>
                        <line
                          x1={x}
                          x2={x + boxW}
                          y1={TOP + BOX_H + 6}
                          y2={TOP + BOX_H + 6}
                          className="coh-dollarbar__dollar"
                        />
                        <text x={x} y={TOP + BOX_H + 22} className="coh-figure__key">this family</text>
                      </>
                    ) : null}
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
