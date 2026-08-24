"use client";

/**
 * The lessons, each naming the code it is about and the test that holds it.
 *
 * Rendered from `lib/coherence/lessons.ts` rather than written here, so the
 * catalogue is data one test can walk. The "what breaks it" line is always open
 * — folding the failure mode behind a disclosure would leave the confident half
 * on screen and hide the half that stops a reader over-applying it.
 *
 * Fourteen cards ran to about 1,700px at desk width and about 3,300px below
 * 1100px, where the grid drops to one column, so the section shows one group at
 * a time. The cut is `group` on each lesson, never a list in here: a fifteenth
 * lesson added to the data appears in its view without this file changing, and
 * cannot end up in no view at all.
 *
 * The intro and the coverage strip stay outside the switcher. Both are counts
 * of all fourteen, and inside a view they would contradict the cards beside
 * them. The strip is the one thing on this section that is about the shape of
 * the curriculum rather than its contents: it is drawn from `pane`, so a
 * section nobody teaches is a column with a mark in it, not a column missing.
 *
 * A lesson whose slice has not landed is shown as pending rather than omitted.
 * A curriculum that silently lists only what is finished cannot be read as a
 * plan, and the gap is the honest part.
 */

import { useState } from "react";

import { COHERENCE_LESSONS, LESSON_GROUPS, type CoherenceLesson, type LessonGroup } from "@/lib/coherence/lessons";
import { COHERENCE_SECTIONS } from "@/lib/sections";

import { StateChip } from "./Figure";
import LessonCoverage from "./LessonCoverage";
import PaneHead from "./PaneHead";

/** The rail's own label, so a card names the section as the reader sees it. */
const sectionLabel = (pane: string) =>
  COHERENCE_SECTIONS.find((section) => section.id === pane)?.label ?? pane;

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

function LessonCard({ lesson }: { lesson: CoherenceLesson }) {
  return (
    <article className={`coh-lesson ${lesson.shipped ? "" : "is-pending"}`}>
      <header className="coh-lesson__head">
        <h4 className="console-subhead">{lesson.title}</h4>
        <span className="coh-lesson__state">
          <span aria-hidden="true">{lesson.shipped ? "✓" : "◌"}</span>{" "}
          {lesson.shipped ? "shipped" : "not built yet"}
        </span>
      </header>

      {/* Which section teaches this. `pane` has been in the data since the
          catalogue was written and was rendered nowhere, so a reader who
          wanted the worked example had no way to find out where it was. */}
      <div className="coh-status__chips">
        <StateChip mark="◇" word="Taught in" value={sectionLabel(lesson.pane)} tone="muted" />
      </div>

      <p className="coh-lesson__summary">{lesson.summary}</p>

      {lesson.formula ? <code className="coh-lesson__formula">{lesson.formula}</code> : null}

      <dl className="coh-lesson__bounds">
        <div className="is-holds">
          <dt>When it holds</dt>
          <dd>{lesson.whenItHolds}</dd>
        </div>
        <div className="is-fails">
          <dt>What breaks it</dt>
          <dd>{lesson.whenItFails}</dd>
        </div>
      </dl>

      {/* A table, because the two lists are different kinds of path. As a flat
          list of <code> with "pinned by" in front of half of them, a module
          and a suite were told apart by one word of prose. */}
      <details className="coh-lesson__mechanics">
        <summary>Which code carries this, and which test holds it</summary>
        <table className="coh-table">
          <tbody>
            <tr>
              <th scope="row">Carried by</th>
              <td>
                <PathList paths={lesson.guards} />
              </td>
            </tr>
            <tr>
              <th scope="row">Pinned by</th>
              <td>
                <PathList paths={lesson.pinnedBy} />
              </td>
            </tr>
          </tbody>
        </table>
      </details>
    </article>
  );
}

export default function LessonsPane() {
  const [view, setView] = useState<LessonGroup>("prices");
  const shipped = COHERENCE_LESSONS.filter((lesson) => lesson.shipped).length;
  const group = LESSON_GROUPS.find((entry) => entry.id === view) ?? LESSON_GROUPS[0];
  const inView = COHERENCE_LESSONS.filter((lesson) => lesson.group === group.id);

  return (
    <section className="card console-card coh-lessons" aria-labelledby="coherence-lessons-heading">
      <PaneHead
        kicker="Lessons"
        title="The curriculum & what guards it"
        id="coherence-lessons-heading"
        note={`${shipped} of ${COHERENCE_LESSONS.length} built`}
        lede={
          shipped < COHERENCE_LESSONS.length
            ? "Each lesson names the module it is about and the test that would go red if it stopped being true. The unbuilt ones are listed because a curriculum hiding unfinished work cannot be read as a plan."
            : "Each lesson names the module it is about and the test that would go red if it stopped being true, and each runs as a notebook under notebooks/coherence_lab against those same modules."
        }
      />

      {/* Above the switcher, and deliberately outside it. The strip maps all
          fourteen lessons onto all eleven sections; drawn inside a view it
          would show a quarter of the map while looking like the whole of it,
          the same reason the intro's counts stay out here. */}
      <LessonCoverage />

      {/* One `.seg`, not a nested `<WorkspaceSubtabs>`: a second rail instance
          fights the first over the `--rail-h` publisher, as CoherenceConsole's
          header records. The groups come from the data, so this control cannot
          offer a view that holds nothing or omit one that does. */}
      <div className="seg" role="group" aria-label="Lessons view">
        {LESSON_GROUPS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={view === entry.id}
            onClick={() => setView(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <section aria-labelledby={`coh-lessons-${group.id}`}>
        <div className="section-heading compact">
          <div>
            <h3 id={`coh-lessons-${group.id}`}>{group.label}</h3>
            <p className="coh-lessons__intro">{group.description}.</p>
          </div>
          <span className="section-note">
            {inView.length} of {COHERENCE_LESSONS.length} lessons
          </span>
        </div>

        <div className="coh-lessons__grid">
          {inView.map((lesson) => (
            <LessonCard key={lesson.id} lesson={lesson} />
          ))}
        </div>
      </section>
    </section>
  );
}
