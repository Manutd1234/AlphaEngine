"use client";

/**
 * The five derived readings, grouped by what an EMPTY one means.
 *
 * The Commands view answered with a seven-row table whose third column — "when
 * it has no answer" — is the column that matters and the one the card cut off
 * at the right edge. That column is not five separate facts. It is one
 * distinction with three values, and the view's own caption already states it:
 * "a reading with no answer says which kind, because only one kind is worth
 * reading again."
 *
 * So the kinds are the drawing:
 *
 *   ALWAYS ANSWERS      `lattice` is built from the exchange's own metadata and
 *                       `books` reads an empty side as a dash — neither can come
 *                       back blank, so a blank one is a bug rather than an answer.
 *   NOT FOR THIS FAMILY `implied_pmf` needs a surface the books did not build and
 *                       `survival` needs a ladder of strikes this event does not
 *                       quote. Asking again reads the same family and gets the
 *                       same nothing.
 *   NOT IN THIS READ    `certificate` is solved on demand rather than for every
 *                       event listed. This is the one worth asking again, and it
 *                       is the whole reason the distinction is drawn.
 *
 * THE GROUPING IS DERIVED FROM THE TABLE, NEVER TYPED BESIDE IT. `DERIVED_FILES`
 * carries each reading's `silent` sentence and this reads the kind off it, so a
 * reading whose behaviour changes moves group on its own. A hand-kept second
 * list is the thing that drifts, and the table is already the one source the
 * reference under a listing reads.
 */

import { DERIVED_FILES } from "./ShellTree";
import Figure, { Plot } from "./Figure";

type Kind = "always" | "family" | "read";

const BAND: ReadonlyArray<{ kind: Kind; title: string; mark: string; means: string }> = [
  { kind: "always", title: "Always answers", mark: "●",
    means: "A blank one is a defect, not a reading." },
  { kind: "family", title: "Not for this family", mark: "○",
    means: "The family's own shape decides it. Asking again gets the same nothing." },
  { kind: "read", title: "Not in this read", mark: "◌",
    means: "Solved on demand. This is the one worth asking again." },
];

/** Which kind a reading's own `silent` sentence puts it in. */
export function kindOf(silent: string): Kind {
  if (/^Never\./.test(silent.trim())) return "always";
  if (/in this read/i.test(silent)) return "read";
  return "family";
}

const ROW_H = 26;
const HEAD_H = 22;
const PAD = 10;

export default function ShellReadings() {
  const grouped = BAND.map((band) => ({
    ...band,
    names: DERIVED_FILES.filter((file) => kindOf(file.silent) === band.kind).map((f) => f.name),
  }));
  const tallest = Math.max(...grouped.map((g) => g.names.length));
  const height = HEAD_H + tallest * ROW_H + 30;

  return (
    <Figure
      caption="The five derived readings, by what an empty one means"
      ariaLabel={grouped.map((g) => `${g.title}: ${g.names.join(", ") || "none"}`).join(". ")}
      reading={
        `Only ${grouped.find((g) => g.kind === "read")?.names.join(" and ") ?? "one"} is worth asking again. `
        + "The other four answer the same way every time you ask: two always answer, and two are decided by the "
        + "family's own shape rather than by this read."
      }
      missing="Which readings exist is fixed by the gateway; which are ANSWERABLE depends on the event, and only a listing says which of them this event carries."
    >
      <Plot height={height}>
        {(width) => {
          const colW = Math.max(120, (width - PAD * 2) / grouped.length);
          return (
            <>
              {grouped.map((band, index) => {
                const x = PAD + index * colW;
                return (
                  <g key={band.kind}>
                    <text x={x} y={12} className="coh-axis__label">
                      {band.mark} {band.title}
                    </text>
                    {/* The band's own rule, so three groups read as three
                        columns without a box each. */}
                    <line
                      x1={x}
                      x2={x + colW - 14}
                      y1={HEAD_H - 4}
                      y2={HEAD_H - 4}
                      className="coh-surface__axis"
                    />
                    {band.names.length === 0 ? (
                      <text x={x} y={HEAD_H + 14} className="coh-surface__unread">
                        none on this build
                      </text>
                    ) : (
                      band.names.map((name, row) => (
                        <text
                          key={name}
                          x={x}
                          y={HEAD_H + 14 + row * ROW_H}
                          className="coh-surface__value"
                        >
                          {name}
                          <title>{`${name}: ${DERIVED_FILES.find((f) => f.name === name)?.silent}`}</title>
                        </text>
                      ))
                    )}
                    <text x={x} y={HEAD_H + tallest * ROW_H + 14} className="coh-surface__tick">
                      {band.means}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
