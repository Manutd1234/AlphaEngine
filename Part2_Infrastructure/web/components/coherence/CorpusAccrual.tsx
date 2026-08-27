"use client";

/**
 * Whether the corpus is filling, and when it crosses the lines that decide
 * what can be said about it.
 *
 * "Corpus is not working well when we are pulling the data." The gateway half
 * of that was a horizon constant that selected almost nothing and is fixed;
 * the desk half is that this view could say what the corpus IS and never what
 * it is BECOMING. On a cold recorder — which is every fresh deployment — a
 * reader saw a count, a `thin` flag and an engine word, and could not ask the
 * only question a cold recorder raises: is this filling, and when does it
 * cross?
 *
 * TWO LINES, BOTH THE GATEWAY'S OWN, drawn as numbers rather than as flags.
 * `MIN_TAPE_FORECASTS` is where the scorer stops falling back to last trades —
 * the line between a forecast test and a convergence test, which are not the
 * same measurement — and `THIN_CORPUS` is where the reliability term stops
 * being mostly noise. The desk has drawn both as flags since the Scorecard
 * existed, so a reader could see "thin" and not know whether the corpus was
 * five markets short or forty-five.
 *
 * A PROJECTION IS A CLAIM, and this one is made only where it is honest: the
 * recent runs must be non-decreasing AND actually growing. A corpus that has
 * scored the same count for eight runs is not accruing, and the figure says
 * that with the count that shows it — rather than fitting a line through noise
 * and printing a date, which is a coerced estimate wearing a calendar.
 *
 * A RUN THAT SCORED NOTHING IS A MARK ON THE FLOOR, never a gap: zero markets
 * is a measured zero — the recorder ran and nothing had settled — and a gap
 * would say the recorder did not run.
 *
 * PER-MARK TITLES, NOT A CROSSHAIR, and that is a decision rather than an
 * omission: runs are unevenly spaced, so a shared axis here would need the
 * `positions` primitive, and what a reader wants at a run is that run's own
 * count rather than every measure at once. The record of every measure beside
 * it is `CorpusHistory`, which does carry the crosshair.
 */

import Figure, { Plot } from "./Figure";
import { shortDate } from "@/lib/format";
import { MIN_TAPE_FORECASTS, THIN_CORPUS } from "@/lib/coherence/thresholds";
import type { CoherenceCalibrationHistory } from "@/lib/coherence/types-lab";

const HEIGHT = 188;
const MARGIN = { top: 18, right: 96, bottom: 30, left: 40 };
/** How many recent runs a projection may be drawn from. */
const WINDOW = 8;
const NS_PER_MS = 1_000_000;
const CAPTION = "How the settled corpus is accruing, against the two floors that decide what it can say";

/**
 * When the corpus reaches `THIN_CORPUS`, if the recent runs support saying so.
 *
 * Returns null on anything that is not a growing, non-decreasing run of
 * counts. The alternative — a least-squares line through a flat or bouncing
 * series — produces a date on every input, including the inputs where the
 * honest answer is that nothing is accruing.
 */
function projectionOf(points: readonly { ts: number; markets: number }[]): {
  at: number;
  from: { ts: number; markets: number };
  runs: number;
} | null {
  const recent = points.slice(-WINDOW);
  if (recent.length < 3) return null;
  const nonDecreasing = recent.every((point, index) => index === 0 || point.markets >= recent[index - 1].markets);
  if (!nonDecreasing) return null;
  const first = recent[0];
  const last = recent[recent.length - 1];
  const gained = last.markets - first.markets;
  const elapsed = last.ts - first.ts;
  if (gained <= 0 || elapsed <= 0 || last.markets >= THIN_CORPUS) return null;
  const perNs = gained / elapsed;
  return { at: last.ts + (THIN_CORPUS - last.markets) / perNs, from: last, runs: recent.length };
}

export default function CorpusAccrual({ data }: { data: CoherenceCalibrationHistory }) {
  const points = data.points.map((point) => ({
    ts: point.ts_ns,
    markets: point.markets,
    engine: point.engine,
    thin: point.thin,
  }));

  if (!points.length) {
    // A DRAWING ON A COLD RECORDER, because that is the read this figure exists
    // for: the two floors are the whole reading before a single run is in, and
    // a sentence saying "no runs yet" hides the two numbers a reader is
    // waiting on.
    return (
      <Figure
        caption={CAPTION}
        ariaLabel={`No run recorded yet, against floors of ${MIN_TAPE_FORECASTS} and ${THIN_CORPUS}`}
        reading={
          `No run has been recorded yet. The corpus needs ${MIN_TAPE_FORECASTS} tape forecasts before the scorer`
          + ` stops falling back to last trades, and ${THIN_CORPUS} settled markets before the reliability term`
          + " is more than noise."
        }
        missing={data.notes[0] ?? "The recorder has not scored anything yet."}
      >
        <Plot height={96}>
          {(width) => {
            const top = THIN_CORPUS * 1.15;
            const base = 96 - 26;
            const y = (count: number) => base - (count / top) * (base - 12);
            return (
              <>
                <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
                {[
                  { at: MIN_TAPE_FORECASTS, word: "tape preferred" },
                  { at: THIN_CORPUS, word: "not thin" },
                ].map((floor) => (
                  <g key={floor.word}>
                    <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(floor.at)} y2={y(floor.at)}
                          className="coh-accrual__floor" />
                    <text x={width - MARGIN.right + 6} y={y(floor.at) + 3} className="coh-accrual__floorword">
                      {`${floor.at} ${floor.word}`}
                    </text>
                  </g>
                ))}
                <text x={MARGIN.left} y={base + 16} className="coh-ladder__tick">0 runs recorded</text>
              </>
            );
          }}
        </Plot>
      </Figure>
    );
  }

  const counts = points.map((point) => point.markets);
  const highest = Math.max(THIN_CORPUS, ...counts);
  const top = highest * 1.15;
  const first = points[0].ts;
  const last = points[points.length - 1].ts;
  const projection = projectionOf(points);
  const span = Math.max(1, (projection ? Math.max(last, projection.at) : last) - first);
  const engines = [...new Set(points.map((point) => point.engine))];
  const latest = points[points.length - 1];
  const flat = points.slice(-WINDOW);
  const stuck = flat.length >= 3 && flat.every((point) => point.markets === flat[0].markets);

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `${points.length} runs, the latest scoring ${latest.markets} markets, against floors of `
        + `${MIN_TAPE_FORECASTS} and ${THIN_CORPUS}`
      }
      reading={
        latest.markets >= THIN_CORPUS
          ? `The corpus is over both floors: ${latest.markets} settled markets on the latest run, so the`
            + " reliability term is no longer scored on a handful."
          : projection
            ? `Accruing: the last ${projection.runs} runs put the corpus over ${THIN_CORPUS} at about`
              + ` ${shortDate(projection.at / NS_PER_MS)}, if it keeps the rate it has been keeping.`
            : stuck
              ? `Not accruing: the last ${flat.length} runs all scored ${flat[0].markets} markets, so there is no`
                + " rate to project and no date to give."
              : `Not accruing steadily: the last ${flat.length} runs go up and down, and a line through them would`
                + " be a date invented from noise."
      }
      missing={
        engines.length > 1
          ? `Two engines in this record (${engines.join(", ")}): a forecast test and a convergence test count`
            + " different things, so the counts either side of the change are not one series."
          : null
      }
      notes={[
        `${MIN_TAPE_FORECASTS} is where the scorer stops falling back to last trades — under it the number on the`
        + " Scorecard is a convergence test rather than a forecast test, which is a different measurement and not"
        + " a worse version of the same one.",
        `${THIN_CORPUS} is where the reliability term stops being mostly noise. Between the two floors the score`
        + " is a forecast test on a corpus too small to conclude much from, which is worth having and is not yet"
        + " evidence.",
        "A run that scored nothing is a mark on the floor, never a gap: zero markets is a measured zero — the"
        + " recorder ran and nothing had settled — and a gap would say the recorder did not run.",
      ]}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const base = HEIGHT - MARGIN.bottom;
          const plotW = width - MARGIN.left - MARGIN.right;
          const x = (ts: number) => MARGIN.left + ((ts - first) / span) * plotW;
          const y = (count: number) => base - (count / top) * (base - MARGIN.top);
          return (
            <>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} className="coh-ladder__axis" />
              {[
                { at: MIN_TAPE_FORECASTS, word: "tape preferred" },
                { at: THIN_CORPUS, word: "not thin" },
              ].map((floor) => (
                <g key={floor.word}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(floor.at)} y2={y(floor.at)}
                        className="coh-accrual__floor" />
                  <text x={width - MARGIN.right + 6} y={y(floor.at) + 3} className="coh-accrual__floorword">
                    {`${floor.at} ${floor.word}`}
                  </text>
                </g>
              ))}

              {/* The projection, dashed so it cannot be read as a measurement,
                  and drawn only where the runs support it. */}
              {projection ? (
                <>
                  <line
                    x1={x(projection.from.ts)}
                    x2={x(projection.at)}
                    y1={y(projection.from.markets)}
                    y2={y(THIN_CORPUS)}
                    className="coh-accrual__projection"
                  />
                  <text x={x(projection.at)} y={y(THIN_CORPUS) - 6} textAnchor="end" className="coh-accrual__floorword">
                    {`~${shortDate(projection.at / NS_PER_MS)}`}
                  </text>
                </>
              ) : null}

              {points.map((point, index) => (
                <g key={`${point.ts}-${index}`}>
                  <circle
                    cx={x(point.ts)}
                    cy={y(point.markets)}
                    r={3}
                    className={`coh-accrual__run${point.thin ? " is-thin" : ""}`}
                  />
                  <title>
                    {`Run ${index + 1} of ${points.length}, ${shortDate(point.ts / NS_PER_MS)}: `
                      + `${point.markets} settled markets scored`
                      + `${point.markets === 0 ? " — a measured zero, the recorder ran and nothing had settled" : ""}`
                      + `, ${point.engine}${point.thin ? ", thin" : ""}`}
                  </title>
                </g>
              ))}

              <text x={MARGIN.left} y={HEIGHT - 8} className="coh-ladder__tick">
                {shortDate(first / NS_PER_MS)}
              </text>
              <text x={MARGIN.left + plotW} y={HEIGHT - 8} textAnchor="end" className="coh-ladder__tick">
                {shortDate(last / NS_PER_MS)}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
