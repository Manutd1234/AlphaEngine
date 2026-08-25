"use client";

/**
 * The proof, as the room every inequality has left.
 *
 * WHAT IT REPLACES AND WHY. The Proof view's only drawing was a two-row
 * `ValueStrip` of `rows_tested` against `rows_untestable` — on the family a
 * reader opens, 189 against 0. Two bars sharing one domain, the second floored
 * to 1px because `ValueStrip` never draws nothing, and excluded from that
 * strip's own floor note because the note deliberately skips exact zeros. So
 * the figure was a full-width bar, a hairline, and no sentence saying the
 * hairline was a floor: a picture of two numbers the certificate prints in
 * words a few pixels above it. "the proof subtab diagram is not interactive and
 * doesnt show any useful information."
 *
 * WHAT A PROOF OWES A READER is not how many rows were checked. It is how close
 * any of them came to failing. That is a quantity per constraint; sorted, it is
 * a curve whose left-hand end is the binding constraint and whose shape is how
 * much room the rest of the family had. It does not go flat when the answer is
 * the usual one, which is the failure mode every degenerate figure on this tab
 * shares.
 *
 * IT FETCHES NOTHING. Every field comes off the universe read the section is
 * already built from — `lib/coherence/constraints.ts` does the derivation, and
 * it is unit-tested against fixtures rather than against a screenshot.
 *
 * IT IS NOT THE PROGRAMME'S ROW SET, and the figure says so rather than
 * implying otherwise. The gateway solves over intervals on one side of the book
 * and reports `rows_untestable: 0`; this pairs quotes and needs both sides, so
 * on `KXBTCD-26AUG2514` it reads 31 tested and 344 skipped. Both are honest
 * about different questions. Printing one under the other's name would be the
 * defect, so the note carries both counts and names which is which.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { constraintsOf, type Constraint, type ConstraintKind } from "@/lib/coherence/constraints";
import { fromCenticents } from "@/lib/coherence/fixed-point";
import type { CoherenceCertificate, CoherenceEventView } from "@/lib/coherence/types";
import type { SharedX } from "@/lib/coherence/use-shared-x-readout";

const HEIGHT = 214;
const MARGIN = { top: 16, right: 16, bottom: 62, left: 54 };
/**
 * Past this many constraints a mark stops being a bar and becomes a rule.
 *
 * A FIGURE THAT HAS TO WORK AT FIVE AND AT EIGHTY-SEVEN. The live watchlist
 * carries both: a weather family evaluates 5 inequalities, and `KXBTCD-26AUG2817`
 * evaluates 87. At 87 a bar is eight pixels wide and the bars ARE the shape; at
 * 5 they are two hundred pixels apart, and drawn as rules they read as four
 * hairlines and an outline rather than as a measurement. Seen at a viewport —
 * the first version drew rules at every count and the five-constraint family
 * looked like an empty box.
 */
const DENSE_AT = 44;
/**
 * The shortest a mark may be drawn, and why it is not zero.
 *
 * Live range on `KXBTCD`: the tightest constraint has a cent of room and the
 * widest has forty-one, so a cent is a bar two pixels tall next to one a
 * hundred and forty tall — visible as a smudge on the axis and easy to read as
 * an empty slot. A floor makes the smallest one findable and pressable.
 *
 * IT IS A LIE ABOUT MAGNITUDE AND IS THEREFORE COUNTED. `ValueStrip` set this
 * precedent on this tab and then broke it by excluding exact zeros from its own
 * note — which is how a zero bar came to be a 1px hairline with nothing saying
 * so. Every floored mark here is counted into the figure's own footnote, zeros
 * included, because the mark a reader cannot measure is exactly the one that
 * has to say it cannot be measured.
 */
const FLOOR_PX = 3;
/** The rail under the axis, and the gap above it. */
const RAIL_Y = HEIGHT - 40;
const RAIL_H = 9;

const KIND_WORD: Record<ConstraintKind, string> = {
  book: "book spread",
  ladder: "ladder pair",
  partition: "partition sum",
};

const KIND_MEANING: Record<ConstraintKind, string> = {
  book: "one market's own offer against its own bid",
  ladder: "one strike's offer against the next strike's bid",
  partition: "every leg at once against the dollar the set pays",
};

/** A slack in dollars, or a dash. Never a coerced zero. */
function money(centicents: number | null): string {
  return fromCenticents(centicents) ?? "—";
}

/**
 * The x of one constraint, and the ONE expression that answers it.
 *
 * `Plot`'s shared axis positions its crosshair by dividing `[x0, x1]` evenly
 * across `count`, so a figure that draws its marks by any other arithmetic gets
 * a cursor that reads a position the drawing never used. That is not
 * hypothetical on this desk — a peer raised exactly this against the survival
 * ladder's even-division assumption the same day. Here the axis is a RANK, so
 * even division is not an assumption about the data at all; it is the drawing's
 * own definition, and both the marks and the axis read it from this function so
 * the two cannot drift apart.
 */
function xOf(index: number, count: number, x0: number, x1: number): number {
  return count <= 1 ? (x0 + x1) / 2 : x0 + ((x1 - x0) * index) / (count - 1);
}

function reading(constraint: Constraint): { title: string; rows: Array<{ label: string; value: string }> } {
  return {
    title: constraint.subject,
    rows: [
      { label: "Kind", value: KIND_WORD[constraint.kind] },
      { label: "Must hold", value: constraint.claim },
      { label: "Room left", value: money(constraint.slack) },
      { label: "Verdict", value: constraint.violated ? "✕ an arbitrage" : "● holds" },
    ],
  };
}

export default function ConstraintLadder({ event, certificate }: {
  /** The family whose quotes are being tested, off the universe read. */
  event: CoherenceEventView | null;
  /**
   * The gateway's own answer, for the counts the figure must not be mistaken
   * for. Null while the certificate is still being solved — the drawing does
   * not wait for it, because the quotes it draws are already here.
   */
  certificate: CoherenceCertificate | null;
}) {
  const set = event ? constraintsOf(event) : null;
  const tested = set?.tested ?? [];
  const count = tested.length;

  const skipped = set?.untestable ?? 0;
  const total = count + skipped;
  const missing = skipped
    ? `${skipped} of the ${total} inequalities could not be evaluated: ${set?.untestableReason}`
    : null;

  const notes = [
    `Each kind is a different claim: a ${KIND_WORD.book} is ${KIND_MEANING.book}; a `
    + `${KIND_WORD.ladder} is ${KIND_MEANING.ladder}; a ${KIND_WORD.partition} is `
    + `${KIND_MEANING.partition}. Only a family the venue marks mutually exclusive carries the last.`,
    certificate
      ? "The programme on the gateway counts differently and both counts are honest. It solves over "
        + `intervals on one side of the book and reports ${certificate.rows_tested} row(s) tested and `
        + `${certificate.rows_untestable} untestable; this pairs quotes and needs both sides of every `
        + "book it touches, which is why its skipped count is larger."
      : "The gateway's own row count is not in yet; these are the desk's own pairings from the quotes.",
    "Room is measured at the quotes as they stand, before fees. A constraint with a cent of room is "
    + "not tradable at a cent — the Fees section prices what taking it would cost.",
  ];

  if (!event) {
    return (
      <Figure
        caption="Every inequality these quotes must satisfy, and the room each one has left"
        ariaLabel="No family chosen, so no constraints are drawn"
      >
        <FigureEmpty reason="No family is chosen, so there are no quotes to test." />
      </Figure>
    );
  }

  if (!count) {
    return (
      <Figure
        caption="Every inequality these quotes must satisfy, and the room each one has left"
        ariaLabel={`No constraint could be evaluated for ${event.event_ticker}`}
        missing={missing}
      >
        <FigureEmpty
          reason={
            total
              ? `None of the ${total} inequalities could be evaluated: every one needs both sides of a book, and this family is quoted on one side.`
              : "This family lists no markets, so its quotes impose nothing on each other."
          }
        />
      </Figure>
    );
  }

  const slacks = tested.map((constraint) => constraint.slack);
  const lowest = Math.min(0, ...slacks);
  const highest = Math.max(0, ...slacks);
  // A domain that is never zero-height. A family whose every constraint has the
  // same room is a real reading, and it must not divide by nothing.
  const span = Math.max(highest - lowest, 100);
  const tightest = tested[0];

  // HOW MANY MARKS ARE DRAWN LONGER THAN THEY MEASURE. Computed here rather
  // than inside the render prop, because the note has to be handed to `Figure`
  // above the plot and the plot is what knows the pixels — so the arithmetic is
  // repeated once, deliberately, against the same span the drawing uses.
  const plotSpanPx = HEIGHT - MARGIN.bottom - MARGIN.top;
  const floored = slacks.filter((slack) => (Math.abs(slack) / span) * plotSpanPx < FLOOR_PX).length;
  if (floored) {
    notes.push(
      `${floored} of the ${count} marks are drawn at a ${FLOOR_PX}-pixel floor rather than at their `
      + "length: against a widest of " + money(highest) + " they would be under a pixel, and a mark "
      + "too short to see is one a reader cannot press. Their figures are exact; only their heights "
      + "are not.",
    );
  }

  const shared = (width: number): SharedX => ({
    count,
    x0: MARGIN.left,
    x1: width - MARGIN.right,
    read: (index) => reading(tested[Math.min(Math.max(index, 0), count - 1)]),
    width: 260,
    // THE TIGHTEST END. A keyboard reader arriving at the last position lands
    // on the constraint with the most room, which is the least informative mark
    // on the figure; the first is the one the verdict turns on.
    arriveAt: "first",
  });

  return (
    <Figure
      caption="Every inequality these quotes must satisfy, and the room each one has left"
      ariaLabel={
        `${count} inequalities from the quotes in this family, ordered by remaining room from `
        + `${money(tightest.slack)} to ${money(slacks[slacks.length - 1])}, `
        + `${set?.violations ?? 0} of them violated`
      }
      reading={
        set?.violations
          ? `${set.violations} of ${count} inequalities fail: the quotes admit a portfolio that pays more than it costs in every state.`
          : `The tightest of the ${count} is a ${KIND_WORD[tightest.kind]} with ${money(tightest.slack)} of room, so no portfolio of these quotes is free money.`
      }
      missing={missing}
      notes={notes}
    >
      <Plot height={HEIGHT} sharedX={shared}>
        {(width: number) => {
          const x0 = MARGIN.left;
          const x1 = width - MARGIN.right;
          const plotBottom = HEIGHT - MARGIN.bottom;
          const y = (slack: number) =>
            plotBottom - ((slack - lowest) / span) * (plotBottom - MARGIN.top);
          const wall = y(0);
          const dense = count > DENSE_AT;
          const gap = count > 1 ? (x1 - x0) / (count - 1) : x1 - x0;
          const barW = Math.max(1.6, Math.min(22, gap * 0.62));
          // The outline is what turns a dense block of marks into a curve, and
          // at a low count it is the same information as the tops of the bars
          // drawn a second time — a diagonal across an otherwise empty plot,
          // which is what the eye then reads as the figure.
          const edge = dense
            ? tested
                .map((constraint, index) => `${index ? "L" : "M"}${xOf(index, count, x0, x1).toFixed(2)},${y(constraint.slack).toFixed(2)}`)
                .join(" ")
            : null;
          const railW = x1 - x0;
          const testedW = total ? Math.max(1, (railW * count) / total) : railW;

          return (
            <>
              {/* The half-plane below the wall, drawn only when something is in
                  it. A band that is always there stops being read. */}
              {lowest < 0 ? (
                <rect x={x0} y={wall} width={railW} height={y(lowest) - wall} className="coh-room__danger" />
              ) : null}

              {tested.map((constraint, index) => {
                const at = xOf(index, count, x0, x1);
                const top = y(constraint.slack);
                const kind = `coh-room__stem is-${constraint.kind}${constraint.violated ? " is-violated" : ""}`;
                const key = `${constraint.kind}-${index}`;
                // A bar has an area to point at and a rule does not, which at
                // five constraints is the difference between a measurement and
                // four hairlines. Above the density threshold the bars would be
                // narrower than their own stroke, so they become rules and the
                // outline takes over the job of showing the shape.
                const drawn = Math.max(FLOOR_PX, Math.abs(top - wall));
                const from = constraint.slack < 0 ? wall : wall - drawn;
                return dense ? (
                  <line key={key} x1={at} x2={at} y1={wall} y2={constraint.slack < 0 ? wall + drawn : wall - drawn} className={kind} />
                ) : (
                  <rect key={key} x={at - barW / 2} y={from} width={barW} height={drawn} className={`${kind} is-filled`} />
                );
              })}

              {edge ? <path d={edge} className="coh-room__edge" /> : null}

              {/* The wall itself, over the stems: it is the only line on this
                  figure that states a verdict, and a stem crossing it must not
                  be able to hide where it crossed. */}
              <line x1={x0} x2={x1} y1={wall} y2={wall} className="coh-room__wall" />


              {/* The mark, not the colour, is what says a constraint failed. */}
              {tested.map((constraint, index) =>
                constraint.violated ? (
                  <text
                    key={`breach-${index}`}
                    x={xOf(index, count, x0, x1)}
                    y={y(constraint.slack) - 6}
                    className="coh-room__breach"
                    aria-hidden="true"
                  >
                    ✕
                  </text>
                ) : null,
              )}

              <text x={4} y={MARGIN.top + 4} className="coh-room__tick">{money(highest)}</text>
              <text x={4} y={wall + 4} className="coh-room__tick">$0</text>
              {lowest < 0 ? (
                <text x={4} y={y(lowest)} className="coh-room__tick">{money(lowest)}</text>
              ) : null}

              {/* ONE ROW OF TWO LABELS, and the first version had three that
                  overlapped. "tightest" and "most room" sat at `plotBottom + 16`
                  while the wall's own meaning sat at `wall + 13` — and when
                  nothing is violated the wall IS the plot's bottom, so the two
                  rows were three pixels apart and the right-hand pair printed
                  over each other. Seen at a viewport; no arithmetic in the
                  source says these two numbers are ever equal.

                  Naming the ORDER rather than its two ends says the same thing
                  in one label and leaves the row for the wall's meaning. */}
              <text x={x0} y={plotBottom + 16} className="coh-room__note">
                ordered by room left, tightest first
              </text>
              <text x={x1} y={plotBottom + 16} className="coh-room__note" textAnchor="end">
                below the line is an arbitrage
              </text>

              {/* The rail: what was drawn, against what could not be read. */}
              <rect x={x0} y={RAIL_Y} width={testedW} height={RAIL_H} className="coh-room__rail-tested" />
              {skipped ? (
                <rect
                  x={x0 + testedW} y={RAIL_Y} width={Math.max(1, railW - testedW)} height={RAIL_H}
                  className="coh-room__rail-skipped"
                />
              ) : null}
              <text x={x0} y={RAIL_Y + RAIL_H + 13} className="coh-room__rail-label">
                {`${count} evaluated`}
              </text>
              {skipped ? (
                <text x={x1} y={RAIL_Y + RAIL_H + 13} className="coh-room__rail-label" textAnchor="end">
                  {`${skipped} unquotable on one side`}
                </text>
              ) : null}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
