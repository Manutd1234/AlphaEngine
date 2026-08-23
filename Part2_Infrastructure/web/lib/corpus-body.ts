/**
 * The embedded text of a corpus document, read back as rows.
 *
 * What the vector saw is a block of `Label: value` lines — the gateway's
 * `research_rag.py` writes every document that way, one fact per line — and
 * the panel used to print that block verbatim in a `pre-wrap` paragraph. The
 * facts were all there and none of them lined up: "Filled notional USD:
 * 61,000.00" sat under "Decisions: 16 (13 accepted, 3 rejected)" with nothing
 * to say the two were the same kind of thing.
 *
 * This splits the block on its newlines and each line on its FIRST colon, so
 * the label lands in one column and the value in the other. Nothing is
 * dropped, reordered or reworded: a line with no colon is kept as a prose
 * row, and a line that merely repeats the document's title — the first line
 * of every summary — is the one omission, because the title is already the
 * row's heading and printing it twice is not fidelity.
 *
 * A colon alone does not make a label. "Session closed at: 2026-08-23T00:00"
 * has two more colons inside its value and a timestamp cannot be a label, so
 * a label has to be SHORT — under `MAX_LABEL_LENGTH` — and has to start with
 * a letter. "http://…" and "12:30" therefore stay prose, which is what they
 * are.
 */

export interface CorpusFactRow {
  /** The text before the first colon, trimmed; null on a prose line. */
  label: string | null;
  /** The text after it — or the whole line, on a prose line. */
  value: string;
}

/** Longest run of characters that still reads as a field name. */
const MAX_LABEL_LENGTH = 48;

const LABEL_PATTERN = /^([A-Za-z][^:]*?):\s*(.*)$/;

/**
 * Splits one embedded body into rows. Returns an empty list when nothing in
 * the body parses as a fact, so the caller can fall back to the paragraph.
 */
export function parseCorpusBody(body: string, title?: string): CorpusFactRow[] {
  const rows: CorpusFactRow[] = [];
  let facts = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (title && line === title.trim()) continue;
    const match = LABEL_PATTERN.exec(line);
    if (match && match[1].length <= MAX_LABEL_LENGTH && match[2] !== "") {
      rows.push({ label: match[1].trim(), value: match[2] });
      facts += 1;
    } else {
      rows.push({ label: null, value: line });
    }
  }
  return facts === 0 ? [] : rows;
}
