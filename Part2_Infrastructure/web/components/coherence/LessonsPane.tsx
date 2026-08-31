"use client";

/**
 * The lessons, each naming the code it is about and the test that holds it.
 *
 * Rendered from `lib/coherence/lessons.ts` rather than written here, so the
 * catalogue is data one test can walk. The "what breaks it" line is always open
 * — folding the failure mode behind a disclosure would leave the confident half
 * on screen and hide the half that stops a reader over-applying it.
 *
 * The catalogue ran to about 1,700px at desk width and about 3,300px below
 * 1100px, where the grid drops to one column, so the section shows one group at
 * a time. The cut is `group` on each lesson, never a list in here: a fifteenth
 * lesson added to the data appears in its view without this file changing, and
 * cannot end up in no view at all.
 *
 * The head's note stays outside the switcher: it counts the WHOLE catalogue.
 * The coverage strip WAS outside too, for the same argument — until the second
 * pass of 2026-08-24, when it became the switcher's first view and the
 * default. What changed is not the argument but the layout it argued against:
 * outside, the strip stacked a full figure over every group's cards and the
 * section opened two screens tall, which is the review's exact complaint. As
 * a PEER view it no longer sits beside cards it could contradict — it is the
 * only thing on screen, its caption says it maps both rails, and it is the
 * default because "what does the curriculum cover" is the section's headline
 * question. It is still drawn from `pane`, so a section nobody teaches is a
 * column with a mark in it, not a column missing.
 *
 * THE FOUR GROUP VIEWS DRAW SOMETHING (fourth review of 2026-08-24, "a drawing
 * of the numbers in every subtab"). Coverage was the only view here with a
 * figure and the other four opened on a grid of prose cards. `GroupPins` is
 * its own file since 2026-08-25 and compares BOTH quantities a group of lessons
 * has — the modules each lesson is about against the suites that hold it. The
 * comparison is tabular so every lesson name remains readable; exact paths stay
 * in the numbered detail Sheet, so the overview remains the reading rather than
 * a second copy of the evidence.
 *
 * A lesson whose slice has not landed is shown as pending rather than omitted.
 * A curriculum that silently lists only what is finished cannot be read as a
 * plan, and the gap is the honest part.
 */


import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { COHERENCE_LESSONS, LESSON_GROUPS, type CoherenceLesson, type LessonGroup } from "@/lib/coherence/lessons";
import type { WorkspaceView } from "@/lib/workspace-nav";

import { StateChip } from "./Figure";
import GroupPins, { sectionLabel } from "./GroupPins";
import LessonCoverage from "./LessonCoverage";
import LessonFigure from "./lesson-figures";
import PaneHead from "./PaneHead";
import ViolationStates from "./ViolationStates";
import ProofsViewControl from "./ProofsViewControl";

function PathList({ paths }: { paths: string[] }) {
  return (
    <ul>
      {paths.map((path) => (
        <li key={path}>
          <code>{path}</code>
        </li>
      ))}
    </ul>
  );
}

function LessonDetailSection({
  number,
  title,
  id,
  children,
}: {
  number: string;
  title: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <section className="coh-lesson-detail__section" aria-labelledby={id}>
      <header className="coh-lesson-detail__section-head">
        <span className="coh-lesson-detail__section-number" aria-hidden="true">{number}</span>
        <h3 id={id}>
          <span className="sr-only">Section {number}: </span>
          {title}
        </h3>
      </header>
      <div className="coh-lesson-detail__section-body">{children}</div>
    </section>
  );
}

function LessonDetail({ lesson }: { lesson: CoherenceLesson }) {
  const ordinal = COHERENCE_LESSONS.findIndex((entry) => entry.id === lesson.id) + 1;
  const groupLabel = LESSON_GROUPS.find((entry) => entry.id === lesson.group)?.label ?? lesson.group;
  const sectionId = (name: string) => `coh-lesson-${lesson.id}-${name}`;

  return (
    <article className={`coh-lesson-detail ${lesson.shipped ? "" : "is-pending"}`}>
      <SheetHeader className="coh-lesson-detail__header">
        <p className="coh-lesson-detail__eyebrow">
          Lesson {String(ordinal).padStart(2, "0")} of {COHERENCE_LESSONS.length}, {groupLabel}
        </p>
        <SheetTitle>{lesson.title}</SheetTitle>
        <SheetDescription className="sr-only">{lesson.summary}</SheetDescription>
        <div className="coh-status__chips">
          <StateChip mark="◇" word="Taught in" value={sectionLabel(lesson.pane)} tone="muted" />
          <StateChip
            mark={lesson.shipped ? "✓" : "◌"}
            word="Status"
            value={lesson.shipped ? "shipped" : "not built yet"}
            tone={lesson.shipped ? "good" : "muted"}
          />
        </div>
      </SheetHeader>

      <div className="coh-lesson-detail__body">
        <LessonDetailSection number="01" title="Claim" id={sectionId("claim")}>
          <p className="coh-lesson-detail__claim">{lesson.summary}</p>
          {lesson.formula ? (
            <code className="coh-lesson__formula">{lesson.formula}</code>
          ) : (
            <p className="coh-lesson-detail__no-formula">Conceptual claim; no standalone formula.</p>
          )}
        </LessonDetailSection>

        <LessonDetailSection number="02" title="Technical model" id={sectionId("model")}>
          <LessonFigure id={lesson.id} />
        </LessonDetailSection>

        <LessonDetailSection number="03" title="Proof conditions" id={sectionId("conditions")}>
          <div className="table-wrap coh-lesson__criteria-wrap">
            <table className="coh-table coh-lesson__criteria">
              <caption className="coh-table__caption sr-only">Proof conditions</caption>
              <thead>
                <tr>
                  <th scope="col">Condition</th>
                  <th scope="col">Technical reading</th>
                </tr>
              </thead>
              <tbody>
                <tr className="is-holds">
                  <th scope="row">When it holds</th>
                  <td>{lesson.whenItHolds}</td>
                </tr>
                <tr className="is-fails">
                  <th scope="row">What breaks it</th>
                  <td>{lesson.whenItFails}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </LessonDetailSection>

        <LessonDetailSection number="04" title="Code and test evidence" id={sectionId("evidence")}>
          <div className="table-wrap">
            <table className="coh-table">
              <caption className="coh-table__caption sr-only">Implementation and guard paths</caption>
              <tbody>
                <tr>
                  <th scope="row">Carried by</th>
                  <td><PathList paths={lesson.guards} /></td>
                </tr>
                <tr>
                  <th scope="row">Pinned by</th>
                  <td><PathList paths={lesson.pinnedBy} /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </LessonDetailSection>
      </div>
    </article>
  );
}

function LessonIndexCard({ lesson, onOpen }: { lesson: CoherenceLesson; onOpen: () => void }) {
  return (
    <tr
      className={`coh-lesson-index-card ${lesson.shipped ? "" : "is-pending"}`}
      data-lesson-id={lesson.id}
    >
      <th scope="row">
        <strong className="console-subhead">{lesson.title}</strong>
      </th>
      <td>
        <span className="coh-lesson__state">
          <span aria-hidden="true">{lesson.shipped ? "✓" : "◌"}</span>{" "}
          {lesson.shipped ? "shipped" : "not built yet"}
        </span>
      </td>
      <td>{sectionLabel(lesson.pane)}</td>
      <td className="coh-lesson__summary">{lesson.summary}</td>
      <td>
        {lesson.formula ? (
          <code className="coh-lesson__formula" data-lesson-formula>{lesson.formula}</code>
        ) : <span className="muted">No formula</span>}
      </td>
      <td>
        <Button type="button" variant="outline" size="sm" onClick={onOpen} data-lesson-action>
          Inspect lesson
          <span aria-hidden="true">→</span>
        </Button>
      </td>
    </tr>
  );
}

export type LessonsView = LessonGroup | "coverage" | "states";

/**
 * The switcher, as [id, label] pairs in press order: the four curriculum
 * slices from the data, then the two views ABOUT the catalogue. One array so
 * `section-views.test.ts` can hold `lib/section-views.ts` to it — and the
 * default is Coverage, which is NOT first: `DEFAULTS` there records the
 * exception, and the test pins it.
 */
export const LESSONS_VIEWS: ReadonlyArray<readonly [LessonsView, string]> = [
  ...LESSON_GROUPS.map((entry) => [entry.id, entry.label] as const),
  ["coverage", "Coverage"],
  ["states", "Episode states"],
];

export default function LessonsPane({ view, onView, onOpenSection }: {
  /** Owned by the console: a view is an address. See `lib/section-views.ts`. */
  view: LessonsView;
  onView: (next: LessonsView) => void;
  /** Opens a section on any tab; wired by the coverage figure's link in a later slice. */
  onOpenSection?: (tab: WorkspaceView, section?: string) => void;
}) {
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const shipped = COHERENCE_LESSONS.filter((lesson) => lesson.shipped).length;
  const group = LESSON_GROUPS.find((entry) => entry.id === view) ?? LESSON_GROUPS[0];
  const inView = COHERENCE_LESSONS.filter((lesson) => lesson.group === group.id);
  const selectedLesson = COHERENCE_LESSONS.find((lesson) => lesson.id === selectedLessonId) ?? null;

  return (
    <section className="card console-card coh-lessons" aria-labelledby="coherence-lessons-heading">
      <PaneHead
        kicker="Lessons"
        title="Claim-to-test guard graph"
        id="coherence-lessons-heading"
        note={`${shipped} of ${COHERENCE_LESSONS.length} built`}
        ledeSummary="Curriculum contract"
        lede={
          shipped < COHERENCE_LESSONS.length
            ? "Each lesson links its module and failing test; unbuilt lessons stay listed."
            : "Each lesson links its module and failing test, then runs that module as a notebook under notebooks/coherence_lab."
        }
      />

      {/* One `.seg`, not a nested `<WorkspaceSubtabs>`: a second rail instance
          fights the first over the `--rail-h` publisher, as CoherenceConsole's
          header records. The group views come from the data, so this control
          cannot offer a group that holds nothing or omit one that does;
          Coverage is the one hand-written peer, and it is the map of the
          whole catalogue rather than another slice of it. */}
      {/* Pinned (`14u`), and this is the section that most needed it: six
          buttons over a card grid that runs past a screen, so choosing another
          group meant scrolling back to the head to reach the control. NO
          VERDICT BAND HERE, unlike the other five — a curriculum produces a
          catalogue rather than an answer, and a band summarising one would be a
          frame around the head's own count. */}
      <div className="coh-bar">
      {/* THE CURRICULUM FIRST, THEN THE TWO VIEWS ABOUT IT — reordered
          2026-08-26, and the reason is that the row held two kinds of thing in
          one undifferentiated list. "segregate the content better."

          Four of these buttons open a SLICE of the catalogue: Quotes,
          Structure, Bounds, Record, each a set of lesson cards. The other two
          are about the catalogue rather than in it — Coverage is the map of
          which section teaches what, and Episode states is the vocabulary every
          lesson is written in. A reader met them mixed, with the two
          about-the-catalogue views leading, and nothing in the row said which
          kind a button was.

          Order is the only signal a single `.seg` can carry, and one row per
          section is the rule this rail keeps — so the four slices lead and the
          two that describe them follow. The default stays Coverage: opening on
          the map is right, and where the map SITS in the row is a separate
          question from what opens first. */}
      <ProofsViewControl
        className="seg"
        label="Lessons view"
        options={LESSONS_VIEWS}
        value={view}
        onValue={onView}
      />
        {/* Six buttons from one array: the four slices, then Coverage, then
            Episode states — the vocabulary the whole catalogue is written in,
            its own peer rather than a card because it defines the objects the
            other views make claims ABOUT. */}
      </div>

      {view === "coverage" ? (
        <LessonCoverage onOpenSection={onOpenSection} />
      ) : view === "states" ? (
        <ViolationStates />
      ) : (
        <section className="coh-lessons__catalogue" aria-labelledby={`coh-lessons-${group.id}`}>
          <div className="section-heading compact">
            <div>
              <h3 id={`coh-lessons-${group.id}`}>{group.label}</h3>
              <p className="coh-lessons__intro">{group.description}.</p>
            </div>
            <span className="section-note">
              {inView.length} of {COHERENCE_LESSONS.length} lessons
            </span>
          </div>

          <GroupPins lessons={inView} onInspect={(lesson) => setSelectedLessonId(lesson.id)} />

          <div
            className="table-wrap coh-lessons__grid"
            data-lessons-grid
            role="region"
            aria-label={`${group.label} lesson catalogue`}
            tabIndex={0}
          >
            <table className="coh-table coh-lessons__table">
              <caption className="coh-table__caption sr-only">{group.label} lesson catalogue</caption>
              <thead>
                <tr>
                  <th scope="col">Lesson</th>
                  <th scope="col">Status</th>
                  <th scope="col">Taught in</th>
                  <th scope="col">Technical reading</th>
                  <th scope="col">Formula</th>
                  <th scope="col"><span className="sr-only">Open detail</span></th>
                </tr>
              </thead>
              <tbody>
                {inView.map((lesson) => (
                  <LessonIndexCard
                    key={lesson.id}
                    lesson={lesson}
                    onOpen={() => setSelectedLessonId(lesson.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Sheet
        open={Boolean(selectedLesson)}
        onOpenChange={(open) => {
          if (!open) setSelectedLessonId(null);
        }}
      >
        <SheetContent className="w-[min(52rem,calc(100vw-1rem))] min-[521px]:max-w-none">
          <div className="coherence-plane proofs-plane coh-lesson-sheet">
            {selectedLesson ? <LessonDetail lesson={selectedLesson} /> : null}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
