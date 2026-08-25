"use client";

/**
 * WHEN the price was read, drawn on the axis that decides what the score means.
 *
 * WHAT THIS REPLACES. The Scorecard's engine caveat was a three-branch
 * PARAGRAPH standing over every figure in the section — the longest prose
 * object on the tab, and the first thing a reader met on its default view. It
 * had to be there: the whole half turns on one field a reader will not think to
 * check, and `engine` says when the price was read. But the fact it was making
 * is a POSITION ON A CLOCK, and a position on a clock is a picture.
 *
 *  - `tape` reads a price quoted about an hour before close and scores it
 *    against what happened. That is a forecast test.
 *  - `final_trade` reads the LAST TRADED price. A last trade lands moments
 *    before settlement, when the answer is largely in plain sight, so the score
 *    measures how fast this exchange converges on something already visible —
 *    not whether it saw anything coming. On the live sample it returns a skill
 *    of 0.99935238, which reads as a spectacular forecaster and is nothing of
 *    the sort.
 *
 * So the caveat is now the axis: the mark sits where the median price was read,
 * the near-settlement region is tinted AND named, and the verdict rides in the
 * plot as a mark and a word. `median_horizon_s` — zero, meaning the price was
 * read AT settlement — is the tell, and it is the mark's own position rather
 * than a number in a sentence.
 *
 * SAID ONCE, STILL. `CalibrationScore`'s header records that this caveat was
 * once said three times — banner, Brier note, skill note — so a reader could not
 * tell whether they were reading one fact or three. This is the one place. The
 * gauge beside it carries only the conclusion it has to carry, because a reader
 * can arrive at a needle without having met this figure.
 *
 * THE AXIS IS SECONDS BEFORE CLOSE AND IT IS CLAMPED, NOT SCALED. A horizon can
 * be zero or it can be a day; an axis fitted to the value would draw
 * `final_trade`'s zero and `tape`'s hour at the same place on different reads
 * and the two would be incomparable across engines. The span is fixed at an
 * hour — the horizon `tape` is built around — and widened only when the median
 * exceeds it, so the LINE is the thing with a known size and the mark is read
 * against it.
 *
 * It fetches nothing: `engine` and `median_horizon_s` are on the calibration
 * payload the section already read.
 */

import type { CoherenceCalibration } from "@/lib/coherence/types-lab";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import Figure, { Plot } from "./Figure";

const HEIGHT = 116;
const AXIS_Y = 64;
const ZONE_Y = 20;
const NOTE_Y = 38;
const MARK_H = 11;

/** The horizon `tape` is built around, and this axis's reference line. */
const HOUR_S = 3600;
/**
 * Inside this many seconds of close, the answer is largely in plain sight.
 *
 * Five minutes rather than a derived figure, and it is a JUDGEMENT rather than
 * a measurement — so it is named here, drawn as a region with a word on it, and
 * never used to decide anything. What decides the verdict is `engine`, which
 * the gateway states; this region only says why `final_trade`'s mark sits where
 * it does.
 */
const NEAR_S = 300;

interface Verdict {
  mark: string;
  word: string;
  reading: string;
}

/** What the engine allows this score to be called. Stated by the wire, never inferred. */
export function horizonVerdict(engine: string): Verdict {
  if (engine === "final_trade") {
    return {
      mark: "▲",
      word: "Not a forecast test",
      reading:
        "These are last traded prices, so the score below measures convergence speed and must not be quoted as "
        + "evidence of foresight. The tape engine asks the forecasting question.",
    };
  }
  if (engine === "tape") {
    return {
      mark: "✓",
      word: "A forecast test",
      reading: "Prices were read from the tape before close and scored against what settled, so the score below is about foresight.",
    };
  }
  return {
    mark: "◌",
    word: `Unrecognised engine: ${engine}`,
    reading: "This pane knows two engines and cannot tell which this is, so nothing below reads as a forecast score until it can.",
  };
}

export default function HorizonAxis({ data }: { data: CoherenceCalibration }) {
  const verdict = horizonVerdict(data.engine);
  const seconds = data.median_horizon_s;
  // GEOMETRY ONLY, and said because it reads exactly like the coercion this
  // codebase is most alert to. A null horizon is NOT drawn as zero seconds: the
  // mark is withheld entirely below and `missing` says the engine did not record
  // one. This `?? 0` only decides how wide the axis is, and `Math.max` makes it
  // the default hour — the same span an unrecorded horizon would get from any
  // other arm. A peer found the real version of this bug in `StatusPane`'s
  // `count()`, where a null budget printed "0 tokens per second" and a working
  // engine read as a stopped one.
  const span = Math.max(HOUR_S, (seconds ?? 0) * 1.2);

  return (
    <Figure
      caption="When the median price was read, against the hour a forecast test needs"
      ariaLabel={
        `${verdict.word}. The median price was read ${seconds == null ? "at a time the engine did not record" : `${seconds}s`} `
        + `before close, on an axis running from settlement to ${Math.round(span / 60)} minutes before it.`
      }
      reading={verdict.reading}
      missing={
        seconds == null
          ? "No mark: the engine did not record a median horizon, so where these prices stood in time is unknown."
          : null
      }
      notes={[
        "The tinted region is a judgement, not a measurement: inside about five minutes of settlement an outcome is "
        + "usually in plain sight. What decides the verdict above is the engine the gateway names, never this region.",
        "One horizon for the whole corpus. It is the MEDIAN, so half the scored markets were read closer to "
        + "settlement than the mark and half further out.",
      ]}
    >
      <Plot height={HEIGHT}>
        {(width) => {
          const pad = 16;
          const track = Math.max(40, width - pad * 2);
          // Settlement at the RIGHT, so time runs left to right the way a
          // reader reads it: the further left, the further ahead of the answer
          // the price was standing.
          const x = (s: number) => pad + (1 - Math.min(s, span) / span) * track;
          const nearX = x(NEAR_S);
          const hourX = x(HOUR_S);
          const label = seconds == null ? null : `median ${seconds}s before close`;
          const labelW = label == null ? 0 : advancePx(label, DIAGRAM_LABEL_PX);
          const markX = seconds == null ? 0 : x(seconds);
          const labelX = Math.min(Math.max(markX, pad + labelW / 2), width - pad - labelW / 2);

          return (
            <>
              {/* The region where the answer is largely visible already, named
                  in words as well as tinted — a wash that carries meaning alone
                  is the one thing this desk does not allow. */}
              <rect
                x={nearX} y={AXIS_Y - 20} width={Math.max(0, width - pad - nearX)} height={40}
                className="coh-horizon__near"
              />
              <text x={pad} y={ZONE_Y} className="coh-margin__zone">
                ✓ before the answer was known
              </text>
              <text x={width - pad} y={ZONE_Y} textAnchor="end" className="coh-margin__zone">
                the answer is in plain sight ▲
              </text>
              <text x={pad} y={NOTE_Y} className="coh-svg-note">
                {verdict.mark} {verdict.word}
              </text>

              <line x1={pad} x2={width - pad} y1={AXIS_Y} y2={AXIS_Y} className="coh-ladder__axis" />

              <line x1={hourX} x2={hourX} y1={AXIS_Y - 14} y2={AXIS_Y + 14} className="coh-margin__line">
                <title>An hour before close — the horizon the tape engine is built around.</title>
              </line>
              <text x={hourX} y={AXIS_Y + 28} textAnchor="middle" className="coh-combo__axis">1h</text>

              <line x1={x(0)} x2={x(0)} y1={AXIS_Y - 14} y2={AXIS_Y + 14} className="coh-margin__zero">
                <title>Settlement: the moment the answer is known.</title>
              </line>
              <text x={x(0)} y={AXIS_Y + 28} textAnchor="end" className="coh-combo__axis">0</text>

              {seconds == null ? null : (
                <>
                  {/* A MARK, never a bar: `final_trade`'s horizon is zero, and a
                      bar of no length reads as a bar that failed to draw. */}
                  <polygon
                    className={`coh-margin__mark${seconds <= NEAR_S ? " is-tradable" : ""}`}
                    points={`${markX},${AXIS_Y} ${markX - MARK_H / 2},${AXIS_Y - MARK_H} ${markX + MARK_H / 2},${AXIS_Y - MARK_H}`}
                  >
                    <title>{`the median price was read ${seconds}s before close`}</title>
                  </polygon>
                  {/* BELOW the axis, not above it. Above, its baseline is
                      y=48 and the verdict note's is y=38 — ten pixels apart at
                      a 13px rung — so on the `tape` engine, whose mark sits at
                      the LEFT end of this axis, the two printed through each
                      other. `MarginAxis` records the same collision and solved
                      it by moving its zone labels to the ends; here the mark
                      can be at either end, so it is the value that moves. */}
                  <text x={labelX} y={AXIS_Y + 44} textAnchor="middle" className="coh-margin__value">
                    {label}
                  </text>
                </>
              )}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
