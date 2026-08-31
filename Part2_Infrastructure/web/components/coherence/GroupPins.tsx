"use client";

/**
 * A readable module-to-suite comparison for each curriculum slice.
 *
 * The original SVG used one row per lesson on a shared numeric axis. That
 * preserved the comparison and shortened the lesson names until the subject
 * of a row could no longer be read. This keeps the same two quantities in a
 * semantic table: titles wrap in full, exact counts have their own columns,
 * and the difference is stated with both a mark and words.
 *
 * Exact paths remain in the numbered lesson Sheet. The group table is the
 * overview; its action opens the evidence rather than duplicating long paths
 * across two consecutive tables.
 */

import { Button } from "@/components/ui/button";
import { COHERENCE_LESSONS, type CoherenceLesson } from "@/lib/coherence/lessons";
import { ENGINE_SECTIONS } from "@/lib/sections";

import Figure from "./Figure";
import styles from "./LessonPins.module.css";

/** The rail's own label, shared by the lesson catalogue and detail Sheet. */
export const sectionLabel = (pane: string) =>
  ENGINE_SECTIONS.find((section) => section.id === pane)?.label ?? pane;

interface LessonPinCell {
  lesson: CoherenceLesson;
  ordinal: number;
  modules: number;
  suites: number;
  gap: number;
}

function coverageLabel(cell: LessonPinCell): string {
  if (cell.gap === 0) return "No count gap";
  if (cell.gap > 0) return `${cell.gap} extra ${cell.gap === 1 ? "suite" : "suites"}`;
  const short = Math.abs(cell.gap);
  return `${short} fewer ${short === 1 ? "suite" : "suites"}`;
}

export default function GroupPins({
  lessons,
  onInspect,
}: {
  lessons: CoherenceLesson[];
  onInspect: (lesson: CoherenceLesson) => void;
}) {
  const cells: LessonPinCell[] = lessons.map((lesson) => {
    const modules = lesson.guards.length;
    const suites = lesson.pinnedBy.length;
    return {
      lesson,
      ordinal: COHERENCE_LESSONS.findIndex((entry) => entry.id === lesson.id) + 1,
      modules,
      suites,
      gap: suites - modules,
    };
  });
  const thin = cells.filter((cell) => cell.gap < 0);

  return (
    <Figure
      caption="Guarded modules against pinning suites, lesson by lesson"
      ariaLabel="Guarded module and pinning suite comparison by lesson"
      reading={
        thin.length
          ? `${thin.length} of ${cells.length} lessons here are pinned by fewer suites than they name modules.`
          : "Every lesson here is pinned by at least as many suites as it names modules."
      }
      notes={[
        "The table counts files, not assertions: a suite that pins one lesson in forty places still counts once.",
        "Open a lesson for the exact module and suite paths behind these counts.",
      ]}
      reserveInteractionRow={false}
    >
      <div
        className={`table-wrap ${styles.tableWrap}`}
        role="region"
        aria-label="Lesson module and suite comparison"
        tabIndex={0}
      >
        <table className={`coh-table ${styles.coverageTable}`}>
          <caption className="coh-table__caption sr-only">
            Guarded module and pinning suite counts for each lesson
          </caption>
          <thead>
            <tr>
              <th scope="col">Lesson</th>
              <th scope="col">Taught in</th>
              <th scope="col" className="num">Guarded modules</th>
              <th scope="col" className="num">Pinning suites</th>
              <th scope="col">Suite coverage</th>
              <th scope="col">Full lesson</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((cell) => (
              <tr key={cell.lesson.id} data-count-gap={cell.gap < 0 ? "short" : "covered"}>
                <th scope="row">
                  <span className={styles.lessonIdentity}>
                    <span className={styles.lessonNumber} aria-hidden="true">
                      {String(cell.ordinal).padStart(2, "0")}
                    </span>
                    <span>{cell.lesson.title}</span>
                  </span>
                </th>
                <td>{sectionLabel(cell.lesson.pane)}</td>
                <td className="num">{cell.modules}</td>
                <td className="num">{cell.suites}</td>
                <td>
                  <span className={styles.coverageReading}>
                    <span aria-hidden="true">{cell.gap < 0 ? "▲" : "✓"}</span>
                    {coverageLabel(cell)}
                  </span>
                </td>
                <td>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={styles.inspectAction}
                    onClick={() => onInspect(cell.lesson)}
                    aria-label={`Inspect ${cell.lesson.title}`}
                  >
                    Inspect
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Figure>
  );
}
