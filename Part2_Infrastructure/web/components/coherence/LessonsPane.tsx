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
 * its own file since 2026-08-25 and draws BOTH quantities a group of lessons
 * has — the modules each lesson is about against the suites that hold it — as
 * a dumbbell, because the catalogue's claim is a ratio between them and one bar
 * drew half of it. The cards' own path lists stay behind each card's mechanics
 * summary; the strip is their reading, not a replacement.
 *
 * A lesson whose slice has not landed is shown as pending rather than omitted.
 * A curriculum that silently lists only what is finished cannot be read as a
 * plan, and the gap is the honest part.
 */

import { useState } from "react";

import { COHERENCE_LESSONS, LESSON_GROUPS, type CoherenceLesson, type LessonGroup } from "@/lib/coherence/lessons";

import { StateChip } from "./Figure";
import GroupPins, { sectionLabel } from "./GroupPins";
import LessonCoverage from "./LessonCoverage";
import LessonFigure from "./lesson-figures";
import PaneHead from "./PaneHead";
import ViolationStates from "./ViolationStates";

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

      {/* ALWAYS RENDERED, EVEN WHEN EMPTY, and that is the whole of the
          alignment fix. Two of the fifteen lessons carry no formula, so this
          slot used to be present on thirteen cards and absent on two — which
          gave the grid two different row COUNTS and made
          `grid-template-rows: subgrid` impossible to line up. An empty `<code>`
          still claims its row line, so the tallest formula in a row sets the
          height for every card beside it and everything below starts level.
          `:empty` drops its box in the stylesheet, so a lesson without one
          shows blank space rather than an empty grey chip. */}
      <code className="coh-lesson__formula">{lesson.formula ?? ""}</code>

      {/* Four of the fourteen make a claim about a SHAPE, and for those the
          formula is the part a reader can already read. Every lesson has a
          figure since 2026-08-25, so this slot is always filled too — which is
          the other half of the fixed row count. */}
      <LessonFigure id={lesson.id} />

      {/* BOTH HALVES STAY OPEN, and that was re-tested rather than assumed.
          The same fold that halved the Model group's formula wall was tried
          here — keep "what breaks it", hide "when it holds" — and MEASURED at
          2,198px to 2,109px, four per cent, because the hidden sentence is
          short and the summary line replacing it costs nearly as much. That is
          a click and a hidden half bought for nothing, so it was reverted. The
          height in these views is the summary, the formula and the figure, and
          hiding any of those would cost the card its subject. */}
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
        <div className="table-wrap">
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
        </div>
      </details>
    </article>
  );
}

export default function LessonsPane() {
  const [view, setView] = useState<LessonGroup | "coverage" | "states">("coverage");
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
            ? "Each lesson names the module it is about and the test that goes red if it stops being true; unbuilt ones are listed because a curriculum hiding unfinished work is not a plan."
            : "Each lesson names the module it is about and the test that goes red if it stops being true, and each runs as a notebook under notebooks/coherence_lab against the same modules."
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
      <div className="seg" role="group" aria-label="Lessons view">
        <button
          type="button"
          aria-pressed={view === "coverage"}
          onClick={() => setView("coverage")}
        >
          Coverage
        </button>
        {/* The vocabulary the whole catalogue is written in. Its own peer rather
            than a card, because it defines the objects the other views make
            claims ABOUT — an episode, its peak, its half-life, its lifetime. */}
        <button
          type="button"
          aria-pressed={view === "states"}
          onClick={() => setView("states")}
        >
          Episode states
        </button>
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
      </div>

      {view === "coverage" ? (
        <LessonCoverage />
      ) : view === "states" ? (
        <ViolationStates />
      ) : (
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

          <GroupPins lessons={inView} />

          <div className="coh-lessons__grid">
            {inView.map((lesson) => (
              <LessonCard key={lesson.id} lesson={lesson} />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
