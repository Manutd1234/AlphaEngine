"use client";

/**
 * Two runs, side by side, with the comparability question answered first.
 *
 * A metric delta between two runs is only meaningful if they saw the same
 * prices. Two sweeps on different bars can differ in Sharpe for reasons that
 * have nothing to do with what changed in the request — a revised bar, a
 * different venue, or one of them falling back to the synthetic series. So the
 * data fingerprint is checked and stated before any number below it is worth
 * reading, and "unknown" is shown as unknown rather than assumed to be "same".
 *
 * The request diff comes before the metric diff for the same reason a
 * controlled experiment names its variable first: knowing that only
 * `slippageBps` changed makes a Sharpe drop informative, and knowing that six
 * fields changed makes it noise.
 */

import { fmt, pct } from "@/lib/format";
import type { ExperimentRecord } from "@/lib/experiments";
import { compareRuns } from "@/lib/experiments";

interface RunComparisonProps {
  a: ExperimentRecord;
  b: ExperimentRecord;
  onClose: () => void;
}

/** Metrics where a smaller number is the better outcome. */
const LOWER_IS_BETTER = new Set(["Max drawdown"]);

function formatMetric(metric: string, value: number | null): string {
  if (value === null) return "—";
  if (metric === "Max drawdown" || metric === "Total return") return pct(value);
  if (metric === "Trades" || metric === "Gates passed") return String(Math.round(value));
  return fmt(value, metric === "Deflated Sharpe" ? 3 : 2);
}

export default function RunComparison({ a, b, onClose }: RunComparisonProps) {
  const comparison = compareRuns(a, b);

  return (
    <div className="card run-comparison">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Comparison</span>
          <h2>{a.id} vs {b.id}</h2>
        </div>
        <button type="button" className="text-action" onClick={onClose}>Close</button>
      </div>

      {/* <div>, not <p>: a <p> cannot contain a <div>, so the SSR parser
          auto-closed these and hydration met different markup — and every
          sibling banner on the surface is already a <div className="banner">. */}
      {comparison.sameData === true ? (
        <div className="banner" role="status">
          <span aria-hidden>=</span>
          <div>
            <strong>Same data.</strong> Both runs fingerprint to <code>{a.dataHash}</code>, so the
            differences below are attributable to the request, not to the bars.
          </div>
        </div>
      ) : comparison.sameData === false ? (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>Different data.</strong> These runs saw different bars
            (<code>{a.dataHash}</code> vs <code>{b.dataHash}</code>). A metric difference is not
            evidence about the parameters; re-run them against the same history first.
          </div>
        </div>
      ) : (
        <div className="banner" role="status">
          <span aria-hidden>?</span>
          <div>
            <strong>Comparability unknown.</strong> At least one run predates dataset fingerprinting,
            so there is no way to confirm they saw the same prices. Matching date ranges are not
            sufficient evidence.
          </div>
        </div>
      )}

      <h3 className="run-comparison__subhead">What changed in the request</h3>
      {comparison.requestDiffs.length === 0 ? (
        <p className="sub">
          Identical requests. Any difference below is the engine&apos;s own non-determinism or a
          change in the underlying data.
        </p>
      ) : (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">Request fields that differ between the two runs.</caption>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">{a.id}</th>
                <th scope="col">{b.id}</th>
              </tr>
            </thead>
            <tbody>
              {comparison.requestDiffs.map((diff) => (
                <tr key={diff.field}>
                  <td>{diff.field}</td>
                  <td>{String(diff.a ?? "—")}</td>
                  <td>{String(diff.b ?? "—")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="run-comparison__subhead">What it did to the result</h3>
      <div className="table-wrap table-wrap--clamped">
        <table>
          <caption className="sr-only">Metric values for both runs and the change between them.</caption>
          <thead>
            <tr>
              <th scope="col">Metric</th>
              <th scope="col">{a.id}</th>
              <th scope="col">{b.id}</th>
              <th scope="col">Change</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metricDeltas.map((row) => {
              const improved = row.delta === null || row.delta === 0
                ? null
                : LOWER_IS_BETTER.has(row.metric) ? row.delta < 0 : row.delta > 0;
              return (
                <tr key={row.metric}>
                  <td>{row.metric}</td>
                  <td>{formatMetric(row.metric, row.a)}</td>
                  <td>{formatMetric(row.metric, row.b)}</td>
                  <td className={improved === null ? undefined : improved ? "pos" : "neg"}>
                    {row.delta === null
                      ? "—"
                      : `${row.delta > 0 ? "+" : ""}${formatMetric(row.metric, row.delta)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
