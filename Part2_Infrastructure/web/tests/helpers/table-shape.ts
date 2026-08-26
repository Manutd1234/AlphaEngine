/**
 * Reading a `<table>` out of component source: its header labels, its cells,
 * its caption — for the suites that hold every engine table to one contract.
 *
 * Generalised from `diffusion-table-columns.test.ts`, which reads one table per
 * file and compares raw header text. Two things that file could not do are
 * needed here: a file can hold two tables (`CertificateViews`, `CombosBounds`,
 * `CombosViews`), so every reader takes `nth`; and a header can carry a tag
 * (`<code>worth_doing</code>`) or, once headers are sortable, a `<button>`, so
 * labels are compared with their inner tags stripped — adopting sort later
 * changes no declared column.
 *
 * Comments are blanked before any read. The tables' own doc blocks quote the
 * literals this contract looks for, and a raw scan would be satisfied by the
 * comment explaining a column rather than the column.
 */

export interface TableSource {
  /** The `<table …>…</table>` block, comments blanked. */
  readonly block: string;
  /** The `<table` tag's attributes. */
  readonly attributes: string;
  /** The 240 characters before the tag — where `.table-wrap` would be. */
  readonly before: string;
  /** Whether a `<details>` in the same file encloses this table. */
  readonly folded: boolean;
}

/** Comments blanked to spaces, newlines kept, so every index still maps to a line. */
export function blankComments(source: string): string {
  return source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

/** Every `<table>` in a source file, in order. */
export function tables(source: string): TableSource[] {
  const code = blankComments(source);
  const folds = [...code.matchAll(/<details[\s\S]*?<\/details>/g)].map((m) => [m.index, m.index + m[0].length]);
  return [...code.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/g)].map((m) => ({
    block: m[0],
    attributes: m[1],
    before: code.slice(Math.max(0, m.index - 240), m.index),
    folded: folds.some(([a, b]) => m.index > a && m.index < b),
  }));
}

/** Inner tags stripped, whitespace collapsed — a label is its words. */
export const words = (fragment: string): string =>
  fragment.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/** The `<thead>`'s column labels, in the order they are drawn. */
export function headerLabels(table: TableSource): string[] {
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(table.block)?.[1] ?? "";
  return [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => words(m[1]));
}

/** Each `<thead>` cell's attributes, in order — to read `.num` and `scope` off. */
export function headerAttributes(table: TableSource): string[] {
  const head = /<thead>([\s\S]*?)<\/thead>/.exec(table.block)?.[1] ?? "";
  return [...head.matchAll(/<th\b([^>]*)>/g)].map((m) => m[1]);
}

export interface Cell {
  readonly tag: "td" | "th";
  readonly attributes: string;
  /** The raw cell source, tags included. */
  readonly inner: string;
}

/**
 * The first body row's cells, in order — the row a `.map` renders, which is
 * every row. A table whose rows come from a child component has no cells here
 * and declares `cellsElsewhere`.
 */
export function bodyCells(table: TableSource): Cell[] {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(table.block)?.[1] ?? "";
  const row = /<tr\b[^>]*>([\s\S]*?)<\/tr>/.exec(body)?.[1] ?? "";
  return [...row.matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map((m) => ({
    tag: m[1] as "td" | "th",
    attributes: m[2],
    inner: m[3],
  }));
}

/** The `<caption>` tags in the table, with their attributes. */
export function captions(table: TableSource): string[] {
  return [...table.block.matchAll(/<caption\b([^>]*)>/g)].map((m) => m[1]);
}

/** Whether the table's row-total is a `<tfoot>`, a row in the body, or absent. */
export function totalRow(table: TableSource): "tfoot" | "tbody" | null {
  if (/<tfoot/.test(table.block)) return "tfoot";
  if (/coh-table__total/.test(table.block)) return "tbody";
  return null;
}
