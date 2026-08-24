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

import Figure from "./Figure";
import { useMeasuredWidth } from "@/components/chart-kit";

const HEIGHT = 210;

interface StateBox {
  id: string;
  title: string;
  note: string;
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
    at: 0.0,
    row: 0,
    hover: "The state almost every family is in, almost all the time. It is recorded rather than assumed, because a silent engine and a coherent exchange look identical from outside.",
  },
  {
    id: "open",
    title: "Violation opens",
    note: "a Dutch book exists",
    at: 0.26,
    row: 0,
    hover: "The poll at which the family stops admitting a probability measure, so a basket can be assembled that pays whatever settles. The episode's clock starts here.",
  },
  {
    id: "peak",
    title: "Peak distance",
    note: "the worst reading",
    at: 0.52,
    row: 0,
    hover: "The largest coherence-index distance recorded while the episode was open, with the net edge that went with it. Recorded because the WORST moment is what an executor would have had to reach.",
  },
  {
    id: "closed",
    title: "Closed",
    note: "lifetime recorded",
    at: 0.78,
    row: 0,
    hover: "The prices admit a measure again. Only now does the episode have a lifetime, and only closed episodes enter the survival curve.",
  },
  {
    id: "open-still",
    title: "Still open",
    note: "a lower bound, not a lifetime",
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
  const [plotRef, width] = useMeasuredWidth<HTMLDivElement>(720);

  const boxW = Math.max(96, width * 0.2);
  const boxH = 54;
  const x = (box: StateBox) => box.at * (width - boxW);
  const y = (box: StateBox) => (box.row === 0 ? 24 : 128);
  const find = (id: string) => BOXES.find((box) => box.id === id) as StateBox;

  return (
    <Figure
      caption="What the recorder can write about one violation, and when it refuses to write a lifetime"
      ariaLabel="A state diagram: coherent, violation opens, peak distance, and then either closed with a lifetime or still open with none"
      reading="An episode earns a lifetime only by closing. That is why the survival curve is drawn from closed episodes alone, and why the median can be withheld while episodes are plainly running."
      missing="Structural rather than live: these are the states the recorder CAN write, not a count of what it has. The counts are on Diffusion, where the episodes read is gated."
    >
      <div ref={plotRef} style={{ width: "100%" }}>
        <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT}>
          {EDGES.map((edge) => {
            const from = find(edge.from);
            const to = find(edge.to);
            const x1 = x(from) + boxW;
            const x2 = x(to);
            const yy = y(from) + boxH / 2;
            return (
              <g key={`${edge.from}-${edge.to}`}>
                <line x1={x1} x2={x2} y1={yy} y2={yy} className="coh-form__arrow">
                  <title>{edge.hover}</title>
                </line>
                <text x={(x1 + x2) / 2} y={yy - 6} textAnchor="middle" className="coh-form__note">
                  {edge.label}
                </text>
              </g>
            );
          })}

          {/* The branch: the same peak leads either to a closed episode with a
              lifetime, or to one that is still running and has none. Drawn as a
              fork rather than a fifth box in the row, because it is a CHOICE the
              world makes rather than a stage the episode passes through. */}
          <line
            x1={x(find("peak")) + boxW}
            x2={x(find("open-still"))}
            y1={y(find("peak")) + boxH / 2}
            y2={y(find("open-still")) + boxH / 2}
            className="coh-form__arrow"
          >
            <title>An episode that has not closed by the time the tape is read is still open, and has no lifetime.</title>
          </line>

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
              <text x={x(box) + boxW / 2} y={y(box) + 22} textAnchor="middle" className="coh-form__title">
                {box.title}
              </text>
              <text x={x(box) + boxW / 2} y={y(box) + 40} textAnchor="middle" className="coh-form__note">
                {box.note}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </Figure>
  );
}
