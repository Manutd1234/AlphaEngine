import type { Finding } from "./types";

export interface FindingsEvidenceSummary {
  /** Every relationship registered by the findings read, measured or not. */
  readonly planned: number;
  /** Rows whose verdict and statistics support an evidence judgement. */
  readonly assessable: number;
  /** Assessable rows whose measured verdict is `holds`. */
  readonly holds: number;
}

export type AssessableFinding = Finding & {
  readonly verdict: "holds" | "absent";
  readonly t_statistic: number;
  readonly shuffled_p: number;
};

/**
 * A row is assessable only when both the wire verdict and the statistics agree.
 *
 * This deliberately refuses a finite-looking statistic on a row explicitly
 * marked `not_assessable`: the UI must not silently weaken the study gate just
 * because a partial calculation happens to be present on the payload.
 */
export function findingIsAssessable(row: Finding): row is AssessableFinding {
  return row.verdict !== "not_assessable"
    && row.t_statistic !== null
    && Number.isFinite(row.t_statistic)
    && row.shuffled_p !== null
    && Number.isFinite(row.shuffled_p);
}

export function summarizeFindings(findings: readonly Finding[]): FindingsEvidenceSummary {
  let assessable = 0;
  let holds = 0;
  for (const row of findings) {
    if (!findingIsAssessable(row)) continue;
    assessable += 1;
    if (row.verdict === "holds") holds += 1;
  }
  return { planned: findings.length, assessable, holds };
}

/** Compact chip copy that never turns six planned rows into six tested rows. */
export function findingsEvidenceValue(summary: FindingsEvidenceSummary): string {
  if (summary.planned === 0) return "not planned";
  const assessed = `${summary.assessable} of ${summary.planned} planned`;
  return summary.assessable > 0 ? `${assessed}; ${summary.holds} hold` : assessed;
}
