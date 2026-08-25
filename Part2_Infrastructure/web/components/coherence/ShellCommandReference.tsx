"use client";

/**
 * The four commands the shell answers, listed once.
 *
 * Left `ShellPane` on 2026-08-24 when every section of this engine took the
 * desk's shared card head and that pane was four lines under the 400-line
 * ceiling. The seam is a real one rather than a convenient line: this is static
 * reference material with no props, no state and no read behind it — the only
 * block in the pane that is true whatever the venue answered.
 */

import { DERIVED_FILES } from "./ShellTree";
import ShellReadings from "./ShellReadings";

export default function CommandReference() {
  return (
    <>
      {/* THE DRAWING FIRST since 2026-08-25 — "add more diagrams and summarise
          the words". This view was a seven-row table whose third column is the
          one that matters and the one the card cut off at the right edge, and
          that column is not five facts: it is one distinction with three
          values, which the caption below already states in words. Drawn, a
          reader can see which reading is worth asking again without reading a
          sentence per row. */}
      <ShellReadings />

      {/* The table is the proof and it folds. What it alone carries is what
          each reading READS — the middle column — and the exact sentence the
          gateway would return, which is per-row detail rather than the shape. */}
      <details className="disclosure">
        <summary>What each of the two commands and five readings answers, {DERIVED_FILES.length + 2} rows</summary>
    <div className="table-wrap">
      <table className="coh-table">
        <caption className="coh-table__caption">
          The two commands and the five derived readings; a reading with no answer says which kind, because only
          one kind is worth reading again.
        </caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">What it reads</th>
            <th scope="col">When it has no answer</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row"><code>ls</code></th>
            <td>A path: the shards, series, events, markets and derived readings under it.</td>
            <td>Answers that the path does not exist.</td>
          </tr>
          <tr>
            <th scope="row"><code>cat</code></th>
            <td>
              One derived file in an event directory, at <code>/shards/&lt;n&gt;/&lt;series&gt;/&lt;event&gt;/&lt;name&gt;</code>.
            </td>
            <td>A listed file whose reading this read could not produce — the one worth reading again.</td>
          </tr>
          {DERIVED_FILES.map((file) => (
            <tr key={file.name}>
              <th scope="row"><code>{file.name}</code></th>
              <td>{file.reads}</td>
              <td>{file.silent}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      </details>
    </>
  );
}
