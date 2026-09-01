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
 * Drawn, it is one picture: every watched family follows a visible path from
 * the family read, through the exchange's eligibility predicate, to the result
 * the solver will apply. The ones carrying the flag are marked and the ones not
 * carrying it are hatched; the family the reader is standing on says "current"
 * in its source box. "Why not this one, and where can I go" stops being two
 * paragraphs and becomes a glance.
 *
 * THE MARK CARRIES IT, NOT THE FILL. A hatch and a `✕` rather than a colour,
 * for the reason every figure on this engine is built that way — in Windows
 * High Contrast two fills collapse to one and the texture is what survives.
 *
 * A UML DECISION RATHER THAN A ROW OF UNRELATED CARDS. The former drawing put
 * the families beside one another with no edges, which made the marks look like
 * detached controls. They are not stages in one pipeline, either: every family
 * independently passes through the same predicate. One complete row per family
 * keeps that truth and gives every source a connected, visible result.
 */

import type { CoherenceEventView } from "@/lib/coherence/types";
import { DIAGRAM_LABEL_PX, glyphClassOf, glyphsWithin } from "@/lib/coherence/label-metrics";
import Figure, { FigureEmpty, Plot } from "../Figure";

const TOP = 34;
const ROW_H = 68;
const BOX_H = 48;
const FLOW_GAP = 48;
const DECISION_W = 120;
const MIN_WIDTH = 760;
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
        reserveInteractionRow={false}
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
  const height = TOP + drawn.length * ROW_H + 10;

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
      readout={<span className="num">{`${eligible}/${drawn.length} pass the predicate`}</span>}
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
      reserveInteractionRow={false}
    >
      <Plot height={height} minWidth={MIN_WIDTH} scrollLabel="Stake eligibility paths for every watched family">
        {(width) => {
          // Keep the decision rail compact on a wide desk and scroll it intact
          // on a narrow one. Stretching three nodes across the entire viewport
          // turns their arrows back into long, visually detached hairlines.
          const diagramW = Math.min(width - 24, 1120);
          const originX = (width - diagramW) / 2;
          const boxW = (diagramW - DECISION_W - 2 * FLOW_GAP) / 2;
          const familyX = originX;
          const decisionX = familyX + boxW + FLOW_GAP;
          const decisionCx = decisionX + DECISION_W / 2;
          const resultX = decisionX + DECISION_W + FLOW_GAP;

          const edge = (
            key: string,
            x1: number,
            x2: number,
            y: number,
            label: string,
          ) => (
            <g key={key} className="coh-form__arrow" data-stake-flow-edge={key}>
              <line x1={x1} x2={x2 - 8} y1={y} y2={y} />
              <polygon points={`${x2 - 8},${y - 4} ${x2},${y} ${x2 - 8},${y + 4}`} />
              <text x={(x1 + x2) / 2} y={y - 8} textAnchor="middle" className="coh-form__note">
                {label}
              </text>
            </g>
          );

          return (
            <>
              <text x={familyX} y={17} className="coh-figure__key">01 — FAMILY</text>
              <text x={decisionCx} y={17} textAnchor="middle" className="coh-figure__key">
                02 — ELIGIBILITY
              </text>
              <text x={resultX} y={17} className="coh-figure__key">03 — RESULT</text>

              {drawn.map((event, index) => {
                const y = TOP + index * ROW_H;
                const cy = y + BOX_H / 2;
                const here = event.event_ticker === target;
                const ok = event.mutually_exclusive;
                return (
                  <g key={event.event_ticker} data-stake-family-path={event.event_ticker}>
                    {edge(`${event.event_ticker}-read`, familyX + boxW, decisionX, cy, "read flag")}
                    {edge(`${event.event_ticker}-result`, decisionX + DECISION_W, resultX, cy, ok ? "yes" : "no")}

                    <rect
                      x={familyX}
                      y={y}
                      width={boxW}
                      height={BOX_H}
                      rx={6}
                      className="coh-form__box"
                      strokeWidth={here ? 2 : 1}
                    >
                      <title>
                        {`${event.event_ticker}: ${event.markets.length} outcomes${here ? ", the current family" : ""}.`}
                      </title>
                    </rect>
                    <text x={familyX + PAD} y={y + 19} className="coh-form__title">
                      {fit(event.event_ticker, boxW)}
                      <title>{event.event_ticker}</title>
                    </text>
                    <text x={familyX + PAD} y={y + 37} className="coh-form__note">
                      {`${event.markets.length} outcome${event.markets.length === 1 ? "" : "s"}${here ? "; current" : ""}`}
                    </text>

                    <polygon
                      points={`${decisionCx},${y} ${decisionX + DECISION_W},${cy} ${decisionCx},${y + BOX_H} ${decisionX},${cy}`}
                      className="coh-form__box"
                    >
                      <title>The solver requires the exchange's mutually-exclusive flag.</title>
                    </polygon>
                    <text x={decisionCx} y={cy - 3} textAnchor="middle" className="coh-form__title">
                      exclusive?
                    </text>
                    <text x={decisionCx} y={cy + 14} textAnchor="middle" className="coh-form__note">
                      {ok ? "✓ yes" : "✕ no"}
                    </text>

                    <rect
                      x={resultX}
                      y={y}
                      width={boxW}
                      height={BOX_H}
                      rx={6}
                      className="coh-form__box"
                      fill={ok ? undefined : "url(#diff-hatch)"}
                    >
                      <title>
                        {ok
                          ? `${event.event_ticker} is a sizing candidate; every leg must still be quoted.`
                          : `${event.event_ticker} is declined by name, while its ladder remains readable elsewhere.`}
                      </title>
                    </rect>
                    <text x={resultX + PAD} y={y + 19} className="coh-form__title">
                      <tspan aria-hidden="true">{ok ? "✓" : "✕"}</tspan>{" "}
                      {ok ? "Sizing candidate" : "Declined by name"}
                    </text>
                    <text x={resultX + PAD} y={y + 37} className="coh-form__note">
                      {fit(ok ? "quoted legs still required" : "ladder remains readable", boxW)}
                    </text>
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
