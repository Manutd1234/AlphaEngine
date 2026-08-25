"use client";

/**
 * What the study measured, positive and null in the same table.
 *
 * A results surface that shows only what worked is a claim. This one puts the
 * relationship that holds and the ones that do not at the same weight, in the
 * same columns, with the count behind each and how often a shuffled pairing
 * did as well — so a reader can see that the pipeline detects a real effect
 * when there is one, which is the only thing that makes the empty rows worth
 * anything.
 *
 * The verdict is a word and a mark, never a colour alone.
 */

import { fmt } from "@/lib/format";

import type { Finding } from "./types";

const MARK: Record<Finding["verdict"], string> = {
  holds: "✓",
  absent: "✗",
  not_assessable: "◌",
};

const WORD: Record<Finding["verdict"], string> = {
  holds: "holds",
  absent: "not there",
  not_assessable: "too few",
};

export default function FindingsTable({ findings }: { findings: Finding[] }) {
  if (!findings.length) {
    return (
      <p className="console-empty">
        <span aria-hidden="true">◌</span> Nothing has been measured yet.
      </p>
    );
  }
  return (
    <div className="table-wrap" tabIndex={0}>
      {/* FIXED, NOT AUTO. Auto gave the seven columns 658 · 139 · 118 · 108 ·
          124 · 176 · 202 at 1600px and 520 · 110 · 93 · 85 · 98 · 139 · 160 at
          1280 — the relationship name taking five times the width of the `t`
          beside it, because it is the only prose column and `auto` sizes to the
          longest cell.

          Three twelfths, not four, and the number is measured rather than
          judged: the longest relationship name on the live ledger is 38
          characters and the median 36, while 3/12 at this width holds about 53.
          Four twelfths held 71 and took the room from Verdict for nothing. */}
      <table className="coh-table diff-findings table-fixed">
        <caption className="coh-table__caption">
          Every relationship measured, held or not. The first two rows are the control: a
          pipeline that cannot see a bigger rate change produce a bigger move could not call
          the others absent.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="w-3/12">Relationship</th>
            <th scope="col" className="w-1/12">Stage</th>
            <th scope="col" className="num w-1/12">Events</th>
            <th scope="col" className="num w-1/12">t</th>
            <th scope="col" className="num w-1/12">r</th>
            <th scope="col" className="num w-2/12">Shuffled p</th>
            <th scope="col" className="w-3/12">Verdict</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((row) => (
            <tr key={`${row.name}-${row.stage}`}>
              <th scope="row" title={row.question}>{row.name}</th>
              <td>{row.stage}</td>
              <td className="num">{row.n}</td>
              <td className="num">
                {row.t_statistic == null
                  ? <span className="muted">—</span>
                  : `${row.t_statistic > 0 ? "+" : ""}${fmt(row.t_statistic, 2)}`}
              </td>
              <td className="num">
                {row.correlation == null
                  ? <span className="muted">—</span>
                  : `${row.correlation > 0 ? "+" : ""}${fmt(row.correlation, 3)}`}
              </td>
              <td className="num">
                {row.shuffled_p == null ? <span className="muted">—</span> : fmt(row.shuffled_p, 3)}
              </td>
              <td>
                <span aria-hidden="true">{MARK[row.verdict]}</span> {WORD[row.verdict]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
