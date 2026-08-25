"use client";

/**
 * How much code each lesson is about, against how much test holds it.
 *
 * WHAT IT WAS, AND WHY ONE BAR WAS HALF A DRAWING. The four group views —
 * Quotes, Structure, Bounds, Record — opened on a grid of prose cards until the
 * fourth review of 2026-08-24, which asked for a drawing of the numbers in every
 * view. The only numbers a group of lessons has are the two path lists on each
 * card: the modules a lesson is ABOUT, and the suites that go red if it stops
 * being true. What shipped drew the second alone, as one bar per lesson.
 *
 * That is half the catalogue's own claim. `lib/coherence/lessons.ts` states it:
 * "these are not notes beside the code, they are claims the suite enforces", and
 * the enforcement is a RATIO — a lesson carried by three modules and pinned by
 * one suite is held more thinly than one carried by one and pinned by three.
 * Neither figure means much without the other, and a bar of the second alone
 * invites the reading that a big bar is a big lesson.
 *
 * So it is a dumbbell: a tick at the modules, a dot at the suites, and the span
 * between them is the gap. That makes the comparison a LENGTH — readable down
 * the rows without arithmetic — and it makes the ordinary answer informative,
 * where a single bar's ordinary answer was "some lessons have more tests".
 * `CombosBounds`'s slack strip is the same idiom, drawn for the same reason, and
 * this reuses its marks rather than inventing a second vocabulary for them.
 *
 * REFUSED, and recorded because they are the tempting ones: a bar per lesson of
 * its summary's length, of whether it carries a formula, or of shipped versus
 * pending. The first two draw the prose rather than anything measured, and the
 * third is degenerate — every lesson in the catalogue is shipped, so it would be
 * a row of identical bars claiming to be a finding.
 */

import { COHERENCE_LESSONS, type CoherenceLesson } from "@/lib/coherence/lessons";
import { DIAGRAM_LABEL_PX, gutterFor, truncateMiddle } from "@/lib/coherence/label-metrics";
import { ENGINE_SECTIONS } from "@/lib/sections";
import Figure, { Plot } from "./Figure";

/** One dumbbell row, matched to `CombosBounds`'s so the two read as one idiom. */
const ROW_H = 26;

/**
 * The rail's own label, so a card names the section as the reader sees it.
 *
 * BOTH rails since the split of 2026-08-24: the curriculum spans the engine and
 * half the lessons are taught on Quotes, so looking a `pane` up in one tab's
 * array would print the raw id for seven of the fourteen. Exported because
 * `LessonsPane`'s cards need the same resolution and two copies of it is two
 * places for the lookup to drift.
 */
export const sectionLabel = (pane: string) =>
  ENGINE_SECTIONS.find((section) => section.id === pane)?.label ?? pane;

export default function GroupPins({ lessons }: { lessons: CoherenceLesson[] }) {
  const cells = lessons.map((lesson) => ({
    lesson,
    modules: lesson.guards.length,
    suites: lesson.pinnedBy.length,
    label: `${lesson.pinnedBy.length >= lesson.guards.length ? "●" : "▲"} ${lesson.title}`,
  }));
  // The axis is the whole CATALOGUE's range, not this group's, so the four
  // group views are comparable with each other. A per-group domain would draw
  // every group's widest lesson at the same length and hide which group is the
  // thinly-held one.
  const most = Math.max(
    1,
    ...COHERENCE_LESSONS.map((lesson) => Math.max(lesson.guards.length, lesson.pinnedBy.length)),
  );
  const thin = cells.filter((cell) => cell.suites < cell.modules);
  const height = 8 + cells.length * ROW_H + 22;

  return (
    <Figure
      caption="Each lesson's modules against the suites that hold it"
      ariaLabel={cells
        .map((cell) => `${cell.lesson.title}: ${cell.modules} module(s), ${cell.suites} suite(s)`)
        .join(". ")}
      reading={
        thin.length
          ? `${thin.length} of ${cells.length} lessons here are pinned by fewer suites than they name modules.`
          : "Every lesson here is pinned by at least as many suites as it names modules."
      }
      notes={[
        "The marks count SUITES and MODULES, not assertions: a file that pins one lesson in forty places is one "
        + "mark. It is a measure of how widely a claim is held, never of how deeply.",
        "The axis is the whole catalogue's range rather than this group's, so the four group views can be read "
        + "against each other.",
      ]}
    >
      <Plot height={height}>
        {(width) => {
          const gutter = gutterFor(cells.map((cell) => cell.label), width, DIAGRAM_LABEL_PX, {
            min: 96, maxFraction: 0.4, max: 300,
          });
          const track = Math.max(60, width - gutter - 56);
          const x = (value: number) => gutter + (value / (most + 1)) * track;

          return (
            <>
              {cells.map((cell, index) => {
                const y = 8 + index * ROW_H;
                const mid = y + 9;
                const from = Math.min(x(cell.modules), x(cell.suites));
                const to = Math.max(x(cell.modules), x(cell.suites));
                const held = cell.suites >= cell.modules;
                return (
                  <g key={cell.lesson.id}>
                    <line
                      x1={from} x2={to} y1={mid} y2={mid}
                      className={`coh-slack__span${held ? "" : " is-violated"}`}
                    >
                      <title>
                        {`${cell.lesson.title} — taught in ${sectionLabel(cell.lesson.pane)}; `
                          + `${cell.modules} module(s), ${cell.suites} suite(s)`}
                      </title>
                    </line>
                    <line
                      x1={x(cell.modules)} x2={x(cell.modules)} y1={mid - 8} y2={mid + 8}
                      className="coh-slack__bound"
                    >
                      <title>
                        {`carried by ${cell.modules} module(s): ${cell.lesson.guards.join(", ")}`}
                      </title>
                    </line>
                    <circle
                      cx={x(cell.suites)} cy={mid} r={5}
                      className={`coh-slack__cost${held ? "" : " is-violated"}`}
                    >
                      <title>
                        {`pinned by ${cell.suites} suite(s): ${cell.lesson.pinnedBy.join(", ") || "nothing yet"}`}
                      </title>
                    </circle>
                  </g>
                );
              })}
              {cells.map((cell, index) => (
                <text key={`${cell.lesson.id}-label`} x={0} y={8 + index * ROW_H + 13} className="coh-combo__label">
                  {truncateMiddle(cell.label, gutter - 10, DIAGRAM_LABEL_PX)}
                </text>
              ))}
              <text x={gutter} y={height - 4} className="coh-combo__axis">0</text>
              <text x={gutter + track} y={height - 4} textAnchor="end" className="coh-combo__axis">
                {most + 1}
              </text>
              <text x={gutter + track + 8} y={8 + 13} className="coh-slack__key">| modules ● suites</text>
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
