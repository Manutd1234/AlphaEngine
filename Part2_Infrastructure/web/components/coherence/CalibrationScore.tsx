"use client";

/**
 * The Scorecard's engine banner and its six headline figures.
 *
 * Split out of `CalibrationPane` on 2026-08-24, when the consolidation folded
 * the coherence index into this section and the pane went to five views. The
 * ceiling's own rule is to SPLIT rather than shave prose; the seam is the one
 * the section already had, since everything here is a pure render over a
 * payload the parent has already read.
 *
 * THE ENGINE CAVEAT LEFT THIS FILE ON 2026-08-25 and is `HorizonAxis`. It was
 * a three-branch paragraph exported from here as `EngineBanner`, and the fact
 * it was making is a POSITION ON A CLOCK, which is a picture. It is still
 * drawn above the switcher, never behind a button, and still said exactly once.
 * The reason it must exist at all is unchanged — the whole section turns on one
 * field a reader will not think to check, and `engine` says WHEN the price was
 * read:
 *
 *  - `tape` reads a price quoted an hour before close and scores it against
 *    what happened. That is a forecast test.
 *  - `final_trade` reads the LAST TRADED price. A last trade happens moments
 *    before settlement, when the answer is largely known already, so the score
 *    is a measurement of how fast this exchange converges on an answer that is
 *    in plain sight — not of whether it saw anything coming.
 *
 * On the live sample the second engine returns a Brier of 0.00010533 and a
 * skill of 0.99935238, which reads as a spectacular forecaster and is nothing
 * of the sort. The caveat invalidates every view the settled corpus feeds, and
 * `median_horizon_s` — zero, meaning the price was read AT settlement — is now
 * the mark's own position on that figure rather than a number in a sentence.
 *
 * WHERE THE CAVEAT IS SAID: ONCE. It used to be said three times — the banner,
 * then again in the Brier cell's note, then again in the skill cell's note,
 * each in different words, so a reader met "these are not forecasts" three
 * times before reaching a number and could not tell whether the three were one
 * fact or three. `horizonText` stays exported from here because the Bands view
 * needs the same sentence for its x axis.
 *
 * REJECTED: keeping it per-cell, which is the arrangement that survives a
 * reader who reads only the number they came for. It loses the SHAPE of the
 * claim — the caveat invalidates the whole score, not two of its six rows.
 *
 * THE DECOMPOSITION IS A DISCLOSURE, not a sixth segment. It was a view of its
 * own for part of 2026-08-24, split off because Score stacked a six-row table
 * over two figures and that ran two screens. Folding the index in put five
 * views on the seg, and a sixth would have made the switcher the loudest object
 * in the card — so Murphy's three terms sit under the table behind a
 * `<details>` that names them. The split's own reason still holds and the
 * disclosure is what serves it: a reader who came for the Brier meets the
 * Brier, and the one asking which term it decomposes into opens one summary.
 */

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import MurphyBars from "./MurphyBars";
import { decimalLabel, statValue } from "./ReliabilityDiagram";
import ValueStrip, { type StripRow } from "./ValueStrip";

const PLACES = 8;
/** A weighted least-squares line through two points is fitted, not measured. */
const SLOPE_MINIMUM_BANDS = 3;

export interface Fact {
  label: string;
  value: string;
  note: string;
}

export function horizonText(seconds: number | null): string {
  if (seconds == null) return "the horizon was not recorded";
  if (seconds === 0) return "the median price was read at settlement";
  if (seconds < 120) return `the median price was read ${seconds}s before close`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `the median price was read ${minutes} minutes before close`;
  return `the median price was read ${Math.round(minutes / 60)} hours before close`;
}

/** What a fitted slope says about the shape of the mispricing, in words. */
function slopeReading(slope: string | null, populated: number, bands: number): string {
  if (slope == null) {
    return populated < SLOPE_MINIMUM_BANDS
      ? `withheld: only ${populated} of ${bands} bands carry a settled market, and a line through fewer than ${SLOPE_MINIMUM_BANDS} points is a drawing, not a measurement`
      : "withheld by the engine; it is not being shown as one";
  }
  const value = statValue(slope);
  if (value == null) return "the engine sent a slope this pane could not read, so it is not shown";
  if (value > 1.02) {
    return "steeper than 1 — favourite–longshot bias: longshots overbet, favourites underbet";
  }
  if (value < 0.98) {
    return "flatter than 1 — the reverse: prices more confident than the world turned out to be";
  }
  return "indistinguishable from 1 at two decimals — the shape a well calibrated venue has";
}

/** The six headline figures, each with the one line that reads it. */
export function scoreFacts(data: CoherenceCalibration): Fact[] {
  const populated = data.bins.filter((bin) => bin.count > 0).length;
  return [
    {
      label: "Brier score",
      value: decimalLabel(data.brier, PLACES),
      note: "Mean squared error of price against outcome; lower is better.",
    },
    {
      label: "Skill against the base rate",
      value: decimalLabel(data.skill, PLACES),
      // No note. `CalibrationGauge` defines this scale in full — one is
      // perfect, zero is the base rate, below zero is worse than knowing
      // nothing — and it is drawn immediately above this table on the same
      // view. Said here it was the second of four tellings on one tab.
      note: "",
    },
    {
      label: "Base rate",
      value: decimalLabel(data.base_rate),
      // "across all N settled markets" is row five of this same table.
      note: "How often YES happened.",
    },
    {
      label: "Favourite–longshot slope",
      value: decimalLabel(data.bias_slope),
      note: `1 is perfect; here ${slopeReading(data.bias_slope, populated, data.bins.length)}.`,
    },
    {
      label: "Settled markets scored",
      value: String(data.count),
      // The band coverage is the Bands view's own eleven-row table, drawn as a
      // strip beside it. A count of populated bands under a count of markets
      // is two different questions sharing a row.
      note: "",
    },
    {
      label: "Median horizon",
      value: data.median_horizon_s == null ? "—" : `${data.median_horizon_s}s`,
      // "the banner reads it" was a pointer at something four lines up.
      note: "How far ahead of the answer these prices were standing.",
    },
  ];
}

/** The six headline figures as strip rows: four drawn, two printed. */
function scoreRows(data: CoherenceCalibration, facts: Fact[]): StripRow[] {
  const drawn: Array<[Fact, string | null]> = [
    [facts[0], data.brier],
    [facts[1], data.skill],
    [facts[2], data.base_rate],
    [facts[3], data.bias_slope],
  ];
  const rows: StripRow[] = drawn.map(([fact, raw]) => ({
    label: fact.label,
    value: statValue(raw),
    text: fact.value,
    title: `${fact.label}: ${fact.value}`,
    noBar: statValue(raw) == null ? "withheld" : undefined,
  }));
  for (const fact of [facts[4], facts[5]]) {
    rows.push({
      label: fact.label,
      value: null,
      text: fact.value,
      title: `${fact.label}: ${fact.value}`,
      noBar: fact.label === "Median horizon" ? "a time, not a score" : "a count, not a score",
    });
  }
  return rows;
}

export function ScoreView({ data, facts }: { data: CoherenceCalibration; facts: Fact[] }) {
  return (
    <>
      {/* THE SIX-ROW STRIP LEFT ON 2026-08-26, and its departure is the whole
          of "why am i scrolling so much for the score tab".

          It drew the same six quantities the table below prints, off the same
          `scoreFacts` call, four of them as bars on a nought-to-one axis and
          two of them declining a bar because a count of markets is not a length.
          So the view carried the score twice, once as a picture of itself: five
          `Figure` frames and a table where two figures and a table say more.

          The rule it was added under — every view draws its numbers — is
          satisfied by the two that remain, and satisfied better. The gauge is
          the verdict and the decomposition is what the headline number is MADE
          of; a strip of the numbers beside their own table is neither. */}
      {/* PROMOTED OUT OF A <details> ON 2026-08-25. The decomposition is not
          an aside about the Brier — it IS the Brier, split into the three
          things that make it: how far off the prices were (reliability), how
          much they moved with the outcome (resolution), and how hard the
          question was to begin with (uncertainty). A reader who sees only the
          score cannot tell a well-calibrated forecaster of hard questions from
          a badly-calibrated one of easy questions, and those are opposite
          judgements about the same number.

          `13-warm-bright-pass.css` states the test for what may be folded:
          hiding it must not change what someone believes about the desk. This
          failed that test — it was the one drawing on the view that changes
          what the headline number means. */}
      <div className="coh-calib__figures">
        <MurphyBars
          brier={data.brier}
          reliability={data.reliability}
          resolution={data.resolution}
          uncertainty={data.uncertainty}
          binning={data.binning}
          bandCount={data.bins.length}
        />
      </div>

      <div className="table-wrap">
        <table className="coh-table">
          {/* "The banner above says which are forecast scores" went on
              2026-08-25 — it was a pointer at something on the same screen, and
              the third time this view mentioned the banner. What is left is the
              fact the numbers themselves cannot carry: they are truncated, not
              rounded, so a figure that looks like a tie is not one. */}
          <caption className="coh-table__caption">
            The six headline figures, truncated at {PLACES} places, never rounded.
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" className="num">Value</th>
              {/* Kept, unlike the Bands table's "Reading" column, and the
                  difference is what the cells hold. That one restated the SIGN
                  of the number beside it, eleven times. These are definitions —
                  what a Brier score measures, why "untestable" is a skip — and
                  the rows whose notes DID restate their own figure now carry
                  none rather than the column being dropped from under the ones
                  that teach. */}
              <th scope="col">What it reads</th>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => (
              <tr key={fact.label}>
                <th scope="row">{fact.label}</th>
                <td className="num">{fact.value}</td>
                <td>{fact.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
