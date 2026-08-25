"use client";

/**
 * The numbers a section answers in, before any drawing — one treatment, on
 * every section of the tab.
 *
 * FOUR SECTIONS HAD ONE AND FOUR DID NOT, which is the alignment complaint in
 * its most measurable form. Lattice, Stake, Fees and Status each built a
 * `<dl className="coh-status__facts">` by hand; Universe boxed its tiles with a
 * modifier declared in `14t-quotes-layout.css` and scoped to that section
 * alone; Books folded five figures into a disclosure; Settlement and Makers
 * spent a chip row on the same job, and chips are `white-space: nowrap` pills
 * that carry a STATE rather than a measurement. A reader moving down the rail
 * met four different objects answering the same question.
 *
 * So the row is a component. `.coh-status__facts` stays exactly what it is —
 * the plane's 140px auto-fit tile grid, shared with the Proofs tab — and
 * `.coh-facts--boxed` is promoted out of the Universe-only scope onto every
 * Markets section, because the tiles float between bordered figures everywhere,
 * not only there.
 *
 * NULL HONESTY IS STRUCTURAL HERE, not a habit each caller has to remember.
 * A reading the read did not carry is `value: null`, and a null is never
 * printed as a dash in the grid: six dashes each carrying the same sentence is
 * what `StakePane` found and fixed by hand, so the withheld ones are dropped
 * from the tiles and NAMED ONCE underneath. That inline implementation is the
 * shape this generalises; nothing about it is new except that seven other
 * sections now get it without writing it.
 *
 * A reading that has a value AND a caveat keeps both: `note` rides under the
 * figure in the tile, because "0.0000, and the venue looked" is a different
 * fact from "0.0000".
 *
 * AND A WITHHELD READING KEEPS ITS OWN REASON WHEN THE READ GAVE ONE. The
 * grouped sentence is right for six figures one solve did not return — that is
 * one fact about one solve. It is wrong for `Priced from`, whose absence means
 * "neither side of the book was quoted", which is a fact about the BOOK and
 * the most informative thing on the row. So a reading may carry `withheld`,
 * and those are said one line each; the rest share the sentence. Collapsing
 * the two would trade a specific reason for a tidier row, which is the trade
 * this codebase refuses everywhere else.
 */

import { type ReactNode } from "react";

export interface Reading {
  /** What the figure is, in the tile's label slot. */
  label: string;
  /**
   * The figure, or null when this read did not carry it.
   *
   * Null is WITHHELD, never zero and never a dash in the grid — see the header.
   * A caller with a dash already in hand (`decimalLabel` returns one) should
   * map it to null rather than passing the glyph through, so the row can tell
   * "we do not know" from a measurement whose printed form is short.
   */
  value: string | null;
  /**
   * Why this reading is absent, in the read's own words. Read only when
   * `value` is null, and when present it replaces the grouped sentence for
   * this one reading — see the header.
   */
  withheld?: string;
  /**
   * One clause under the figure, when the figure alone would mislead.
   *
   * A node and not a string, because the ones that matter carry a mark: a
   * warning said in colour alone is the house rule this desk holds hardest,
   * and a mark in a plain string would be read out as its Unicode name.
   */
  note?: ReactNode;
}

export interface KpiRowProps {
  readings: readonly Reading[];
  /**
   * What the withheld sentence calls this read, so it names the solve, the
   * poll or the replay rather than saying "this read" on all eight sections.
   */
  source?: string;
}

export default function KpiRow({ readings, source = "this read" }: KpiRowProps) {
  const known = readings.filter((reading) => reading.value !== null);
  const absent = readings.filter((reading) => reading.value === null);
  const explained = absent.filter((reading) => reading.withheld);
  const grouped = absent.filter((reading) => !reading.withheld);

  if (!known.length && !absent.length) return null;

  return (
    <>
      {known.length ? (
        <dl className="coh-status__facts coh-facts--boxed">
          {known.map((reading) => (
            <div key={reading.label}>
              <dt>{reading.label}</dt>
              <dd>{reading.value}</dd>
              {reading.note ? <p className="coh-kpi__note">{reading.note}</p> : null}
            </div>
          ))}
        </dl>
      ) : null}

      {explained.map((reading) => (
        <p className="coh-kpi__withheld" key={reading.label}>
          <span aria-hidden="true">◌</span> {reading.label}: {reading.withheld}.
        </p>
      ))}

      {grouped.length ? (
        <p className="coh-kpi__withheld">
          <span aria-hidden="true">◌</span>{" "}
          {grouped.map((reading) => reading.label.toLowerCase()).join(", ")}{" "}
          {grouped.length === 1 ? "was" : "were"} not returned by {source}, so{" "}
          {grouped.length === 1 ? "it is" : "they are"} left off the row above rather than shown as zero.
        </p>
      ) : null}
    </>
  );
}
