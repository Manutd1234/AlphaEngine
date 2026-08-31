"use client";

/**
 * The coherence margin: what the programme concluded, on the axis it concluded it.
 *
 * WHAT THIS REPLACES, AND WHY. The Verdict view opened on four money rows —
 * gross edge, total fees, net edge, worst-case payoff — and on the common answer
 * all four are correctly `null`, so the headline figure of the headline view
 * rendered "— — not reported" four times. That was honest and it was useless:
 * the reader asked "the coherence test has nothing shown", and they were right.
 *
 * The four are correctly empty because every one of them describes a PORTFOLIO,
 * and a coherent family hands back no portfolio. What the solver actually
 * decided on is its own optimum — the most any portfolio of these quotes can
 * guarantee itself in the worst state. That number exists on every solve, it is
 * signed, and its sign IS the verdict. The gateway computed it, compared it to
 * a threshold and threw it away until 2026-08-25.
 *
 * THE AXIS IS SCALED TO THE THRESHOLD, NOT TO THE VALUE, and that is the whole
 * design. A coherent margin is a millionth of a dollar and an incoherent one can
 * be fifty dollars; one linear axis cannot show both, and an axis scaled to the
 * value alone would draw a coherent book's `-0.000001` as a bar reaching the
 * edge of the plot, which reads as an enormous something. So the span is a fixed
 * multiple of the decision threshold, widened only when the margin exceeds it.
 * The reader's question is not "how big is t*" — it is "which side of the line
 * is it on, and by how much of the line".
 *
 * A ZERO-LENGTH BAR IS NOT NOTHING. On a coherent family the margin sits ON the
 * rule, and a bar of no length is indistinguishable from a bar that failed to
 * draw. So the margin is a MARK — a filled triangle pointing at its own position
 * — and never a bar. The mark is always visible; where it sits is the reading.
 */

import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import { MEANINGFUL_EDGE } from "@/lib/coherence/thresholds";

/** The threshold as the exchange prints it — from its centicents, never a float's toFixed. */
const EDGE_LABEL = fromCenticents(Math.round(MEANINGFUL_EDGE * DOLLAR_CC)) as string;
import Figure, { Plot } from "./Figure";
import { DOLLAR_CC, fromCenticents } from "@/lib/coherence/fixed-point";

/** 108, from 96. The zone names sit on their own line above the value label;
 *  at 96 the two shared a band and collided wherever the mark was near the
 *  threshold, which is exactly where the mark is on the common answer. */
/** One string, not two: it was written out in both branches, so an edit to the
 *  drawn one would have left the absent one describing a different figure. */
const CAPTION = "What the programme could guarantee itself, against the line it is judged on";

const HEIGHT = 108;
const AXIS_Y = 64;
const ZONE_Y = 20;
const MARK_H = 11;

/** Parsed for GEOMETRY only. Every printed figure is the wire string itself. */
function toNumber(raw: string | null): number | null {
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export default function MarginAxis({
  margin,
  verdict,
  engine,
  pricedOut,
}: {
  /** The programme's optimum, as the wire sent it. Null from the closed form. */
  margin: string | null;
  verdict: string;
  /** Which engine answered. Decides WHY a margin is absent when one is. */
  engine: string;
  pricedOut: boolean;
}) {
  const value = toNumber(margin);

  if (value == null) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No margin was reported for this family."
        // THREE reasons a margin can be absent, and they are not
        // interchangeable. Branching on the verdict alone said "this came from
        // the closed-form checks" over a certificate whose own chip read
        // `engine: highs` — a false statement about which engine answered,
        // printed with confidence, in the one slot on this figure whose whole
        // job is to say why a measurement is missing. The third case is the one
        // that produced it: the linear programme DID run, and the gateway
        // serving this desk predates the field.
        missing={
          verdict === "untestable"
            ? "No margin: the programme did not reach an answer on this family, so there is no optimum to report."
            : engine === "closed_form"
              ? "No margin: this verdict came from the closed-form checks, which solve no programme and so have no optimum."
              : "No margin: the programme answered but this read did not carry its optimum — the gateway serving this desk is older than the field."
        }
      >
        <Plot height={HEIGHT}>{() => <g />}</Plot>
      </Figure>
    );
  }

  // Five thresholds either side unless the margin is wider, so the LINE is the
  // thing with a known size on screen and the mark is read against it.
  const span = Math.max(MEANINGFUL_EDGE * 5, Math.abs(value) * 1.25);
  const tradable = value > MEANINGFUL_EDGE;
  const checkpoints = [
    {
      at: 0,
      title: "Zero guarantee",
      rows: [
        { label: "Value", value: "0", raw: 0 },
        { label: "Meaning", value: "the signed programme margin changes side here" },
      ],
    },
    {
      at: MEANINGFUL_EDGE,
      title: "Decision line",
      rows: [
        { label: "Value", value: EDGE_LABEL, raw: MEANINGFUL_EDGE },
        { label: "Meaning", value: "the minimum edge expressible at the exchange precision" },
      ],
    },
    {
      at: value,
      title: "Programme optimum t*",
      rows: [
        { label: "Value", value: margin ?? "—", raw: value },
        { label: "Against line", value: tradable ? "above — no probability measure fits" : "at or below — a measure fits" },
        { label: "Verdict", value: verdict },
      ],
    },
  ].sort((left, right) => left.at - right.at);
  const layout = (width: number) => {
    const pad = 16;
    const mid = width / 2;
    const half = Math.max(40, width / 2 - pad);
    const x = (point: number) => mid + (Math.max(-span, Math.min(span, point)) / span) * half;
    return { pad, x };
  };

  return (
    <Figure
      caption={CAPTION}
      ariaLabel={
        `The programme's optimum is ${margin}. Anything above ${EDGE_LABEL} is a portfolio that pays `
        + `more than it costs in every state; this sits ${tradable ? "above" : "at or below"} it, so the prices `
        + `${tradable ? "admit no probability measure" : "admit one"}.`
      }
      reading={
        tradable
          ? `A portfolio clears the line by ${margin}, so no probability measure fits these quotes.`
          : `Nothing clears the line — the best guarantee available is ${margin}, so a consistent probability measure exists.`
      }
      notes={pricedOut
        ? ["The closed-form checks found a violation these quotes do not admit. The money rows below are its arithmetic; this axis is the programme's separate answer about what could be traded."]
        : null}
      readout={<span className="num">{`t* ${margin}; line ${EDGE_LABEL}`}</span>}
    >
      <Plot
        height={HEIGHT}
        sharedX={(width) => {
          const { x } = layout(width);
          const positions = checkpoints.map((checkpoint) => x(checkpoint.at));
          return {
            count: checkpoints.length,
            x0: positions[0],
            x1: positions[positions.length - 1],
            positions,
            read: (index) => ({ title: checkpoints[index].title, rows: checkpoints[index].rows }),
            width: 330,
            arriveAt: "first",
            pin: true,
          };
        }}
      >
        {(width) => {
          const { pad, x } = layout(width);
          const lineX = x(MEANINGFUL_EDGE);
          const label = `optimum ${margin}`;
          const labelW = advancePx(label, DIAGRAM_LABEL_PX);
          const labelX = Math.min(Math.max(x(value), pad + labelW / 2), width - pad - labelW / 2);

          return (
            <>
              {/* The half-plane where a Dutch book exists, named in words as
                  well as tinted — a wash that carries meaning alone is the one
                  thing this desk does not allow. */}
              <rect
                x={lineX} y={AXIS_Y - 20} width={Math.max(0, width - pad - lineX)} height={40}
                className="coh-margin__tradable"
              />
              {/* At the ENDS of the axis, not beside the line. Anchored to the
                  line they crowded each other and the value label wherever the
                  mark sat near the threshold — which is where it sits on every
                  coherent book, so the collision was the normal case. */}
              <text x={pad} y={ZONE_Y} className="coh-margin__zone">
                ● a probability measure fits
              </text>
              {/* NOT "wins in every state". That sentence is the tab's own
                  claim and `coherence-proof-claims.test.ts` holds it to two
                  places — the page description and Basket's lede — because a
                  claim made everywhere is a claim a reader stops reading. This
                  is an axis label, so it says what the axis measures: past this
                  line the programme found a portfolio whose worst state still
                  beats what it cost. */}
              <text x={width - pad} y={ZONE_Y} textAnchor="end" className="coh-margin__zone">
                a portfolio beats its own cost ▲
              </text>

              <line x1={pad} x2={width - pad} y1={AXIS_Y} y2={AXIS_Y} className="coh-ladder__axis" />
              <line x1={x(0)} x2={x(0)} y1={AXIS_Y - 14} y2={AXIS_Y + 14} className="coh-margin__zero" />
              <text x={x(0)} y={AXIS_Y + 28} textAnchor="middle" className="coh-combo__axis">0</text>

              <line x1={lineX} x2={lineX} y1={AXIS_Y - 14} y2={AXIS_Y + 14} className="coh-margin__line" />
              <text x={lineX} y={AXIS_Y + 28} textAnchor="middle" className="coh-combo__axis">
                {EDGE_LABEL}
              </text>

              {/* A MARK, never a bar: the coherent answer sits on the rule and a
                  bar of no length reads as a bar that failed to draw. */}
              <polygon
                className={`coh-margin__mark${tradable ? " is-tradable" : ""}`}
                points={`${x(value)},${AXIS_Y} ${x(value) - MARK_H / 2},${AXIS_Y - MARK_H} ${x(value) + MARK_H / 2},${AXIS_Y - MARK_H}`}
              />
              <text x={labelX} y={AXIS_Y - MARK_H - 5} textAnchor="middle" className="coh-margin__value">
                {label}
              </text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
