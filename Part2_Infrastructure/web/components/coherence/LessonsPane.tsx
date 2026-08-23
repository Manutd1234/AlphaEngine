"use client";

/**
 * The lessons, each naming the code it is about and the test that holds it.
 *
 * Rendered from `lib/coherence/lessons.ts` rather than written here, so the
 * catalogue is data one test can walk. The "what breaks it" line is always open
 * — folding the failure mode behind a disclosure would leave the confident half
 * on screen and hide the half that stops a reader over-applying it.
 *
 * A lesson whose slice has not landed is shown as pending rather than omitted.
 * A curriculum that silently lists only what is finished cannot be read as a
 * plan, and the gap is the honest part.
 */

import { COHERENCE_LESSONS, type CoherenceLesson } from "@/lib/coherence/lessons";

function LessonCard({ lesson }: { lesson: CoherenceLesson }) {
  return (
    <article className={`coh-lesson ${lesson.shipped ? "" : "is-pending"}`}>
      <header className="coh-lesson__head">
        <h4>{lesson.title}</h4>
        <span className="coh-lesson__state">
          <span aria-hidden="true">{lesson.shipped ? "✓" : "◌"}</span>{" "}
          {lesson.shipped ? "shipped" : "not built yet"}
        </span>
      </header>

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

      <details className="coh-lesson__mechanics">
        <summary>Which code carries this, and which test holds it</summary>
        <ul>
          {lesson.guards.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
          {lesson.pinnedBy.map((path) => (
            <li key={path}>
              pinned by <code>{path}</code>
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export default function LessonsPane() {
  const shipped = COHERENCE_LESSONS.filter((lesson) => lesson.shipped).length;
  return (
    <div className="coh-lessons">
      <p className="coh-lessons__intro">
        Each lesson names the module it is about and the test that would go red if it stopped being true. {shipped} of{" "}
        {COHERENCE_LESSONS.length} are built
        {shipped < COHERENCE_LESSONS.length
          ? "; the rest are listed because a curriculum that hides what is unfinished cannot be read as a plan."
          : ", and each one runs as a notebook under notebooks/coherence_lab that executes against these same modules."}
      </p>
      <div className="coh-lessons__grid">
        {COHERENCE_LESSONS.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} />
        ))}
      </div>
    </div>
  );
}
