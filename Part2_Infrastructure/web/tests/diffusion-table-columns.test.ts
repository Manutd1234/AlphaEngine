/**
 * A header must name the cell underneath it, and nothing else checked that.
 *
 * THE DEFECT THIS IS WRITTEN FOR, found on 2026-08-25 by reading the two lists
 * side by side rather than by any suite. `KalshiArm`'s episode table headed six
 * columns
 *
 *     Family · Constraint · Lifetime · Peak distance · Peak net edge · Half-life
 *
 * over a body of
 *
 *     event_ticker · family · lifetime_s · peak_ci · peak_net_edge · half_life_s
 *
 * so column one was labelled "Family" over the EVENT TICKER, column two
 * "Constraint" over the family, and "Constraint" named no field in the payload
 * at all. Six headers over six cells: every count matched, every type checked,
 * and the table sat inside a `<details>` on a deployment with no closed
 * episodes, so it rendered for nobody. Live data, mislabelled, invisible to the
 * whole suite.
 *
 * WHY A COUNT IS NOT ENOUGH. The obvious guard — headers.length === cells.length
 * — is exactly what was already true while the table was wrong. A shift by one
 * preserves the count. So the pairing has to be DECLARED, and the declaration
 * has to name the field expression the cell is built from, which is the only
 * thing in the source that says what a column actually holds.
 *
 * WHAT THIS CANNOT DO. It reads source, so it proves the header and the cell
 * were written to agree; it cannot prove the FIELD means what its name says.
 * `peak_ci` under "Peak distance" is asserted here and understood only by
 * reading `lib/coherence/types.ts`. That is the residue, and it is smaller than
 * what was there before.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { read } from "./helpers/workspace-sources";

/** A cell begins at a `<td`, a row header, or a helper that expands to one. */
const CELL_START = /<td\b|<th\s+scope="row"|\{cell\(/g;

interface TableSpec {
  /** Where the table is drawn. */
  readonly file: string;
  /** What it is, for the failure message. */
  readonly what: string;
  /**
   * Header label, then a token that MUST appear in the cell beneath it.
   *
   * The token is the field expression rather than a type, because the pairing
   * being checked is "this word sits over this datum" and only the expression
   * carries the datum.
   */
  readonly columns: ReadonlyArray<readonly [label: string, token: string]>;
  /** Which `<table>` in the file, in source order, when a file draws more than one. Default the first. */
  readonly nth?: number;
}

const TABLES: readonly TableSpec[] = [
  {
    file: "../components/coherence/diffusion/KalshiArm.tsx",
    what: "the closed-episode ledger",
    columns: [
      ["Event", "episode.event_ticker"],
      ["Family", "episode.family"],
      ["Lifetime", "episode.lifetime_s"],
      ["Peak distance", "episode.peak_ci"],
      ["Peak net edge", "episode.peak_net_edge_dollars"],
      ["Half-life", "half_life_s"],
    ],
  },
  {
    file: "../components/coherence/diffusion/MeetingTable.tsx",
    what: "the per-meeting ledger",
    columns: [
      ["Meeting", "source_ref"],
      ["Asset", "symbol"],
      // Both half-life columns are built by the same local `cell()` helper, so
      // the token is the argument that picks the stage — which is the whole of
      // what distinguishes these two columns from each other.
      ["Statement half-life", "pair.release"],
      ["Press conference half-life", "pair.call"],
      ["Statement move", "terminal_return"],
      ["Against no news", "percentile"],
    ],
  },
  {
    file: "../components/coherence/diffusion/AbsorptionWorkbench.tsx",
    what: "the exact absorption horizon ledger",
    columns: [
      ["Horizon", "row.horizon"],
      ["Stage", "STAGE_WORD[row.stage]"],
      ["Payload mean", "row.cell.mean"],
      ["Middle 50%", "row.cell.band"],
      ["Cells", "row.cell.band.n"],
      ["Record provenance", "row.cell.provenance"],
    ],
  },
  {
    file: "../components/coherence/diffusion/FindingsTable.tsx",
    what: "the measured relationships",
    columns: [
      ["Relationship", "row.name"],
      ["Stage", "row.stage"],
      ["Events", "row.n"],
      ["t", "row.t_statistic"],
      ["r", "row.correlation"],
      ["Shuffled p", "row.shuffled_p"],
      ["Verdict", "row.verdict"],
    ],
  },
  // The two method folds under Findings / Instrument, 2026-08-26. One file,
  // two tables: `nth` says which. Their rows are authored here rather than
  // wire rows, so the pairing checked is that each header sits over the field
  // of the row shape it names.
  {
    file: "../components/coherence/diffusion/FindingsFolds.tsx",
    what: "the run and what it was held to",
    columns: [
      ["Setting", "row.what"],
      ["Value", "row.value"],
      ["What it means", "row.how"],
    ],
  },
  {
    file: "../components/coherence/diffusion/FindingsFolds.tsx",
    what: "the timestamps checked against the issuer",
    nth: 1,
    columns: [
      ["Check", "row.what"],
      ["Result", "row.value"],
      ["Read from", "row.how"],
    ],
  },
];

/** The `<thead>`'s column labels, in the order they are drawn. */
function headerLabels(source: string, nth = 0): string[] {
  const head = [...source.matchAll(/<thead>([\s\S]*?)<\/thead>/g)][nth]?.[1] ?? "";
  return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)]
    .map((match) => match[1].replace(/\s+/g, " ").trim());
}

/** The `<tbody>`'s cells, in the order they are drawn, as raw source. */
function bodyCells(source: string, nth = 0): string[] {
  const body = [...source.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)][nth]?.[1] ?? "";
  const starts = [...body.matchAll(CELL_START)].map((match) => match.index as number);
  return starts.map((start, index) => body.slice(start, starts[index + 1] ?? body.length));
}

describe("every diffusion table's header names the cell beneath it", () => {
  for (const table of TABLES) {
    const source = read(table.file);
    const labels = headerLabels(source, table.nth ?? 0);
    const cells = bodyCells(source, table.nth ?? 0);

    it(`${table.what} draws one cell per header`, () => {
      assert.equal(
        labels.length,
        table.columns.length,
        `${table.file} heads ${labels.length} columns, this contract declares ${table.columns.length}.\n`
          + `  Saw: ${labels.join(" | ")}`,
      );
      assert.equal(
        cells.length,
        table.columns.length,
        `${table.file} draws ${cells.length} cells per row against ${labels.length} headers`,
      );
    });

    for (const [index, [label, token]] of table.columns.entries()) {
      it(`${table.what}: column ${index + 1} is "${label}", over ${token}`, () => {
        assert.equal(
          labels[index],
          label,
          `column ${index + 1} is headed "${labels[index]}", not "${label}". `
            + "If the column was renamed, rename it here in the same change; if the COLUMNS were "
            + "reordered, every pairing below has moved with them.",
        );
        assert.ok(
          cells[index]?.includes(token),
          `column ${index + 1} is headed "${label}" but its cell does not read ${token}.\n`
            + `  The cell holds: ${(cells[index] ?? "").replace(/\s+/g, " ").slice(0, 120)}\n`
            + "  This is the shape the episodes table shipped with: six headers over six cells, "
            + "shifted by one, so every count matched and nothing caught it.",
        );
      });
    }
  }
});
