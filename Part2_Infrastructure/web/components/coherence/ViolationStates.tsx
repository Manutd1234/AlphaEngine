"use client";

/**
 * What the engine records about a violation, as the states it can be in.
 *
 * Every figure on this engine draws a MEASUREMENT. This one draws the machine
 * that produces them, because the curriculum teaches claims and the claims are
 * about objects a reader has never seen defined: an episode, its peak, its
 * half-life, its lifetime. Those four words appear across Diffusion, the
 * survival curve and the coherence index, and nothing on the tab said how they
 * relate.
 *
 * THE EDGE THAT EARNS THE FIGURE is the one on the right: an episode that is
 * STILL OPEN has no lifetime. `episodes.py` refuses to compute one — "reporting
 * the age of an open episode as its lifetime would truncate" — and the survival
 * curve is drawn from closed episodes only for the same reason: mixing bounds
 * with measurements pulls the curve down by exactly the long tail it exists to
 * show. That refusal is stated in two module headers and drawn nowhere, and it
 * is the single most load-bearing thing about how this engine counts.
 *
 * THE SECOND EDGE IS ALMOST AS EASY TO MISS: an episode can close by DECAYING,
 * halving on its way back, or by jumping straight to coherent. The second has no
 * half-life — `absorption.ts` returns null with "the dislocation never halved
 * before the episode closed" — and a reader who assumes every closed episode
 * contributes one would wonder why the counts disagree.
 *
 * IT READS NOTHING. The states and their transitions are structural: they are
 * what the recorder can write, not what it has written. Live counts would need
 * the episodes read, which belongs to Diffusion's own group and is gated there;
 * putting a second gate on the curriculum would make opening Lessons cost a call
 * to answer a question about vocabulary.
 *
 * Drawn with `FormationDiagram`'s classes — `coh-form__title`, `coh-form__note`,
 * `coh-form__arrow` — so it inherits the engine's diagram ladder and adds no
 * CSS. Every box and every edge carries its own `<title>`, which is the hover
 * line every mark on this tab carries.
 */

import Figure, { Plot } from "./Figure";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";

const HEIGHT = 210;

interface StateBox {
  id: string;
  title: string;
  note: string;
  noteLines: readonly [string, string];
  /** Fraction of the plot width, left edge. */
  at: number;
  row: 0 | 1;
  hover: string;
}

const BOXES: readonly StateBox[] = [
  {
    id: "coherent",
    title: "Coherent",
    note: "prices admit a measure",
    noteLines: ["prices admit", "a measure"],
    at: 0.0,
    row: 0,
    hover: "The state almost every family is in, almost all the time. It is recorded rather than assumed, because a silent engine and a coherent exchange look identical from outside.",
  },
  {
    id: "open",
    title: "Violation opens",
    note: "a Dutch book exists",
    noteLines: ["a Dutch book", "exists"],
    at: 0.26,
    row: 0,
    hover: "The poll at which the family stops admitting a probability measure, so a basket can be assembled that pays whatever settles. The episode's clock starts here.",
  },
  {
    id: "peak",
    title: "Peak distance",
    note: "the worst reading",
    noteLines: ["the worst", "reading"],
    at: 0.52,
    row: 0,
    hover: "The largest coherence-index distance recorded while the episode was open, with the net edge that went with it. Recorded because the WORST moment is what an executor would have had to reach.",
  },
  {
    id: "closed",
    title: "Closed",
    note: "lifetime recorded",
    noteLines: ["lifetime", "recorded"],
    at: 0.78,
    row: 0,
    hover: "The prices admit a measure again. Only now does the episode have a lifetime, and only closed episodes enter the survival curve.",
  },
  {
    id: "open-still",
    title: "Still open",
    note: "a lower bound, not a lifetime",
    noteLines: ["a lower bound", "not a lifetime"],
    at: 0.78,
    row: 1,
    hover: "An episode that has not closed has NO lifetime. Reporting its age as one would truncate the measurement, and mixing bounds with measurements pulls the survival curve down by exactly the long tail it exists to show.",
  },
];

interface Edge {
  from: string;
  to: string;
  label: string;
  hover: string;
}

const EDGES: readonly Edge[] = [
  { from: "coherent", to: "open", label: "a quote moves", hover: "Between two polls the family's prices stop admitting a probability measure." },
  { from: "open", to: "peak", label: "distance grows", hover: "Every poll while open records a distance; the largest is kept." },
  { from: "peak", to: "closed", label: "halves, then closes", hover: "A dislocation that decays through half its opening distance has a half-life. One that jumps straight to coherent does not, and the engine returns null with that reason rather than reading a decay off the final interval." },
];

export default function ViolationStates() {
  const find = (id: string) => BOXES.find((box) => box.id === id) as StateBox;
  const caption = "What the recorder can write about one violation, and when it refuses to write a lifetime";

  return (
    <Figure
      caption={caption}
      ariaLabel="A state diagram: coherent, violation opens, peak distance, and then either closed with a lifetime or still open with none"
      reading="An episode earns a lifetime only by closing."
      notes={[
        "That is why the survival curve is drawn from closed episodes alone, and why the median can be withheld "
        + "while episodes are plainly running: mixing bounds with measurements pulls the curve down by exactly the "
        + "long tail it exists to show.",
        "Structural rather than live — these are the states the recorder CAN write, not a count of what it has. "
        + "The counts are on Diffusion, where the episodes read is gated.",
      ]}
    >
      <Plot height={HEIGHT} minWidth={520} scrollLabel={caption}>
        {(width) => {
          // THE BOXES WERE 0.2 OF THE WIDTH ON A 0.26 PITCH, which leaves
          // 0.008 of the width — 5.76px at 720 — between one box and the next,
          // permanently, because both terms scale together. Each transition
          // label is 94 to 138px wide and was centred in that gap at the boxes'
          // own mid-height, so it sat inside them horizontally AND vertically;
          // and because the edges were emitted before the boxes, the opaque
          // rects painted over about ninety-five per cent of each one. Only the
          // ~6px slice showing through the gutter survived, which is why the
          // reader saw "e", "ce" and "he" floating between the boxes rather
          // than an overlap.
          //
          // Narrower boxes give the arrows a gap worth drawing, and the labels
          // move ABOVE the row entirely, where nothing can paint over them.
          const boxW = Math.max(88, width * 0.155);
          const boxH = 66;
          const span = width - boxW;
          const x = (box: StateBox) => box.at * span;
          const y = (box: StateBox) => (box.row === 0 ? 34 : 138);
          // The pitch between two label anchors. A label wider than this would
          // touch its neighbour, so it is DROPPED rather than overprinted or
          // truncated — the rule `axis-labels` already holds every axis to. The
          // fact is not lost: it is the edge's own <title>, which the readout
          // speaks on hover, focus and arrow key.
          const pitch = 0.26 * span;
          return (
        <>
          {EDGES.map((edge) => {
            const from = find(edge.from);
            const to = find(edge.to);
            const x1 = x(from) + boxW;
            const x2 = x(to);
            const yy = y(from) + boxH / 2;
            const fits = advancePx(edge.label, DIAGRAM_LABEL_PX) <= pitch - 8;
            return (
              // A `<g>`, not the `<line>` itself. Every rule for this class is a
              // DESCENDANT selector — `.coh-form__arrow line` — so putting the
              // class on the line matched nothing and the stroke fell back to
              // SVG's default of none. Measured in Chrome: four such lines on
              // this figure, every one `stroke: none`. They rendered as
              // literally nothing, which is why the boxes looked unconnected.
              <g key={`${edge.from}-${edge.to}`} className="coh-form__arrow">
                <line x1={x1} x2={x2} y1={yy} y2={yy}>
                  <title>{edge.hover}</title>
                </line>
                {fits ? (
                  <text x={(x1 + x2) / 2} y={18} textAnchor="middle" className="coh-form__note">
                    {edge.label}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* The branch: the same peak leads either to a closed episode with a
              lifetime, or to one that is still running and has none. Drawn as a
              fork rather than a fifth box in the row, because it is a CHOICE the
              world makes rather than a stage the episode passes through. */}
          <g className="coh-form__arrow">
            <line
              x1={x(find("peak")) + boxW}
              x2={x(find("open-still"))}
              y1={y(find("peak")) + boxH / 2}
              y2={y(find("open-still")) + boxH / 2}
            >
              <title>An episode that has not closed by the time the tape is read is still open, and has no lifetime.</title>
            </line>
          </g>

          {BOXES.map((box) => (
            <g key={box.id}>
              <rect
                x={x(box)}
                y={y(box)}
                width={boxW}
                height={boxH}
                rx={4}
                className={box.id === "open-still" ? "coh-states__box is-open" : "coh-states__box"}
              >
                <title>{box.hover}</title>
              </rect>
              <text x={x(box) + boxW / 2} y={y(box) + 20} textAnchor="middle" className="coh-form__title">
                {box.title}
              </text>
              <text x={x(box) + boxW / 2} y={y(box) + 39} textAnchor="middle" className="coh-form__note">
                <title>{box.note}</title>
                {box.noteLines.map((line, index) => (
                  <tspan key={line} x={x(box) + boxW / 2} dy={index === 0 ? 0 : 12}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          ))}
        </>
          );
        }}
      </Plot>
    </Figure>
  );
}
