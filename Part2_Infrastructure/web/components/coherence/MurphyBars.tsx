"use client";

/**
 * Murphy's decomposition, drawn as the arithmetic it is — and then again with
 * the question's own term taken out, at whatever scale the rest have between
 * them.
 *
 *   Brier = Reliability − Resolution + Uncertainty + Binning
 *
 * A Brier score on its own is close to meaningless, and the reason is the third
 * term: Uncertainty is base(1 − base), a property of the QUESTION and not of
 * whoever priced it. Score a corpus of near-certainties and the number is small
 * because the questions were easy. That is why raw Brier scores do not compare
 * across corpora, and why this figure exists — it takes the score apart into
 * the piece a recalibration could repair (Reliability), the piece that says the
 * forecasts discriminated at all (Resolution), the piece that belongs to the
 * questions (Uncertainty), and the residue of chopping a continuum of prices
 * into ten bands (Binning).
 *
 * Drawn as a waterfall rather than four bars side by side, because side-by-side
 * bars would leave the reader to do the signed sum in their head — and the sign
 * is the part people get wrong. Resolution enters NEGATIVE: more of it makes
 * the score better, so a forecaster who quotes the base rate everywhere is
 * perfectly reliable, completely useless, and this is the only term that
 * notices.
 *
 * Binning is drawn even though textbooks omit it. Without it the identity is
 * simply false, and a figure that closes an equation by leaving out its
 * remainder is a figure that has decided the reader should not check.
 *
 * WHY THERE IS AN INSET. Uncertainty is the largest term by orders of
 * magnitude — around 0.16 on the converged corpus against a Brier of around
 * 0.0001 — so one scale that fits it computes Reliability, Binning and the
 * Brier bar itself at well under a pixel. Holding those at a two-pixel floor
 * and declaring the floor is honest, and still a chart whose bars are mostly
 * floor: a legend, not a measurement. The waterfall therefore keeps the whole
 * identity — dropping a term to flatter a drawing is the defect this tab
 * argues against — and an inset beneath it redraws the three terms that are
 * not Uncertainty against each other. One still under a pixel there is not
 * drawn at all and is named instead; flooring it twice would repeat the defect
 * one level down.
 *
 * WHAT THE CLOSURE IS NOT. This figure does not verify the identity and could
 * not usefully do so: `_murphy` in the gateway kernel returns Binning as
 * `brier - (reliability - resolution + uncertainty)`, so the four terms
 * reconstruct the score BY CONSTRUCTION and the number to read is the size of
 * that residue. The printed line is cut from the wire strings — truncated,
 * never rounded — at a depth read off those strings rather than fixed at eight
 * in advance, so the smallest term keeps significant digits instead of whatever
 * eight places happens to leave it.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { decimalLabel, statValue } from "@/lib/coherence/decimals";
// What each term IS — the glossary copy, the cut depth and the ratio helper —
// lives in murphy-terms.ts since 2026-08-24, when this file stood at 395
// against the 400-line ratchet. This file keeps what is about the DRAWING.
import { murphyTerms, placesFor, ratioOf, type Term } from "./murphy-terms";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 8, bottom: 44, left: 8 };
const INSET_HEIGHT = 176;
const INSET_MARGIN = { top: 18, right: 8, bottom: 44, left: 8 };
const INSET_PLOT = INSET_HEIGHT - INSET_MARGIN.top - INSET_MARGIN.bottom;
const FLOOR_PX = 2;
/** Under this, the inset draws nothing and says the term is too small to draw. */
const SUBPIXEL_PX = 1;

export default function MurphyBars({
  brier,
  reliability,
  resolution,
  uncertainty,
  binning,
  bandCount,
}: {
  brier: string | null;
  reliability: string | null;
  resolution: string | null;
  uncertainty: string | null;
  binning: string | null;
  bandCount: number;
}) {
  const terms: Term[] = murphyTerms(reliability, resolution, uncertainty, binning, bandCount);

  const values = terms.map((term) => statValue(term.raw));
  const total = statValue(brier);
  const missingTerms = terms.filter((_term, index) => values[index] == null).map((term) => term.name);

  if (total == null || missingTerms.length) {
    return (
      <Figure
        caption="Brier = Reliability − Resolution + Uncertainty + Binning"
        ariaLabel="The decomposition could not be drawn because a term is missing"
        missing={
          missingTerms.length
            ? `${missingTerms.join(", ")} could not be computed, so the identity cannot be closed; four bars that do not sum to the fifth would look like an answer.`
            : "The Brier score itself is not available, so there is no total for the terms to reconstruct."
        }
      >
        <FigureEmpty reason="A term of the decomposition is missing — the identity is not drawn half-closed." />
      </Figure>
    );
  }

  const places = placesFor([reliability, resolution, uncertainty, binning, brier]);
  const cut = (raw: string | null) => decimalLabel(raw, places);
  const steps = terms.map((term, index) => ({ term, delta: term.sign * (values[index] as number) }));
  const running: number[] = [];
  let cursor = 0;
  for (const step of steps) {
    running.push(cursor);
    cursor += step.delta;
  }
  const marks = [0, ...running, cursor, total];
  const low = Math.min(...marks);
  const high = Math.max(...marks);
  const span = high - low || 1;
  const columns = steps.length + 1;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;

  // The vertical scale does not depend on the measured width, so which bars are
  // too short to see can be worked out here and SAID, rather than left as a
  // drawing that quietly rounds two of its terms up to something visible.
  const floored = [
    ...steps.map((step) => ({ name: step.term.name, drawn: (Math.abs(step.delta) / span) * plotHeight })),
    { name: "Brier", drawn: (Math.abs(total) / span) * plotHeight },
  ].filter((bar) => bar.drawn < FLOOR_PX);
  const flooredNames = floored.map((bar) => bar.name).join(", ");

  const identity = `${cut(reliability)} − ${cut(resolution)} + ${cut(uncertainty)} + ${cut(binning)} = ${cut(brier)}`;

  // The inset: the same terms, with the one that belongs to the questions taken
  // out. Vertical like the waterfall on purpose — the scale then depends on the
  // fixed plot height rather than on the measured width, so a term too small to
  // draw can be named in `missing` instead of discovered at render time.
  const insetBars = terms
    .map((term, index) => ({ term, value: values[index] as number }))
    .filter((bar) => bar.term.key !== "uncertainty");
  const insetMax = Math.max(...insetBars.map((bar) => Math.abs(bar.value)));
  const uncertaintyValue = values[terms.findIndex((term) => term.key === "uncertainty")] as number;
  const insetThin =
    insetMax > 0
      ? insetBars.filter((bar) => bar.value !== 0 && (Math.abs(bar.value) / insetMax) * INSET_PLOT < SUBPIXEL_PX)
      : [];
  const biggest = insetBars.reduce((carry, bar) => (Math.abs(bar.value) > Math.abs(carry.value) ? bar : carry));
  const smallest = insetBars.reduce((carry, bar) => (Math.abs(bar.value) < Math.abs(carry.value) ? bar : carry));
  const thinNames = insetThin.map((bar) => bar.term.name).join(" and ");
  const insetMissing =
    `Uncertainty is out — not a score, the glossary says why` +
    (uncertaintyValue > 0 && Math.abs(smallest.value) > 0
      ? ` — and at ${cut(uncertainty)}, about ${ratioOf(uncertaintyValue, Math.abs(smallest.value))} times ${smallest.term.name}, it is what flattens the waterfall.`
      : `, at ${cut(uncertainty)}.`) +
    ` Nothing here sums to a Brier; the identity closes only above.` +
    (insetThin.length
      ? ` ${thinNames} ${insetThin.length === 1 ? "is" : "are"} under a pixel even here, so ${insetThin.length === 1 ? "it is" : "they are"} named, not floored twice.`
      : "");
  const insetReading =
    Math.abs(smallest.value) > 0
      ? `${biggest.term.name} ${cut(biggest.term.raw)} against ${smallest.term.name} ${cut(smallest.term.raw)} — about ${ratioOf(Math.abs(biggest.value), Math.abs(smallest.value))} to one, the comparison the waterfall cannot carry.`
      : `${smallest.term.name} is zero at every place the engine sent; ${biggest.term.name}, at ${cut(biggest.term.raw)}, is the largest of the three.`;

  /**
   * THE RATIO STAYS UNFOLDED even though the inset that draws it does not.
   *
   * What the inset ADDS to this waterfall is the comparison between the three
   * small terms; everything else it shows is printed above it. Folding the
   * drawing without carrying that sentence up would have hidden the one thing
   * it was for — which is the difference between folding an aside and folding a
   * finding.
   *
   * DECLARED HERE RATHER THAN WITH ITS SIBLINGS FIFTY LINES UP, because it now
   * cites `insetReading` and a `const` read before its declaration is a
   * temporal-dead-zone throw, not a hoist. Moving the note is the fix; moving
   * the reading would put it above the values it is computed from.
   */
  // THE INSET'S WITHHELD REASON RIDES HERE TOO, not on the inset. The inset is
  // folded, and a `missing=` inside a fold is drawn with a ◌ that a reader who
  // never opens the fold never sees — `summarised-coherence` refuses it. So
  // the sentence saying why Uncertainty is out sits on the figure that is open,
  // beside the ratio it explains.
  const floorNote = floored.length
    ? `${flooredNames} ${floored.length === 1 ? "is" : "are"} drawn at a ${FLOOR_PX}-pixel floor beside Uncertainty — read the printed number, not the height. ${insetReading} ${insetMissing}`
    : `${insetReading} ${insetMissing}`;

  return (
    <div className="coh-calib__murphy">
      <Figure
        caption="Brier = Reliability − Resolution + Uncertainty + Binning, reconstructed"
        ariaLabel={`Four terms landing on a Brier of ${cut(brier)}; resolution subtracts, the rest add`}
        reading={`${identity}. Bars are cumulative, truncated to ${places} places, never rounded; Binning is derived as Brier minus the other three, so the identity closes by construction and the drawing is for each term\u2019s SIZE.`}
        missing={floorNote}
      >
        <Plot height={HEIGHT}>
          {(width) => {
            const plotWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
            const columnWidth = plotWidth / columns;
            const barWidth = Math.max(6, columnWidth * 0.46);
            const y = (value: number) => MARGIN.top + ((high - value) / span) * plotHeight;
            const centre = (index: number) => MARGIN.left + columnWidth * (index + 0.5);
            const bars = [
              ...steps.map((step, index) => ({
                key: step.term.key,
                name: step.term.name,
                raw: step.term.raw,
                from: running[index],
                to: running[index] + step.delta,
                kind: step.delta < 0 ? "is-subtract" : "is-add",
              })),
              { key: "brier", name: "Brier", raw: brier, from: 0, to: total, kind: "is-total" },
            ];

            return (
              <>
                <line x1={MARGIN.left} x2={MARGIN.left + plotWidth} y1={y(0)} y2={y(0)} className="coh-calib__zero" />
                <text x={MARGIN.left} y={y(0) - 3} className="coh-calib__barlabel">
                  0
                </text>

                {bars.map((bar, index) => {
                  const drawn = Math.abs(y(bar.to) - y(bar.from));
                  const short = drawn < FLOOR_PX;
                  const height = short ? FLOOR_PX : drawn;
                  const yPos = short
                    ? bar.to > bar.from
                      ? y(bar.from) - FLOOR_PX
                      : y(bar.from)
                    : Math.min(y(bar.from), y(bar.to));
                  return (
                    <g key={bar.key}>
                      <title>{`${bar.name}: ${cut(bar.raw)}`}</title>
                      {index > 0 && index < bars.length - 1 ? (
                        <line
                          x1={centre(index - 1) + barWidth / 2}
                          x2={centre(index) - barWidth / 2}
                          y1={y(bar.from)}
                          y2={y(bar.from)}
                          className="coh-calib__connector"
                        />
                      ) : null}
                      <rect
                        x={centre(index) - barWidth / 2}
                        y={yPos}
                        width={barWidth}
                        height={height}
                        className={`coh-calib__bar ${bar.kind}${short ? " is-floored" : ""}`}
                      />
                      <text x={centre(index)} y={MARGIN.top + plotHeight + 14} textAnchor="middle" className="coh-calib__barlabel">
                        {bar.kind === "is-subtract" ? `− ${bar.name}` : bar.kind === "is-total" ? `= ${bar.name}` : `+ ${bar.name}`}
                      </text>
                      <text x={centre(index)} y={MARGIN.top + plotHeight + 27} textAnchor="middle" className="coh-calib__barvalue">
                        {cut(bar.raw)}
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      </Figure>

      {/* FOLDED SINCE 2026-08-26, and counted. "why am i scrolling so much for
          the score tab" — measured, this inset is about 340px of the Scorecard,
          and it only appears when the corpus is non-degenerate, so the section
          measured 943px on one poll and 1,548px on another with nothing
          changing but the data.

          It passes the fold test `13-warm-bright-pass.css` states — hiding it
          must not change what someone believes about the desk — because the
          waterfall above PRINTS all four terms with their values. What the
          inset adds is the RATIO between the three small ones, and that
          sentence moves up into the waterfall's own note rather than going
          behind the fold with the drawing.

          The summary says what is inside and names the comparison, so nobody
          opens it to find out whether it is worth opening. */}
      {insetMax > 0 ? (
        <details className="disclosure">
          <summary>{`The same three terms at their own scale, ${insetBars.length} of them, Uncertainty excluded`}</summary>
        <Figure
          caption="Inset — the same terms at their own scale, Uncertainty excluded"
          ariaLabel={`Three bars scaled against each other: ${insetBars
            .map((bar) => `${bar.term.name} ${cut(bar.term.raw)}`)
            .join(", ")}${insetThin.length ? `; ${thinNames} too small to draw and named instead` : ""}`}
          reading={insetReading}
        >
          <Plot height={INSET_HEIGHT}>
            {(width) => {
              const plotWidth = Math.max(120, width - INSET_MARGIN.left - INSET_MARGIN.right);
              const columnWidth = plotWidth / insetBars.length;
              const barWidth = Math.max(6, columnWidth * 0.34);
              const base = INSET_MARGIN.top + INSET_PLOT;
              const centre = (index: number) => INSET_MARGIN.left + columnWidth * (index + 0.5);
              return (
                <>
                  <line x1={INSET_MARGIN.left} x2={INSET_MARGIN.left + plotWidth} y1={base} y2={base} className="coh-calib__zero" />
                  <text x={INSET_MARGIN.left} y={INSET_MARGIN.top - 5} className="coh-calib__barlabel">
                    {`Scale runs 0 to ${cut(biggest.term.raw)}, Uncertainty excluded`}
                  </text>
                  {insetBars.map((bar, index) => {
                    const drawn = (Math.abs(bar.value) / insetMax) * INSET_PLOT;
                    const thin = bar.value !== 0 && drawn < SUBPIXEL_PX;
                    return (
                      <g key={bar.term.key}>
                        <title>{`${bar.term.name}: ${cut(bar.term.raw)}`}</title>
                        {bar.value !== 0 && !thin ? (
                          <rect
                            x={centre(index) - barWidth / 2}
                            y={base - drawn}
                            width={barWidth}
                            height={drawn}
                            className={`coh-calib__bar ${bar.term.sign < 0 ? "is-subtract" : "is-add"}`}
                          />
                        ) : (
                          <text x={centre(index)} y={base - 6} textAnchor="middle" className="coh-calib__barlabel">
                            {bar.value === 0 ? "exactly zero" : "under a pixel"}
                          </text>
                        )}
                        <text x={centre(index)} y={base + 14} textAnchor="middle" className="coh-calib__barlabel">
                          {bar.term.sign < 0 ? `− ${bar.term.name}` : `+ ${bar.term.name}`}
                        </text>
                        <text x={centre(index)} y={base + 27} textAnchor="middle" className="coh-calib__barvalue">
                          {cut(bar.term.raw)}
                        </text>
                      </g>
                    );
                  })}
                </>
              );
            }}
          </Plot>
        </Figure>
        </details>
      ) : (
        <Figure
          caption="Inset — the same terms at their own scale, Uncertainty excluded"
          ariaLabel="Reliability, Resolution and Binning are all zero"
          missing="All three are zero at every place the engine sent — a measurement, not a gap."
        >
          <FigureEmpty reason="Reliability, Resolution and Binning are all zero — nothing to scale them against." />
        </Figure>
      )}

      {/* FOLDED AND COUNTED, 2026-08-26. "why am i scrolling so much for the
          score tab" — and this glossary is four definitions standing open under
          two figures that already draw the four quantities and print their
          values. It is a reference: a reader consults it once and then knows
          what resolution means for the rest of the session.

          It passes the fold test `13-warm-bright-pass.css` states, which is
          that hiding a thing must not change what someone believes about the
          desk: every term's own figure carries its name, its sign and its value
          on the drawing, so what is behind the fold is the SENTENCE explaining
          each — not the measurement. The summary counts them, so nobody opens
          it to find out how big it is. */}
      <details className="disclosure">
        <summary>{`What each of the ${terms.length} terms means, and which way it is good`}</summary>
        <dl className="coh-calib__terms">
          {terms.map((term) => (
            <div key={term.key}>
              <dt>
                <span className="coh-calib__term-sign" aria-hidden="true">
                  {term.sign < 0 ? "−" : "+"}
                </span>
                {term.name}
                <span className="coh-calib__term-dir">{term.direction}</span>
              </dt>
              <dd>
                <b>{cut(term.raw)}</b> {term.meaning}
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
