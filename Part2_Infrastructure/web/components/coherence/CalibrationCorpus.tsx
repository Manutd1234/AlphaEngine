"use client";

/**
 * What was scored, and what that leaves out.
 *
 * Split out of `CalibrationPane` with `CalibrationBands` on 2026-08-24, for the
 * same reason: the pane crossed the 400-line ceiling and the ceiling's rule is
 * to split rather than shave.
 *
 * This view is disclosure, not analysis. A corpus is not a random sample of
 * forecasts — it is whatever the watched series happened to settle over the
 * recorded window — so when one ticker is most of it, every figure on the Score
 * view is mostly a score of that ticker, and a reader who cannot see the mixture
 * cannot know that.
 *
 * Two denominators are deliberately kept apart. The shares divide by the
 * COMPOSITION total, which need not equal the scored count, so the caption names
 * which number it is dividing by. And the per-series slope is a dash, never the
 * corpus figure standing in: the aggregate averages series that are not the same
 * question, so two of them can point opposite ways and still sit at one
 * together.
 */

import { pct } from "@/lib/format";
import type { CoherenceCalibration } from "@/lib/coherence/types-lab";

import ValueStrip from "./ValueStrip";

export default function CalibrationCorpus({ data }: { data: CoherenceCalibration }) {
  const corpus = data.composition.reduce((sum, row) => sum + row.count, 0);
  const heaviest = data.composition.reduce<{ series_ticker: string; count: number } | null>(
    (carry, row) => (carry == null || row.count > carry.count ? row : carry),
    null,
  );

  return (
    <>
      <section className="coh-calib__composition">
        {/* No heading here. It read "What was scored, and what that leaves
            out", which is the view's own name on the switcher and this file's
            first line — and the two peer views, Score and Bands, draw none.
            The strip's caption says what is being counted. */}
        {data.composition.length ? (
          <>
          {/* The mixture drawn (third review, 2026-08-24): the whole point of
              this view is that one bar is most of the picture. */}
          <ValueStrip
            caption="How much of the corpus each series is"
            ariaLabel={`Settled markets per series across ${data.composition.length} series`}
            rows={data.composition.map((row) => ({
              label: row.series_ticker,
              value: row.count,
              text: corpus > 0 ? `${row.count} (${pct(row.count / corpus)})` : String(row.count),
              title: `${row.series_ticker}: ${row.count} of the ${corpus} settled markets in the composition`,
            }))}
          />
          {/* THE FINDING STAYS OPEN, THE ROWS GO BEHIND A SUMMARY (fourth
              review of 2026-08-24). It used to be one caption carrying both,
              which meant a reader met the mixture claim only if they read a
              table's caption — and the whole point of the view is that one
              series is usually most of the picture, which the strip above now
              draws. What is behind the summary is the per-series detail: the
              exact share and the series' own slope, one row each. */}
          <p className="coh-event__note">
            {`${corpus} of the ${data.count} scored markets say which series they came from — not a random sample, so every figure on Score scores THIS mixture.`}
            {heaviest && corpus > 0
              ? ` ${heaviest.series_ticker} alone is ${heaviest.count} of ${corpus} (${pct(heaviest.count / corpus)}).`
              : ""}
          </p>

          <details className="disclosure">
            <summary>{`Every series in the corpus, its share and its own slope, ${data.composition.length} rows`}</summary>
          <div className="table-wrap">
            <table className="coh-table">
              <caption className="coh-table__caption">
                Shares divide by the {corpus} in this composition, not the {data.count} scored. A series with no
                slope of its own shows a dash; the corpus figure never stands in for it, because the aggregate
                averages series that are not the same question.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Series</th>
                  <th scope="col" className="num">Settled markets</th>
                  <th scope="col" className="num">Share of the corpus</th>
                  <th scope="col" className="num">Its own slope</th>
                </tr>
              </thead>
              <tbody>
                {data.composition.map((row) => {
                  const own = (data.bias_by_series ?? []).find(
                    (item) => item.series_ticker === row.series_ticker,
                  );
                  return (
                    <tr key={row.series_ticker}>
                      <th scope="row">{row.series_ticker}</th>
                      <td className="num">{row.count}</td>
                      <td className="num">{corpus > 0 ? pct(row.count / corpus) : "—"}</td>
                      <td className="num">{own ? own.slope.slice(0, 6) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </details>
          </>
        ) : (
          <p className="coh-event__note">
            <span aria-hidden="true">◌</span> The engine did not say which series these came from, so the selection
            behind the score cannot be checked from here.
          </p>
        )}
      </section>

      <h3 className="research-subhead">The engine&rsquo;s own account of this run</h3>
      <p className="coh-event__note">
        <span aria-hidden="true">◌</span> {data.detail}
      </p>
    </>
  );
}
