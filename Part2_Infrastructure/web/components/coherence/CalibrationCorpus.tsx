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

import CorpusShares from "./CorpusShares";
import { decimalLabel } from "@/lib/coherence/decimals";

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
          {/* ONE FIGURE FOR TWO FACTS, 2026-08-26. Two `ValueStrip`s stood
              here — a share strip and a slope strip — over the same four
              labels, on two axes, with a reader asked to join them by name.
              "the information is too cluttered", and the clutter was that the
              two facts only mean anything TOGETHER: an aggregate slope sitting
              at one can be two series pointing opposite ways, which is the
              whole argument this view makes and neither strip could show.

              `CorpusShares` carries the slope as position against the rule at
              one and the share as bar HEIGHT, so a heavy mark far from the rule
              is the finding rather than something a reader assembles. The
              paragraph that restated the first strip's reading is that figure's
              own `reading` now — same sentence, one place. */}
          <CorpusShares data={data} />

          {/* THE FINDING STAYS OPEN, THE ROWS GO BEHIND A SUMMARY (fourth
              review of 2026-08-24). It used to be one caption carrying both,
              which meant a reader met the mixture claim only if they read a
              table's caption — and the whole point of the view is that one
              series is usually most of the picture, which the strip above now
              draws. What is behind the summary is the per-series detail: the
              exact share and the series' own slope, one row each. */}
          {/* THE FINDING MOVED INTO THE FIGURE. It was this paragraph AND the
              share strip's `reading` — the same sentence twice on one view, in
              two voices. `CorpusShares` says it once, under the drawing that
              makes it. */}

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
                      <td className="num">{own ? decimalLabel(own.slope, 4) : "—"}</td>
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

      {/* FOLDED 2026-08-25. `data.detail` is composed by the gateway, is not
          length-bounded by anything, and was rendered raw under a heading that
          gave it more rank than the two drawings above it. It is provenance —
          worth having, never the reading — so it goes where provenance goes.
          The empty case draws nothing rather than an empty paragraph under a
          heading, which is what the raw render did. */}
      {data.detail ? (
        <details className="disclosure">
          <summary>Where these numbers came from, in the engine&rsquo;s own words</summary>
          <p>{data.detail}</p>
        </details>
      ) : null}
    </>
  );
}
