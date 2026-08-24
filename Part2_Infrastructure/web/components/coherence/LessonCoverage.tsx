"use client";

/**
 * Which parts of this engine are actually taught, and which are not taught at all.
 *
 * The curriculum shipped as fourteen cards and no picture. A reader could see
 * every lesson and still not see the SHAPE of the thing. Re-derived from the
 * catalogue on 2026-08-24 after the last of that day's four restructures: over
 * the engine's NINE sections, Books carries three, Universe, the lattice and
 * Dutch book two each, Fees, Scorecard and Diffusion one each, and TWO carry
 * nothing at all — Shell and Lessons itself. Fourteen cards read as broad
 * coverage; over seventeen sections they were not, and the consolidation is
 * what changed that reading rather than any lesson being written.
 *
 * That paragraph is the only place a count is written down, it is written down
 * because a banner nobody can check goes stale, and it went stale exactly once:
 * it claimed "six sections carry one and two carry nothing" over an eleven-id
 * rail and was still claiming it after the rail became seventeen. Everything
 * ON SCREEN is computed, so the strip itself could not drift with it.
 *
 * Three decisions, because each is a way this strip could lie:
 *
 * **The columns are the rail, not the lessons.** They come from
 * `ENGINE_SECTIONS` in rail order, so every section the engine offers gets a
 * column whether or not a lesson names it. Building the columns from the lessons
 * instead would draw only the sections that happen to be taught — a
 * complete-looking picture of a smaller engine, and precisely the omission the
 * figure exists to show.
 *
 * BOTH RAILS, and reading one array is what makes that safe. The engine is two
 * tabs again since the split of 2026-08-24 — Prices and Proofs — and seven of
 * the fourteen lessons are taught on the first. A strip built from one tab's
 * array would silently drop half the curriculum and still look complete, which
 * is the same failure as building the columns from the lessons. `ENGINE_SECTIONS`
 * in `lib/sections.ts` is the concatenation, declared once. A lesson whose
 * `pane` names an id NEITHER rail carries is an orphan, which is why the orphan
 * branch below is not decoration — `stake`, `index` and `combos` each were one,
 * and each moved to its carrier in the same change that demoted it.
 *
 * **A section with nothing gets a column, a stub, a mark and the word "none".**
 * Not a gap, not a zero-height bar that reads as a rendering fault. An absence
 * that is the finding has to be drawn as a finding.
 *
 * **Every count is derived here, nothing is written down.** The counts, the
 * covered total, the names of the bare sections and the reading itself are all
 * computed from the catalogue, so a fifteenth lesson moves this figure without
 * anyone remembering to. A number typed into a caption is a number that drifts.
 *
 * Nothing carries meaning in colour alone: a taught column is a stack of marks
 * with its count above it, a bare column is a flat stub with a ◌ over it and
 * the word "none" where the count would be, and the key at the top pairs the
 * two. Strip every hue and the strip still reads.
 */

import { COHERENCE_LESSONS } from "@/lib/coherence/lessons";
import { ENGINE_SECTIONS } from "@/lib/sections";

import Figure, { FigureEmpty, Plot } from "./Figure";

const CAPTION = "One column per section of the engine, in rail order, one mark per lesson taught there";

const MARK_H = 12;
const MARK_GAP = 4;
const KEY_Y = 11;
const COUNT_Y = 30;
const MARKS_TOP = 38;

/** Room under the axis for the rotated labels. "Coherence index" is still the
 *  longest of the seventeen at 15 characters, and the labels sit on the
 *  diagram ladder's 12px rung since 2026-08-24 (14r), so 15 x 12 x 0.56 =
 *  ~101px of run plus slack. At the old 10px band of 92 the lift would have
 *  clipped the two longest labels mid-word. */
const LABEL_BAND = 112;

/** "Shell and Lessons", "A, B and C" — never a bare comma list in prose. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function LessonCoverage() {
  const columns = ENGINE_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    lessons: COHERENCE_LESSONS.filter((lesson) => lesson.pane === section.id),
  }));

  // A lesson whose `pane` names nothing on the rail would otherwise vanish
  // without the strip looking short. Counted, and named in `missing` if it ever
  // happens, rather than silently dropped.
  const orphans = COHERENCE_LESSONS.filter(
    (lesson) => !columns.some((column) => column.id === lesson.pane),
  );
  const orphanPanes = Array.from(new Set(orphans.map((lesson) => lesson.pane)));

  const taught = columns.filter((column) => column.lessons.length > 0);
  const bare = columns.filter((column) => column.lessons.length === 0);

  const ariaLabel = `One column per section of the engine, one mark per lesson: ${columns
    .map((column) => `${column.label} ${column.lessons.length || "none"}`)
    .join(", ")}.`;

  if (!COHERENCE_LESSONS.length) {
    return (
      <Figure
        caption={CAPTION}
        ariaLabel="No lessons to place against the section rail"
        missing={`The rail is intact; the catalogue is empty, so nothing is drawn rather than ${columns.length} empty columns.`}
      >
        <FigureEmpty reason="No lessons in the catalogue to place." />
      </Figure>
    );
  }

  const orphanNote = orphans.length
    ? ` ${
        orphans.length === 1 ? "One lesson names a section" : `${orphans.length} lessons name sections`
      } the rail does not carry (${listOf(orphanPanes)}), so ${
        orphans.length === 1 ? "it sits" : "they sit"
      } in no column here.`
    : "";

  const reading = bare.length
    ? `${COHERENCE_LESSONS.length} lessons across ${taught.length} of the engine's ${columns.length} sections. ${listOf(
        bare.map((column) => column.label),
      )} ${bare.length === 1 ? "carries" : "carry"} none.`
    : `${COHERENCE_LESSONS.length} lessons across all ${columns.length} sections of the engine.`;

  const missing = `No mark stands for pending work — all ${COHERENCE_LESSONS.length} lessons are shipped. The strip counts lessons, not depth: a column of one is one lesson\u2019s section, not a smaller one.${orphanNote}`;

  const tallest = Math.max(1, ...columns.map((column) => column.lessons.length));
  const axisY = MARKS_TOP + tallest * MARK_H + (tallest - 1) * MARK_GAP;

  return (
    <Figure caption={CAPTION} ariaLabel={ariaLabel} reading={reading} missing={missing}>
      <Plot height={axisY + LABEL_BAND}>
        {(width) => {
          const colW = width / columns.length;
          const markW = Math.max(6, Math.min(colW - 10, 26));
          return (
            <>
              {/* The key, so a mark is not left to be inferred from its stack.
                  A legend, so it takes the ladder's 13px rung (coh-svg-note,
                  14r) rather than the column labels' 12. */}
              <text x={0} y={KEY_Y} className="coh-svg-note">
                <tspan>▪ one lesson</tspan>
                <tspan dx={14}>◌ none taught</tspan>
              </text>

              <line x1={0} x2={width} y1={axisY} y2={axisY} className="coh-surface__axis" />

              {columns.map((column, index) => {
                const cx = index * colW + colW / 2;
                const count = column.lessons.length;
                // Rotated -90°, so the anchor's glyphs hang below and to the
                // left of it; nudged right to sit optically over the column.
                const labelX = cx + 3.5;
                const labelY = axisY + 8;
                return (
                  <g key={column.id}>
                    {count === 0 ? (
                      <>
                        {/* A stub ON the axis, not a gap: the section exists and
                            teaches nothing, which is not the same as absent. */}
                        <rect
                          x={cx - markW / 2}
                          y={axisY - 3}
                          width={markW}
                          height={3}
                          className="coh-surface__bar-zero"
                        >
                          <title>{`${column.label}: no lesson is taught here`}</title>
                        </rect>
                        {/* Mark and word on separate rows, not "◌ none" on
                            one. Two bare sections sit adjacent at the end of
                            the rail, and a six-character label in a column
                            narrower than it is a label that lands on its
                            neighbour. The key at the top pairs the two. */}
                        <text x={cx} y={axisY - 6} textAnchor="middle" className="coh-surface__unread">
                          ◌
                        </text>
                        <text x={cx} y={COUNT_Y} textAnchor="middle" className="coh-surface__unread">
                          none
                        </text>
                      </>
                    ) : (
                      <>
                        {column.lessons.map((lesson, row) => (
                          <rect
                            key={lesson.id}
                            x={cx - markW / 2}
                            y={axisY - (row + 1) * MARK_H - row * MARK_GAP}
                            width={markW}
                            height={MARK_H}
                            className="coh-surface__bar"
                          >
                            <title>{`${column.label}: ${lesson.title}`}</title>
                          </rect>
                        ))}
                        <text x={cx} y={COUNT_Y} textAnchor="middle" className="coh-surface__value">
                          {count}
                        </text>
                      </>
                    )}
                    <text
                      x={labelX}
                      y={labelY}
                      textAnchor="end"
                      transform={`rotate(-90 ${labelX.toFixed(2)} ${labelY.toFixed(2)})`}
                      className="coh-surface__tick"
                    >
                      {column.label}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
