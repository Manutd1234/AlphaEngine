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
 * THE FOUR GROUP VIEWS DRAW SOMETHING NOW (fourth review of 2026-08-24, "a
 * drawing of the numbers in every subtab"). Coverage was the only view here
 * with a figure and the other four opened on a grid of prose cards;
 * `GroupPins` below draws the one quantity a group of lessons actually has.
 * The cards' own path lists stay where they were, behind each card's mechanics
 * summary — the strip is their reading, not a replacement.
 *
 * A lesson whose slice has not landed is shown as pending rather than omitted.
 * A curriculum that silently lists only what is finished cannot be read as a
 * plan, and the gap is the honest part.
 */

import { useState } from "react";

import { COHERENCE_LESSONS, LESSON_GROUPS, type CoherenceLesson, type LessonGroup } from "@/lib/coherence/lessons";
import { ENGINE_SECTIONS } from "@/lib/sections";

import { StateChip } from "./Figure";
import LessonCoverage from "./LessonCoverage";
import PaneHead from "./PaneHead";
import ValueStrip from "./ValueStrip";

/** The rail's own label, so a card names the section as the reader sees it.
 *  BOTH rails since the split of 2026-08-24: the curriculum spans the engine
 *  and half the lessons are taught on Quotes, so looking a `pane` up in one
 *  tab's array would print the raw id for seven of the fourteen. */
const sectionLabel = (pane: string) =>
  ENGINE_SECTIONS.find((section) => section.id === pane)?.label ?? pane;

/**
 * How much test surface each lesson in the group rests on.
 *
 * Coverage was the only view here with a drawing, and the four GROUP views —
 * Prices, Structure, Bounds, Record — opened on a grid of prose cards. The
 * fourth review of 2026-08-24 asked for a drawing of the numbers in every
 * view, and the only numbers a group of lessons has are the two path lists on
 * each card: the modules a lesson is about, and the suites that go red if it
 * stops being true. The second is the one that RANKS — the catalogue's whole
 * claim is that these are enforced claims rather than notes beside the code,
 * so "how much would break" is the reading, and it is otherwise reachable only
 * by opening every card's mechanics disclosure and counting by eye.
 *
 * REFUSED: a bar per lesson of its summary's length, its formula's presence,
 * or shipped-versus-pending. The first two are drawings of the prose rather
 * than of anything measured, and the third is degenerate here — every lesson
 * in the catalogue is shipped, so it would be a row of identical bars claiming
 * to be a finding. A figure has to answer its view's own question or not be
 * drawn.
 */
function GroupPins({ lessons }: { lessons: CoherenceLesson[] }) {
  return (
    <ValueStrip
      caption="How many suites go red if each lesson stops being true"
      ariaLabel={`Pinning suites for each of the ${lessons.length} lessons in this group`}
      rows={lessons.map((lesson) => ({
        label: lesson.title,
        value: lesson.pinnedBy.length,
        text: `${lesson.pinnedBy.length} suite(s)`,
        title: `${lesson.title} — taught in ${sectionLabel(lesson.pane)}, carried by ${lesson.guards.length} module(s), pinned by ${lesson.pinnedBy.join(", ") || "nothing yet"}`,
        noBar: lesson.pinnedBy.length ? undefined : "not pinned yet",
      }))}
      missing="The bar counts SUITES, not assertions: a file that pins one lesson in forty places is one bar. It is a measure of how widely a claim is held, never of how deeply."
    />
  );
}

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
  const [view, setView] = useState<LessonGroup | "coverage">("coverage");
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
      <div className="seg" role="group" aria-label="Lessons view">
        <button
          type="button"
          aria-pressed={view === "coverage"}
          onClick={() => setView("coverage")}
        >
          Coverage
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

      {view === "coverage" ? (
        <LessonCoverage />
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
