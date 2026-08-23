"use client";

/**
 * Murphy's decomposition, drawn as the arithmetic it is.
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
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { decimalLabel, statValue } from "./ReliabilityDiagram";

const HEIGHT = 200;
const MARGIN = { top: 16, right: 8, bottom: 44, left: 8 };
const FLOOR_PX = 2;
const PLACES = 8;

interface Term {
  key: string;
  name: string;
  sign: 1 | -1;
  raw: string | null;
  direction: string;
  meaning: string;
}

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
  const terms: Term[] = [
    {
      key: "reliability",
      name: "Reliability",
      sign: 1,
      raw: reliability,
      direction: "lower is better, and zero is perfect",
      meaning:
        "The mean squared gap between what a band was priced at and how often it happened. It is the only term a recalibration can repair, because it is the only one that is a property of the prices rather than of the questions.",
    },
    {
      key: "resolution",
      name: "Resolution",
      sign: -1,
      raw: resolution,
      direction: "higher is better, and it enters with a minus sign",
      meaning:
        "How far the bands' outcome rates spread away from the base rate — how much the prices discriminated at all. Quote the base rate on everything and this term is zero: perfectly reliable, and worth nothing. It is the only term that notices.",
    },
    {
      key: "uncertainty",
      name: "Uncertainty",
      sign: 1,
      raw: uncertainty,
      direction: "not a score, it belongs to the questions",
      meaning:
        "base × (1 − base). Nothing the exchange does changes it, and it is why a raw Brier score cannot be carried from one corpus to another: an easier set of questions produces a smaller number for free.",
    },
    {
      key: "binning",
      name: "Binning",
      sign: 1,
      raw: binning,
      direction: "smaller with finer bands",
      meaning:
        `The residue of grouping a continuum of prices into ${bandCount} bands. Textbooks drop it; without it the four terms do not add to the Brier score, and the identity above is simply false.`,
    },
  ];

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
            ? `${missingTerms.join(", ")} could not be computed, so the identity cannot be closed. The remaining terms are not drawn on their own: four bars that do not add up to the fifth would look like an answer.`
            : "The Brier score itself is not available, so there is no total for the terms to reconstruct."
        }
      >
        <FigureEmpty reason="A term of the decomposition is missing — the identity is not drawn half-closed." />
      </Figure>
    );
  }

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
  const floorNote = floored.length
    ? `${flooredNames} would stand under ${FLOOR_PX} pixels tall beside Uncertainty and ${floored.length === 1 ? "is" : "are"} drawn at a ${FLOOR_PX}-pixel floor instead, so ${floored.length === 1 ? "it is" : "they are"} visible at all. Read the number printed under ${floored.length === 1 ? "that bar" : "those bars"}, not the height.`
    : null;

  const identity = `${decimalLabel(reliability, PLACES)} − ${decimalLabel(resolution, PLACES)} + ${decimalLabel(
    uncertainty,
    PLACES,
  )} + ${decimalLabel(binning, PLACES)} = ${decimalLabel(brier, PLACES)}`;

  return (
    <div className="coh-calib__murphy">
      <Figure
        caption="Brier = Reliability − Resolution + Uncertainty + Binning, reconstructed"
        ariaLabel={`A waterfall of four terms landing on a Brier score of ${decimalLabel(brier, PLACES)}; resolution subtracts, the other three add`}
        reading={`${identity}. Each bar starts where the previous one ended, and the four terms close on the Brier score to the last of the engine's twenty-eight significant digits. Resolution is the only one that goes down, which is the sign to keep hold of: more resolution is a better score, and it is the one term a forecaster who always quotes the base rate cannot earn.`}
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
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y(0)}
                  y2={y(0)}
                  className="coh-calib__zero"
                />
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
                      <title>{`${bar.name}: ${decimalLabel(bar.raw, PLACES)}`}</title>
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
                        {decimalLabel(bar.raw, PLACES)}
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }}
        </Plot>
      </Figure>

      <dl className="coh-calib__terms">
        {terms.map((term, index) => (
          <div key={term.key}>
            <dt>
              <span className="coh-calib__term-sign" aria-hidden="true">
                {term.sign < 0 ? "−" : "+"}
              </span>
              {term.name}
              <span className="coh-calib__term-dir">{term.direction}</span>
            </dt>
            <dd>
              <b>{decimalLabel(term.raw, PLACES)}</b> {term.meaning}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
