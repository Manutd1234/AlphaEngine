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
 * THE BANNER IS NEVER BEHIND A BUTTON, and that is the reason it is exported
 * separately from the score it stands over. The whole section turns on one
 * field a reader will not think to check — `engine` says WHEN the price was
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
 * of the sort. The caveat invalidates every view the settled corpus feeds, so
 * the parent draws this banner ABOVE the switcher and `median_horizon_s` —
 * zero, meaning the price was read AT settlement — is printed as the tell
 * rather than buried.
 *
 * WHERE THE CAVEAT IS SAID: ONCE, in the banner. It used to be said three
 * times — the banner, then again in the Brier cell's note, then again in the
 * skill cell's note, each in different words, so a reader met "these are not
 * forecasts" three times before reaching a number and could not tell whether
 * the three were one fact or three.
 *
 * REJECTED: dropping it from the banner and keeping it per-cell, which is the
 * arrangement that survives a reader who reads only the number they came for.
 * It loses the SHAPE of the claim — the caveat invalidates the whole score, not
 * two of its six rows.
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
    return "steeper than the diagonal — the favourite–longshot shape: longshots overbet, happening less often than their price says, favourites the reverse";
  }
  if (value < 0.98) {
    return "flatter than the diagonal — the reverse shape: the prices were more confident than the world turned out to be";
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
      note: "The share of the question's uncertainty these prices removed. Negative is worse than knowing nothing.",
    },
    {
      label: "Base rate",
      value: decimalLabel(data.base_rate),
      note: `How often YES happened across all ${data.count} settled markets.`,
    },
    {
      label: "Favourite–longshot slope",
      value: decimalLabel(data.bias_slope),
      note: `1 is perfect; here ${slopeReading(data.bias_slope, populated, data.bins.length)}.`,
    },
    {
      label: "Settled markets scored",
      value: String(data.count),
      note: `${populated} of ${data.bins.length} price bands carry at least one.`,
    },
    {
      label: "Median horizon",
      value: data.median_horizon_s == null ? "—" : `${data.median_horizon_s}s`,
      note: "How far ahead of the answer these prices were standing; the banner reads it.",
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

export function EngineBanner({ data }: { data: CoherenceCalibration }) {
  const convergence = data.engine === "final_trade";
  const forecast = data.engine === "tape";
  return (
    <section className={`coh-calib__engine ${convergence ? "is-warn" : forecast ? "is-good" : "is-muted"}`}>
      <h2 className="coh-calib__engine-head">
        <span aria-hidden="true">{convergence ? "▲" : forecast ? "✓" : "◌"}</span>{" "}
        {convergence
          ? "Not a forecast test — these are last traded prices"
          : forecast
            ? "A forecast test — prices quoted before the answer was known"
            : `Unrecognised engine: ${data.engine}`}
      </h2>
      {convergence ? (
        <p className="coh-calib__engine-body">
          A last trade lands moments before settlement, with the answer largely in plain sight, and{" "}
          {horizonText(data.median_horizon_s)}. So the Brier and skill below measure convergence
          speed, not foresight, and must not be quoted as evidence of it. The <code>tape</code> engine — prices an
          hour before close — asks the forecasting question.
        </p>
      ) : forecast ? (
        <p className="coh-calib__engine-body">
          Prices were read from the tape before close and scored against what settled, so{" "}
          {horizonText(data.median_horizon_s)}. A real forecast test: the score below is about foresight.
        </p>
      ) : (
        <p className="coh-calib__engine-body">
          This pane knows two engines — <code>tape</code>, a forecast test, and <code>final_trade</code>, which is
          not — and cannot tell which <code>{data.engine}</code> is, so nothing below reads as a forecast score
          until it can.
        </p>
      )}
    </section>
  );
}

export function ScoreView({ data, facts }: { data: CoherenceCalibration; facts: Fact[] }) {
  return (
    <>
      {/* The reader's third review, 2026-08-24: every view draws its numbers.
          The four score-like figures share the nought-to-one axis honestly —
          position IS the reading, with the dashed rule at one — while the two
          counts decline their bars: a count of markets and a time in seconds
          are not lengths on this axis. */}
      <ValueStrip
        caption="The score-like figures on one axis, nought to the dashed rule at one"
        ariaLabel="Brier, skill, base rate and slope on one axis; the two counts are printed, not drawn"
        rows={scoreRows(data, facts)}
        mark={{ at: 1, label: "1" }}
      />
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            The six headline figures, truncated at {PLACES} places, never rounded. The banner above says which
            are forecast scores.
          </caption>
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <th scope="col" className="num">Value</th>
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

      <details className="disclosure">
        <summary>What the Brier decomposes into: reliability, resolution and uncertainty</summary>
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
      </details>
    </>
  );
}
