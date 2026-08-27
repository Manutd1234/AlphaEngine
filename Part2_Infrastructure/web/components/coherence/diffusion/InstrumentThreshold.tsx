"use client";

/**
 * Every requirement placed by the floor it had to clear and the reading it got.
 *
 * WHAT THIS REPLACED. `InstrumentFit` drew six horizontal tracks with a floor
 * tick on each — a bar chart, and a sparse one: measured at 1504px, the tracks
 * were 391px of the width (26%), two of the six rows drew no bar at all, and
 * the strongest fact in the figure was the gap between a fill edge and a 2px
 * tick. The file's own docblock says the table it replaced "flattens" the
 * margins to one word; the tracks flattened them again, to one length each,
 * with no way to compare a generous floor cleared narrowly against a strict
 * one cleared by a hair.
 *
 * TWO NUMBERS, TWO AXES. Every check already carries both on its own 0–1
 * scale — `floor`, what it had to clear, and `at`, what it read — because
 * `groupsOf` maps an R², two indices out of ten and a yes/no onto that scale
 * precisely so they can share a threshold. Floor across, reading up, and the
 * diagonal is the verdict: a mark above the line cleared its floor, a mark
 * below it did not, and the VERTICAL distance to the line is the margin. Two
 * shapes the tracks could not show fall straight out of it — the gate sits
 * far above the line at a lenient floor of 0.20, while the rank and the
 * spread hug the line at a strict 0.9. "All four clear" and "all four clear
 * by very different margins, against very different demands" are different
 * readings, and this is the one that draws the second.
 *
 * THE UNSCORED ROWS HAVE NO POSITION AND ARE NOT GIVEN ONE. Two requirements
 * are unmeasured on this deployment (`skill_meetings` is 0). A point at y=0
 * would read as "scored, and scored nought", which is the opposite of what an
 * absent measurement means — so they sit in a hatched strip BELOW the x axis,
 * at the floor they would have been held to, with the reason in their own
 * title. The strip is the width of the field: a gap the size of the question,
 * not a mark at the bottom of the answer.
 *
 * NOT COLOUR-ALONE. Every mark carries its number, the key carries the same
 * number with `✓`/`✗`/`◌`, and the two unscored ones are hatched as well as
 * numbered — the drawing survives being read in one hue.
 */

import { memo } from "react";

import { DIAGRAM_LABEL_PX, truncateMiddle } from "@/lib/coherence/label-metrics";
import Figure, { FigureEmpty, Plot } from "../Figure";

/** The shape `InstrumentFit.groupsOf` builds; imported as a type only. */
export interface ThresholdCheck {
  readonly what: string;
  readonly value: string;
  readonly needed: string;
  readonly at: number | null;
  readonly floor: number;
  readonly met: boolean | null;
  readonly room: string;
}

export interface ThresholdGroup {
  readonly title: string;
  readonly rows: readonly ThresholdCheck[];
}

const HEIGHT = 300;
/** `left` carries the y ticks AND the rotated axis word outside them. */
// `bottom` holds exactly what is drawn under the axis and no more: the x ticks
// at +14, the no-reading band at +24 through +42, and the axis word at +58.
// It was 74 for a 62px stack, and every pixel of that slack came off the side
// of a SQUARE field — which is the one dimension this figure cannot spare,
// because the two indices sit 0.078 apart and need the room to separate.
const MARGIN = { top: 22, bottom: 46, left: 58 };
/** The hatched band under the x axis where an unmeasured requirement sits. */
const GAP_STRIP_H = 26;
const FIELD = HEIGHT - MARGIN.top - MARGIN.bottom - GAP_STRIP_H;
/** Between the field and its key. */
const KEY_GAP = 34;
/** One line per key row: a name and its reading, not a stacked pair. */
const KEY_ROW = 24;
/** Room at the far right, so the reading column is not flush to the edge. */
const KEY_RIGHT = 16;
const DOT_R = 6;
/** Two requirements can share a floor, so their capsules step sideways. */
const GAP_W = 46;

const MARK: Record<string, string> = { met: "✓", missed: "✗", absent: "◌" };

function markOf(check: ThresholdCheck): string {
  if (check.met == null) return MARK.absent;
  return check.met ? MARK.met : MARK.missed;
}

/** Under ~90 characters, because the readout truncates past the plot width. */
function titleOf(check: ThresholdCheck, index: number): string {
  if (check.at == null) return `${index}. ${check.what} — not measured: ${check.room}`;
  const verb = check.met ? "clears" : "misses";
  return `${index}. ${check.what} — ${check.value} ${verb} ${check.needed}`;
}

function InstrumentThreshold({ groups }: { groups: readonly ThresholdGroup[] }) {
  const rows = groups.flatMap((group) => group.rows);
  const placed = rows.filter((check) => check.at != null);
  const absent = rows.filter((check) => check.at == null);
  const cleared = placed.filter((check) => check.met === true);

  // The reading is derived, never asserted: the widest and narrowest margin
  // among the checks that had a real floor to clear (a floor of 0 is "no
  // silent drops", a yes/no, and its margin is not a distance).
  const withFloor = cleared.filter((check) => check.floor > 0 && check.at != null);
  const margins = withFloor
    .map((check) => ({ check, margin: (check.at as number) - check.floor }))
    .sort((a, b) => b.margin - a.margin);
  const widest = margins[0];
  const narrowest = margins[margins.length - 1];

  return (
    <Figure
      caption="Every requirement placed by the floor it had to clear and the reading it got"
      ariaLabel={`${rows.length} requirements on a field of floor against reading. ` + rows
        .map((check) => `${check.what}: ${check.value}, needed ${check.needed}, `
          + `${check.met == null ? "not measured" : check.met ? "met" : "not met"}`)
        .join("; ")}
      reading={placed.length && widest && narrowest && widest !== narrowest
        ? `Every measured check sits above the line, and not by similar distances: `
          + `${widest.check.what.toLowerCase()} clears a floor of ${widest.check.floor} with room to spare, `
          + `where ${narrowest.check.what.toLowerCase()} clears a much stricter ${narrowest.check.floor} by a hair.`
        : placed.length
          ? "Every measured check sits above the line it had to clear."
          : "No requirement carries a reading yet."}
      missing={absent.length
        ? `${absent.length} of ${rows.length} requirements have no measurement and sit in the band below the `
          + "axis at the floor they would have been held to, rather than as a reading of nought."
        : null}
    >
      {rows.length ? (
        <Plot height={HEIGHT} minWidth={560}>
          {(width) => {
            // THE FIELD IS SQUARE AND ITS SIDE COMES FROM THE HEIGHT, because
            // equal pixels per unit on both axes is what makes the diagonal a
            // 45° line and the height above it a readable margin. The key then
            // takes the whole of what is left — sized from the labels, but
            // never smaller than the room actually available, which is the bug
            // this replaced: `gutterFor` returned an ESTIMATE of 387px in a
            // canvas with 1,218px free, and every name was elided to fit a
            // column that had no reason to be narrow.
            const side = FIELD;
            const keyX = MARGIN.left + side + KEY_GAP;
            const keyWidth = Math.max(200, width - keyX - KEY_RIGHT);
            // The reading sits in its own column rather than flush right, so a
            // long name and a short one line their figures up.
            const nameCol = Math.min(360, keyWidth * 0.55);
            const x = (unit: number) => MARGIN.left + unit * side;
            const y = (unit: number) => MARGIN.top + (1 - unit) * side;
            const base = MARGIN.top + side;
            const stripTop = base + 24;

            return (
              <>
                {/* THE VERDICT LINE, painted first so every mark sits over it.
                    Drawn here rather than through `Plot`'s `reference`: this is
                    a y = x diagonal in the field's own units, not a horizontal
                    reference at a data value, and the shared prop is shaped for
                    the latter. */}
                <line className="diff-thresh__ref" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(1)}>
                  <title>The line where a reading equals its floor: a mark above it cleared, and the height above it is the margin</title>
                </line>
                {/* Below the diagonal and left of centre — the quadrant a check
                    can only reach by MISSING its floor, so on a passing read it
                    is the one empty corner of the field. */}
                <text className="diff-thresh__reflabel" x={x(0.42)} y={y(0.42) + 16}>
                  reading equals its floor
                </text>

                <line className="diff-thresh__axis" x1={x(0)} x2={x(1)} y1={base} y2={base} />
                <line className="diff-thresh__axis" x1={x(0)} x2={x(0)} y1={MARGIN.top} y2={base} />

                {[0, 0.5, 1].map((tick) => (
                  <text key={`y${tick}`} className="diff-thresh__tick" x={x(0) - 7} y={y(tick) + 3} textAnchor="end">
                    {tick}
                  </text>
                ))}
                {[0, 0.5, 1].map((tick) => (
                  <text key={`x${tick}`} className="diff-thresh__tick" x={x(tick)} y={base + 14}
                        textAnchor={tick === 0 ? "start" : tick === 1 ? "end" : "middle"}>
                    {tick}
                  </text>
                ))}
                {/* BELOW the band, not above it: at `base + 30` this line ran
                    straight through the hatched capsules and their marks. */}
                <text className="diff-thresh__axisword" x={x(0)} y={base + 58}>
                  floor demanded, on each check&rsquo;s own scale →
                </text>
                {/* ROTATED, so the y axis names itself beside its own ticks
                    rather than above them: laid flat above the plot it shared a
                    baseline with the topmost tick and with the mark that sits
                    at a floor of nought. */}
                <text className="diff-thresh__axisword" transform={`rotate(-90 ${x(0) - 40} ${MARGIN.top + side / 2})`}
                      x={x(0) - 40} y={MARGIN.top + side / 2} textAnchor="middle">
                  reading →
                </text>

                {/* Rug ticks: where each floor and each reading falls on its own
                    axis. No `<title>`, so they add density without adding a
                    keyboard stop to walk past. */}
                {rows.map((check, index) => (
                  <line key={`rugx${index}`} className="diff-thresh__rug"
                        x1={x(check.floor)} x2={x(check.floor)} y1={base} y2={base + 5} />
                ))}
                {placed.map((check, index) => (
                  <line key={`rugy${index}`} className="diff-thresh__rug"
                        x1={x(0) - 5} x2={x(0)} y1={y(check.at as number)} y2={y(check.at as number)} />
                ))}

                {rows.map((check, index) => {
                  const number = index + 1;
                  if (check.at == null) {
                    // No reading: a hatched capsule in the band under the axis,
                    // at the floor it would have been held to. Two requirements
                    // can share a floor — both unscored ones sit at nought on
                    // the live read — so they step sideways rather than stack.
                    const peers = absent.filter((other) => other.floor === check.floor);
                    const slot = peers.indexOf(check);
                    const cx = Math.min(
                      x(1) - GAP_W / 2,
                      x(check.floor) + GAP_W / 2 + slot * (GAP_W + 6),
                    );
                    return (
                      <g key={check.what}>
                        <rect className="diff-thresh__gap" x={cx - GAP_W / 2} y={stripTop}
                              width={GAP_W} height={GAP_STRIP_H - 8} rx={3}>
                          <title>{titleOf(check, number)}</title>
                        </rect>
                        <text className="diff-thresh__gapmark" x={cx} y={stripTop + 13} textAnchor="middle">
                          <tspan aria-hidden="true">{MARK.absent}</tspan> {number}
                        </text>
                      </g>
                    );
                  }
                  const cx = x(check.floor);
                  const cy = y(check.at);
                  return (
                    <g key={check.what}>
                      <circle className={`diff-thresh__dot${check.met ? "" : " is-short"}`} cx={cx} cy={cy} r={DOT_R}>
                        <title>{titleOf(check, number)}</title>
                      </circle>
                      <text className="diff-thresh__dotnum" x={cx} y={cy + 3.5} textAnchor="middle" aria-hidden="true">
                        {number}
                      </text>
                    </g>
                  );
                })}

                {/* The band's own word, so it is not a mystery: it is where a
                    requirement with no reading is placed. */}
                {absent.length ? (
                  <text className="diff-thresh__tick" x={x(1)} y={stripTop + 13} textAnchor="end">
                    no reading
                  </text>
                ) : null}

                {/* THE KEY, right of the field. ONE LINE per requirement —
                    number and name left, reading against requirement right —
                    because a stacked pair at this rung puts two 13px boxes 13px
                    apart, which is an overlap by construction. */}
                {(() => {
                  let keyY = MARGIN.top + 4;
                  return groups.map((group) => {
                    const headY = keyY;
                    keyY += 21;
                    const drawn = group.rows.map((check) => {
                      const rowY = keyY;
                      keyY += KEY_ROW;
                      const number = rows.indexOf(check) + 1;
                      const reading = check.value === "—" ? check.room : `${check.value} / ${check.needed}`;
                      return (
                        <g key={check.what}>
                          <text className="diff-thresh__key" x={keyX} y={rowY + 9}>
                            <tspan aria-hidden="true">{number}</tspan>{" "}
                            <tspan aria-hidden="true">{markOf(check)}</tspan>{" "}
                            {truncateMiddle(check.what, nameCol - 30, DIAGRAM_LABEL_PX)}
                          </text>
                          <text className="diff-thresh__keyvalue" x={keyX + nameCol} y={rowY + 9}>
                            {truncateMiddle(reading, keyWidth - nameCol - 8, DIAGRAM_LABEL_PX)}
                          </text>
                        </g>
                      );
                    });
                    return (
                      <g key={group.title}>
                        <text className="diff-thresh__keygroup" x={keyX} y={headY + 9}>{group.title}</text>
                        {drawn}
                      </g>
                    );
                  });
                })()}
              </>
            );
          }}
        </Plot>
      ) : (
        <FigureEmpty reason="No requirement has been measured yet." />
      )}
    </Figure>
  );
}

export default memo(InstrumentThreshold);
