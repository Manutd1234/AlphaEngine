"use client";

/**
 * The reliability diagram, every price band as a row, and the correction.
 *
 * Split out of `CalibrationPane` on 2026-08-24, when the density pass turned the
 * six headline figures into a table and the pane crossed the 400-line ceiling.
 * The ceiling's own rule is to SPLIT rather than shave prose, and this view is
 * the natural seam: it is the only one of the three that is about the bands
 * rather than about the score, it needs three fields of the payload and nothing
 * else, and it holds no state.
 *
 * What it must keep saying, because no test guards it: a band with no settled
 * market has no outcome rate, and its cells are dashed rather than zeroed.
 * Nobody quoted there is a different fact from nothing happening there, and a
 * zero in that cell would read as "priced at a dime, never paid".
 *
 * ONE VIEW AGAIN, WITH THE TABLE BEHIND A DISCLOSURE. The second pass of
 * 2026-08-24 split this file in two — the pane handed down `diagram` or
 * `bands` — because the figure over the eleven-row table ran two screens and
 * they answer different questions: "what shape is the mispricing" against
 * "what happened in my band". The consolidation that evening folded the index
 * into this section, and at five views a sixth segment cost more than the
 * scroll did. So the diagram leads, the band table and the isotonic note sit
 * behind a `<details>` whose summary names both, and the reader who wants one
 * band opens one disclosure. Nothing was removed; the split's own reason — do
 * not stack two screens on a reader who came for one — is what the disclosure
 * now serves.
 *
 * The isotonic note stays with the TABLE because its step count is a fact
 * about the bands, and the diagram's own `reading` already names the step line
 * where it is drawn.
 */

import { priceLabel } from "@/lib/coherence/fixed-point";
import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import HorizonAxis from "./HorizonAxis";
import ReliabilityDiagram, { decimalLabel, statValue } from "./ReliabilityDiagram";
import ValueStrip from "./ValueStrip";

export default function CalibrationBands({
  data,
  horizonNote,
}: {
  data: CoherenceCalibration;
  /** When the prices on the x axis were read. The banner owns the caveat. */
  horizonNote: string;
}) {
  const populated = data.bins.filter((bin) => bin.count > 0).length;

  return (
    <>
      {/* THE ENGINE CAVEAT MOVED HERE ON 2026-08-26, from above every view in
          the section. It is a position on a clock — WHEN the prices on the x
          axis were read — and this is the view whose x axis they are. On Score
          it stood over a gauge and a decomposition that do not have an x axis
          to be caveated, and it was one of five figure frames on that view.

          The claim is unchanged and still made exactly once; `HorizonAxis`
          records why it may not be made twice. */}
      <HorizonAxis data={data} />

      <div className="coh-calib__figures">
        <ReliabilityDiagram
          bins={data.bins}
          map={data.isotonic_map}
          baseRate={data.base_rate}
          horizonNote={horizonNote}
        />
      </div>

      <details className="disclosure">
        <summary>Every price band as a row, and the isotonic correction</summary>
      {/* The band table's decisive column drawn (third review, 2026-08-24):
          outcome minus price, signed against zero. An empty band declines its
          bar — nobody quoting there is not a deviation of nought. */}
      <ValueStrip
        caption="Outcome minus price, band by band"
        ariaLabel={`Signed deviation for ${populated} of ${data.bins.length} price bands`}
        rows={data.bins.map((bin) => ({
          label: bin.label,
          value: statValue(bin.deviation),
          text: decimalLabel(bin.deviation),
          title: `${priceLabel(bin.low)} to ${priceLabel(bin.high)}: ${bin.count} settled, priced ${decimalLabel(bin.mean_forecast)}, happened ${decimalLabel(bin.outcome_rate)}`,
          noBar:
            bin.count === 0 ? "nobody quoted" : statValue(bin.deviation) == null ? "not computed" : undefined,
        }))}
      />
      {/* A SIBLING, not the figure's `notes` prop. `Figure` renders `notes`
          behind a "What this figure cannot say, N" disclosure — and this strip
          sits inside the fold above, so that made a dropdown inside a dropdown
          for a single sentence. Both branches of the ternary yielded exactly
          one note, so the inner fold was never anything but one line hidden
          behind two clicks. The fold above already names the isotonic
          correction; this is the sentence it promised. */}
      <p className="coh-event__note">
        {data.isotonic_map.length
          ? `${data.isotonic_map.length} isotonic step(s), non-decreasing by construction — a higher price `
            + "mapping to a lower probability would be incoherent in exactly the way this tab tests for. It "
            + "repairs the reliability term and nothing else."
          : "No isotonic correction was returned, so the diagram carries the raw bands only."}
      </p>
      <div className="table-wrap">
        <table className="coh-table">
          <caption className="coh-table__caption">
            Every price band. A band with no settled market has no outcome rate and is dashed, never zeroed.
          </caption>
          <thead>
            <tr>
              <th scope="col">Band</th>
              <th scope="col" className="num">Settled</th>
              <th scope="col" className="num">Mean price</th>
              <th scope="col" className="num">Happened</th>
              <th scope="col" className="num">Outcome minus price</th>
            </tr>
          </thead>
          <tbody>
            {data.bins.map((bin) => {
              const deviation = statValue(bin.deviation);
              return (
                <tr key={bin.label}>
                  <th scope="row">{`${priceLabel(bin.low)} to ${priceLabel(bin.high)}`}</th>
                  <td className="num">{bin.count}</td>
                  <td className="num">{decimalLabel(bin.mean_forecast)}</td>
                  <td className="num">{decimalLabel(bin.outcome_rate)}</td>
                  {/* THE "READING" COLUMN WENT ON 2026-08-25, all five
                      branches. Three of them — "happened more often than
                      priced", "less often", "priced exactly" — are the SIGN of
                      the cell immediately to their left, which is signed, and
                      which the strip above the table draws against zero. The
                      other two restated an empty `Settled` cell and a dashed
                      deviation, both of which the strip already declines a bar
                      for and names its reason under. Eleven rows of it. */}
                  <td className="num">{decimalLabel(bin.deviation)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* THE ISOTONIC NOTE MOVED INTO THE STRIP'S OWN FOLD on 2026-08-25. It
          was a free-standing paragraph at the foot of this disclosure, which is
          two folds deep for a claim about the bands drawn at the top of it —
          and its step count is a fact about those bands. Both branches are
          kept: "no correction was returned" is a different fact from a
          correction of no steps. */}
      </details>
    </>
  );
}
