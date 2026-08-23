"use client";

/**
 * A section whose engine has not shipped, saying so in full.
 *
 * The alternative — hiding the rail entry until the slice lands — was rejected
 * because the rail is the argument's outline. A reader who can see that the
 * certificate pane exists and is not built yet understands the shape of the
 * thing being built; a reader shown five sections has no way to tell whether
 * the other three were finished, abandoned or never planned.
 *
 * So each pending pane states what it will show, what has to exist first, and
 * which lesson it carries. What it never does is render an empty chart frame:
 * an axis with nothing on it and an axis whose data failed to load look
 * identical, and one of those is a fault.
 */

import { COHERENCE_LESSONS } from "@/lib/coherence/lessons";

export interface PendingPaneProps {
  /** What this section will show once its engine lands. */
  purpose: string;
  /** The work it waits on, in the order it will be done. */
  waitingOn: string[];
  /** Lesson ids this pane will carry. */
  lessons: string[];
}

export default function PendingPane({ purpose, waitingOn, lessons }: PendingPaneProps) {
  const carried = COHERENCE_LESSONS.filter((lesson) => lessons.includes(lesson.id));
  return (
    <div className="coh-pending">
      <p className="coh-pending__lead">
        <span aria-hidden="true">◌</span> Not built yet. {purpose}
      </p>

      <div className="coh-pending__cols">
        <section>
          <h4>What has to exist first</h4>
          <ol className="coh-pending__steps">
            {waitingOn.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {carried.length ? (
          <section>
            <h4>The lesson this section carries</h4>
            <ul className="coh-pending__lessons">
              {carried.map((lesson) => (
                <li key={lesson.id}>
                  <strong>{lesson.title}.</strong> {lesson.summary}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
