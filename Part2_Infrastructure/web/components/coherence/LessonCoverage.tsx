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

import { useState } from "react";

import { COHERENCE_LESSONS } from "@/lib/coherence/lessons";
import {
  COHERENCE_SECTION_IDS,
  DIFFUSION_SECTION_IDS,
  ENGINE_SECTIONS,
  MARKETS_SECTION_IDS,
} from "@/lib/sections";
import type { WorkspaceView } from "@/lib/workspace-nav";

import Figure, { FigureEmpty, Plot } from "./Figure";
import styles from "./LessonCoverage.module.css";

const CAPTION = "Coverage topology by engine plane — one node per section, radius proportional to lessons";
/** Enough inline room for the count word and a useful pointer target per rail
 *  section. Narrow viewports get a named local scroll region rather than
 *  overlapping twenty-two columns into an unreadable hatch. */
const MARKETS_IDS = new Set<string>(MARKETS_SECTION_IDS);
const PROOFS_IDS = new Set<string>(COHERENCE_SECTION_IDS);
const DIFFUSION_IDS = new Set<string>(DIFFUSION_SECTION_IDS);

type CoveragePlane = "markets" | "proofs" | "diffusion";

const PLANES: ReadonlyArray<{ id: CoveragePlane; label: string; ids: Set<string> }> = [
  { id: "markets", label: "Markets", ids: MARKETS_IDS },
  { id: "proofs", label: "Proofs", ids: PROOFS_IDS },
  { id: "diffusion", label: "Diffusion", ids: DIFFUSION_IDS },
];

function labelLines(label: string): [string, string?] {
  const words = label.split(" ");
  if (words.length < 2 || label.length < 13) return [label];
  const cut = Math.ceil(words.length / 2);
  return [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
}

function tabForSection(section: string): WorkspaceView {
  if (MARKETS_IDS.has(section)) return "markets";
  if (PROOFS_IDS.has(section)) return "coherence";
  if (DIFFUSION_IDS.has(section)) return "diffusion";
  // An orphan is already reported by the figure. Keep the fallback local to
  // Proofs rather than manufacturing a destination on an unrelated desk.
  return "coherence";
}

/** "Shell and Lessons", "A, B and C" — never a bare comma list in prose. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function LessonCoverage({ onOpenSection }: {
  onOpenSection?: (tab: WorkspaceView, section?: string) => void;
}) {
  const [plane, setPlane] = useState<CoveragePlane>("markets");
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

  const planeIds = PLANES.find((item) => item.id === plane)?.ids ?? MARKETS_IDS;
  const visibleColumns = columns.filter((column) => planeIds.has(column.id));
  const plotFloor = Math.max(720, visibleColumns.length * 108);
  const axisY = 104;

  return (
    <div className={styles.coverageLab}>
      <div className={styles.planeSwitch} role="group" aria-label="Coverage plane">
        {PLANES.map((item) => {
          const planeColumns = columns.filter((column) => item.ids.has(column.id));
          const count = planeColumns.reduce((sum, column) => sum + column.lessons.length, 0);
          return <button type="button" key={item.id} aria-pressed={plane === item.id} onClick={() => setPlane(item.id)}><strong>{item.label}</strong><span>{count} lessons across {planeColumns.length} sections</span></button>;
        })}
      </div>
    <Figure caption={CAPTION} ariaLabel={ariaLabel} reading={reading} missing={missing}>
      <Plot
        height={166}
        minWidth={plotFloor}
        scrollLabel="Lesson coverage by engine section"
        onSelect={onOpenSection
          ? (index) => {
              const column = visibleColumns[index];
              if (column) onOpenSection(tabForSection(column.id), column.id);
            }
          : undefined}
      >
        {(width) => {
          const colW = width / Math.max(1, visibleColumns.length);
          return (
            <>
              <text x={0} y={14} className="coh-svg-note">
                <tspan>● radius = lesson count</tspan>
                <tspan dx={14}>○ hollow = none taught</tspan>
                <tspan dx={14}>activate a node to open its section</tspan>
              </text>
              <line x1={0} x2={width} y1={axisY} y2={axisY} className="coh-surface__axis" />
              {visibleColumns.map((column, index) => {
                const cx = index * colW + colW / 2;
                const count = column.lessons.length;
                const cy = 78 - Math.min(3, count) * 10;
                const radius = count ? 9 + count * 4 : 9;
                const [first, second] = labelLines(column.label);
                return (
                  <g key={column.id}>
                    {/* One semantic mark per section. The previous per-lesson
                        titles made Arrow navigation visit several stops in one
                        column and made an Enter action impossible to map back
                        to a section. The full lesson titles remain available
                        here without truncation, and activating the mark opens
                        the section when the workspace supplied navigation. */}
                    <title>
                      {`${column.label}: ${count
                        ? `${count} ${count === 1 ? "lesson" : "lessons"} — ${column.lessons.map((lesson) => lesson.title).join("; ")}`
                        : "no lesson is taught here"}. Activate to open ${column.label}.`}
                    </title>
                    <line x1={cx} x2={cx} y1={cy + radius} y2={axisY} className={styles.stem} />
                    <circle cx={cx} cy={cy} r={radius} className={count ? styles.node : `${styles.node} ${styles.emptyNode}`} />
                    <text x={cx} y={cy + 4} textAnchor="middle" className={count ? styles.count : styles.none}>{count || "◌"}</text>
                    <text x={cx} y={axisY + 22} textAnchor="middle" className="coh-surface__tick">
                      <tspan x={cx}>{first}</tspan>{second ? <tspan x={cx} dy={14}>{second}</tspan> : null}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
    </div>
  );
}
