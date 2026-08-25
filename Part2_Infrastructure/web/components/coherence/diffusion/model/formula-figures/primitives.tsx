"use client";

/**
 * The four shapes thirteen formula cards are drawn with.
 *
 * WHY A FIGURE PER CARD AT ALL. `Measurement` and `Instrument` were the two
 * longest views on the desk and the only two that drew NOTHING — 1,260px and
 * 910px of prose apiece, measured by `scripts/section-density-measure.mjs`. A
 * card said what an expression computes and what breaks it, and a reader had no
 * way to see either.
 *
 * WHAT EACH FIGURE DRAWS IS THE MECHANISM, AND WHERE IT FITS, THE FAILURE the
 * card's own `breaks` clause names — the linear crossing landing somewhere the
 * log one does not, the asymptote walked upward by the wrong scoring, the
 * whitened spectrum collapsing to a single bump. A drawing of the confident
 * half only would be decoration; the boundary is the part a reader cannot
 * reconstruct from the formula.
 *
 * NO HOVER MARKS ON ANY OF THEM, deliberately, and this is the one place on the
 * tab where that is right. `Plot` promotes every SVG title element into a
 * walkable mark, which is what the data figures want — but these are diagrams
 * of an argument rather than readings of a measurement. There is nothing to
 * interrogate: every word is already ON the drawing, and thirteen cards
 * carrying marks would put seven extra tab stops in Measurement alone to
 * re-read labels a reader can already see. The frame carries one `aria-label`
 * that says the whole thing instead, and the guard in
 * `diffusion-model-views.test.ts` holds these three files to it.
 *
 * TYPE COMES FROM CLASSES, NEVER AN INLINE SIZE. `type-diagram-ladder.test.ts`
 * caps inline diagram sizes above the compact prose rung, and the cap MAY FALL
 * AND MAY NOT RISE. Both rungs above that floor were at their ceiling exactly
 * when these were written — thirteen at twenty-six of twenty-six, fourteen at
 * six of six — so one new inline size anywhere in this directory would have
 * turned the suite red. Every label here is `.coh-ladder__tick`, the desk's
 * 10px SVG floor. (Spelt in words on purpose: that suite counts the literal
 * wherever it appears, comments included, and a note about the budget should
 * not spend it.)
 */

import { type ReactNode } from "react";

export const W = 260;
export const H = 96;

/**
 * The fixed frame every card figure draws in.
 *
 * `preserveAspectRatio` is left at its default, so the drawing scales
 * uniformly and letterboxes rather than stretching its text — the defect the
 * whole engine's figures were rebuilt to avoid. `role="img"` with a sentence,
 * because the marks inside carry no names of their own.
 */
export function Frame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="diff-cardfig">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={label}>
        {children}
      </svg>
    </div>
  );
}

/** A polyline through unit-space points, mapped into the frame's box. */
export function path(points: ReadonlyArray<readonly [number, number]>, box = BOX): string {
  return points
    .map(([px, py], i) => `${i ? "L" : "M"}${x(px, box).toFixed(1)},${y(py, box).toFixed(1)}`)
    .join("");
}

/**
 * The plot box every primitive draws inside.
 *
 * The margins are the label gutters: one row of 10px words above the plot and
 * one below it, and a left gutter for the y word. Nothing is drawn outside
 * them — the frame CLIPS, so a label that would overrun is a bug visible here
 * rather than one that silently prints over the next card.
 */
export const BOX = { left: 30, right: 10, top: 20, bottom: 22 } as const;

export function x(unit: number, box = BOX): number {
  return box.left + unit * (W - box.left - box.right);
}
export function y(unit: number, box = BOX): number {
  return H - box.bottom - unit * (H - box.top - box.bottom);
}

/** A horizontal reference rule with its word sitting above the left end. */
export function Rule({ at, word, kind = "half" }: { at: number; word?: string; kind?: "half" | "mark" }) {
  return (
    <>
      <line
        className={kind === "half" ? "coh-survival__half" : "coh-survival__median"}
        x1={x(0)} x2={x(1)} y1={y(at)} y2={y(at)}
      />
      {word ? <text className="coh-ladder__tick" x={x(0) + 2} y={y(at) - 3}>{word}</text> : null}
    </>
  );
}

/** A vertical rule at a unit x, with its word under the axis. */
export function Marker({ at, word, dashed = false }: { at: number; word?: string; dashed?: boolean }) {
  return (
    <>
      <line
        className={dashed ? "coh-survival__half" : "coh-survival__median"}
        x1={x(at)} x2={x(at)} y1={y(1)} y2={y(0)}
      />
      {word ? <text className="coh-ladder__tick" x={x(at)} y={H - 6} textAnchor="middle">{word}</text> : null}
    </>
  );
}

/** The baseline and left upright every figure shares. */
export function Axes({ yWord }: { yWord?: string }) {
  return (
    <>
      <line className="coh-ladder__axis" x1={x(0)} x2={x(1)} y1={y(0)} y2={y(0)} />
      {yWord ? (
        <text className="coh-ladder__tick" x={2} y={y(1) + 4}>{yWord}</text>
      ) : null}
    </>
  );
}

/**
 * The wrong version, drawn beside the right one.
 *
 * Always dashed AND always labelled: the difference between the two curves is
 * the card's whole point, and a reader who cannot separate two greys still has
 * to be able to tell which one is the mistake.
 */
export function Wrong({ d, word, at }: { d: string; word: string; at?: readonly [number, number] }) {
  return (
    <>
      <path className="diff-cardfig__wrong" d={d} fill="none" />
      {at ? (
        <text className="coh-ladder__tick" x={x(at[0])} y={y(at[1])} textAnchor="middle">{word}</text>
      ) : null}
    </>
  );
}

/** A shaded region between two unit x values. */
export function Band({ from, to, word }: { from: number; to: number; word?: string }) {
  return (
    <>
      <rect
        className="diff-effect__band"
        x={x(from)} y={y(1)} width={Math.max(0, x(to) - x(from))} height={y(0) - y(1)}
      />
      {word ? (
        <text className="coh-ladder__tick" x={(x(from) + x(to)) / 2} y={y(1) + 9} textAnchor="middle">
          {word}
        </text>
      ) : null}
    </>
  );
}
