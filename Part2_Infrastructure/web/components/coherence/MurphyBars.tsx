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
 * The figure does not verify the identity: `_murphy` returns Binning as the
 * residue, so the terms reconstruct the score BY CONSTRUCTION. The printed
 * line is cut from the wire strings — truncated,
 * never rounded — at a depth read off those strings rather than fixed at eight
 * in advance, so the smallest term keeps significant digits instead of whatever
 * eight places happens to leave it.
 */
import { useState } from "react";
import Figure, { FigureEmpty, Plot } from "./Figure";
import { decimalLabel, statValue } from "@/lib/coherence/decimals";
// Term semantics live in murphy-terms; this file owns only drawing geometry.
import { murphyTerms, placesFor, ratioOf, type Term } from "./murphy-terms";
import MurphyScoreInstrument from "./MurphyScoreInstrument";
import MurphyTermTable from "./MurphyTermTable";
import styles from "./ProofsTargetInstruments.module.css";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 8, bottom: 44, left: 8 };
const INSET_HEIGHT = 176;
const INSET_MARGIN = { top: 18, right: 8, bottom: 44, left: 8 };
const INSET_PLOT = INSET_HEIGHT - INSET_MARGIN.top - INSET_MARGIN.bottom;
const FLOOR_PX = 2;
/** Under this, the inset draws nothing and says the term is too small to draw. */
const SUBPIXEL_PX = 1;

export default function MurphyBars({
  mode,
  brier,
  reliability,
  resolution,
  uncertainty,
  binning,
  bandCount,
}: {
  mode: "equation" | "components";
  brier: string | null;
  reliability: string | null;
  resolution: string | null;
  uncertainty: string | null;
  binning: string | null;
  bandCount: number;
}) {
  const [selectedTerm, setSelectedTerm] = useState(mode === "components" ? "resolution" : "brier");
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
  const scoreReadings = [
    ...terms.map((term) => ({
      key: term.key,
      label: `${term.sign < 0 ? "−" : "+"} ${term.name}`,
      value: cut(term.raw),
      equation: `${term.sign < 0 ? "Subtract" : "Add"} ${term.name}'s reported value ${cut(term.raw)} in B = Rel − Res + Unc + Bin`,
      interpretation: term.direction,
    })),
    {
      key: "brier",
      label: "= Brier",
      value: cut(brier),
      equation: identity,
      interpretation: "The signed decomposition closes to the reported score by construction.",
    },
  ];
  const activeReading = scoreReadings.find((reading) => reading.key === selectedTerm) ?? scoreReadings[0];

  // The inset: the same terms, with the one that belongs to the questions taken
  // out. Vertical like the waterfall on purpose — the scale then depends on the
  // fixed plot height rather than on the measured width, so a term too small to
  // draw can be named in `missing` instead of discovered at render time.
  const insetBars = terms
    .map((term, index) => ({ term, value: values[index] as number }))
    .filter((bar) => bar.term.key !== "uncertainty");
  const insetMax = Math.max(...insetBars.map((bar) => Math.abs(bar.value)));
  const insetThin =
    insetMax > 0
      ? insetBars.filter((bar) => bar.value !== 0 && (Math.abs(bar.value) / insetMax) * INSET_PLOT < SUBPIXEL_PX)
      : [];
  const biggest = insetBars.reduce((carry, bar) => (Math.abs(bar.value) > Math.abs(carry.value) ? bar : carry));
  const smallest = insetBars.reduce((carry, bar) => (Math.abs(bar.value) < Math.abs(carry.value) ? bar : carry));
  const thinNames = insetThin.map((bar) => bar.term.name).join(" and ");
  const insetReading =
    Math.abs(smallest.value) > 0
      ? `${biggest.term.name} ${cut(biggest.term.raw)} against ${smallest.term.name} ${cut(smallest.term.raw)} — about ${ratioOf(Math.abs(biggest.value), Math.abs(smallest.value))} to one, the comparison the waterfall cannot carry.`
      : `${smallest.term.name} is zero at every place the engine sent; ${biggest.term.name}, at ${cut(biggest.term.raw)}, is the largest of the three.`;
  const componentReading = `${insetReading} Uncertainty is excluded because it describes the question mix, not forecast quality.`;
  const componentMissing = insetThin.length
    ? `${thinNames} ${insetThin.length === 1 ? "is" : "are"} under one pixel; use the printed value.`
    : null;
  const floorNote = floored.length
    ? `${flooredNames} ${floored.length === 1 ? "is" : "are"} drawn at a ${FLOOR_PX}-pixel visibility floor; use the printed value.`
    : null;

  return (
    <div className={`coh-calib__murphy ${styles.workbench}`}>
      {mode === "equation" ? (
        <>
          <MurphyScoreInstrument readings={scoreReadings} selected={selectedTerm} onSelect={setSelectedTerm} />
          <Figure
            caption="How the five terms land on Brier"
            ariaLabel={`Four terms landing on a Brier of ${cut(brier)}; resolution subtracts, the rest add`}
            readout={`${activeReading.label} ${activeReading.value}`}
            reading={`${identity}. Bars are cumulative and values are truncated, never rounded.`}
            missing={floorNote}
          >
            <Plot
              height={HEIGHT}
              minWidth={560}
              scrollLabel="Murphy decomposition terms"
              onSelect={(index) => setSelectedTerm((current) => scoreReadings[index]?.key ?? current)}
            >
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
                    operator: step.term.sign < 0 ? "−" : "+",
                  })),
                  { key: "brier", name: "Brier", raw: brier, from: 0, to: total, kind: "is-total", operator: "=" },
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
                        <g
                          key={bar.key}
                          className={styles.selectableMark}
                          data-selected={bar.key === selectedTerm}
                          onPointerEnter={() => setSelectedTerm(bar.key)}
                        >
                          <title>{`${bar.operator} ${bar.name}: ${cut(bar.raw)}`}</title>
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
                            {`${bar.operator} ${bar.name}`}
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
        </>
      ) : (
        <>
          {insetMax > 0 ? (
            <Figure
              caption="Components at their own scale"
              ariaLabel={`Three bars scaled against each other: ${insetBars
                .map((bar) => `${bar.term.name} ${cut(bar.term.raw)}`)
                .join(", ")}${insetThin.length ? `; ${thinNames} too small to draw and named instead` : ""}`}
              readout={`${activeReading.label} ${activeReading.value}`}
              reading={componentReading}
              missing={componentMissing}
            >
              <Plot height={INSET_HEIGHT} minWidth={420} scrollLabel="Murphy inset terms" onSelect={(index) => setSelectedTerm((current) => insetBars[index]?.term.key ?? current)}>
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
                          <g key={bar.term.key} className={styles.selectableMark} data-selected={bar.term.key === selectedTerm} onPointerEnter={() => setSelectedTerm(bar.term.key)}>
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
          ) : (
            <Figure
              caption="Components at their own scale"
              ariaLabel="Reliability, Resolution and Binning are all zero"
              missing="All three are zero at every place the engine sent — a measurement, not a gap."
            >
              <FigureEmpty reason="Reliability, Resolution and Binning are all zero — nothing to scale them against." />
            </Figure>
          )}
          <MurphyTermTable terms={terms} places={places} />
        </>
      )}
    </div>
  );
}
