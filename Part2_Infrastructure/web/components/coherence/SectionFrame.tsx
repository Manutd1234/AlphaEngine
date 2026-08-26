"use client";

/**
 * The shape every Markets section has, made structural instead of remembered.
 *
 * "some tabs are not good enough, too cluttered and the information is all over
 *  the place / help me make sure the formatting, the alignment are all uniform"
 *
 * WHAT WAS ACTUALLY DIFFERENT, measured across the eight sections rather than
 * argued. Each drew the same four things in a different order, in a different
 * box, or not at all:
 *
 *   the control row   `.coh-status__chips` on Lattice, Stake and Fees; a
 *                     `.coh-universe__controls` on Universe; a bare `.seg` on
 *                     Books, Makers, Settlement and Shell — and Fees drew TWO
 *                     rows, the second holding a chip.
 *   the KPI row       a hand-built `<dl>` on Lattice and Stake, boxed only on
 *                     Universe by a modifier scoped to that one section, a chip
 *                     row on Settlement and Shell, a disclosure on Books.
 *   the drawings      after a paragraph on three sections, after a breadcrumb
 *                     on one, immediately on four.
 *   the folded prose  four different summary voices, two of them uncounted.
 *
 * None of that is visible in any one file, which is exactly why it survived
 * five restructures: a reader meets it by moving DOWN the rail, and no author
 * ever has two sections open at once.
 *
 * So the order is the component's, not the caller's: head, one control row,
 * the numbers, the drawings, the folded prose. A section cannot put its KPI row
 * under its figures or grow a second control row without deleting this frame,
 * and deleting it is a thing a diff shows.
 *
 * THE HEAD IS A SLOT AND NOT A PROP, and that is deliberate rather than
 * incidental. `coherence-pane-head.test.ts` reads each SECTION's own source for
 * the shared head, its heading id and the `aria-labelledby` that pairs them —
 * across three tabs, of which this is one. Rendering `PaneHead` in here would
 * move those three facts out of the files that suite reads, so a Markets
 * section would have to be excused from a guard the other two tabs still keep.
 * A slot keeps the head where it is asserted and still gets the frame's order,
 * and it costs the caller one line it was already writing.
 *
 * It also carries the empty branch for free: a section with nothing to draw
 * passes `<PaneHeadEmpty>` in the same slot and omits the rest.
 *
 * ONE `.seg`, AND IT IS THIS ONE. Every section used to build its own, and
 * `markets-sections.test.ts` held the count at one per file with a regex — a
 * check that could be satisfied by deleting a switcher as easily as by keeping
 * the rule. The switcher is here now, so the count is zero in every section and
 * one in the frame, which is the same rule asserted where it cannot be met by
 * accident. A section with fewer than two views draws none at all: one option
 * is not a choice.
 */

import { type ReactNode } from "react";

import KpiRow, { type Reading } from "./KpiRow";

export interface SectionFrameProps<V extends string> {
  /**
   * The section's own class — `coh-universe`, `coh-books`. Kept beside
   * `.coh-section` rather than replaced by it: eleven rules across four
   * partials still select on these, and the shared class carries the rhythm
   * they never had.
   */
  className: string;
  /** The heading id this card is labelled by. Written by the section, so the head guard can read it there. */
  "aria-labelledby": string;
  /** `<PaneHead>` or `<PaneHeadEmpty>`, rendered by the section itself. */
  head: ReactNode;
  /** The views, in the order they are pressed. Fewer than two draws no switcher. */
  views?: ReadonlyArray<readonly [V, string]>;
  view?: V;
  onView?: (next: V) => void;
  /** The switcher's accessible name — "Books view", "Which question". */
  viewsLabel?: string;
  /**
   * What every view here is a question ABOUT: a family picker, a market picker,
   * an asset filter. Right of the switcher on one row, never under it.
   */
  subject?: ReactNode;
  /** The numbers the section answers in, before any drawing. */
  kpis?: readonly Reading[];
  /** What the withheld sentence calls this read — "this solve", "this poll". */
  kpiSource?: string;
  /**
   * Prose that survives, folded, with a summary that NAMES AND COUNTS what is
   * inside so nobody opens it to find out how big it is.
   */
  notes?: { summary: string; body: ReactNode } | null;
  /**
   * The grid the drawings sit in — `14y-engine-grid.css`'s family. Wraps
   * CHILDREN ONLY: the head stays a slot (see above), the control row and the
   * KPI row keep their places, and the folded prose stays last. A section
   * whose views lay out differently draws `.coh-grid` itself inside children.
   */
  layout?: "2" | "3" | "aside" | "lead";
  children?: ReactNode;
}

export default function SectionFrame<V extends string>({
  className,
  "aria-labelledby": labelledBy,
  head,
  views,
  view,
  onView,
  viewsLabel,
  subject,
  kpis,
  kpiSource,
  notes,
  layout,
  children,
}: SectionFrameProps<V>) {
  const switcher = views && views.length > 1 && view !== undefined && onView;
  const controls = Boolean(switcher || subject);

  return (
    <section className={`card console-card coh-section ${className}`} aria-labelledby={labelledBy}>
      {head}

      {controls ? (
        <div className="coh-section__controls">
          {switcher ? (
            <div className="seg" role="group" aria-label={viewsLabel}>
              {views!.map(([name, label]) => (
                <button key={name} type="button" aria-pressed={view === name} onClick={() => onView!(name)}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            // A spacer, so a section with a subject and no switcher puts its
            // picker where every other section's picker is. Without it the lone
            // control lands hard left under a `space-between` row and the rail
            // reads as if a switcher had gone missing.
            <span />
          )}
          {subject ? <div className="coh-section__subject">{subject}</div> : null}
        </div>
      ) : null}

      {kpis?.length ? <KpiRow readings={kpis} source={kpiSource} /> : null}

      {layout ? <div className={`coh-grid coh-grid--${layout}`}>{children}</div> : children}

      {notes ? (
        <details className="disclosure">
          <summary>{notes.summary}</summary>
          {notes.body}
        </details>
      ) : null}
    </section>
  );
}
