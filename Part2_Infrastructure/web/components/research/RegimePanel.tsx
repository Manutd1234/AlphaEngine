"use client";

/**
 * Where the returns came from.
 *
 * A headline Sharpe is an average over regimes the strategy may never see
 * again. This panel conditions the same per-bar returns on market state —
 * trend and volatility — and on named historical stress windows, so a
 * candidate that only worked in one kind of market cannot hide inside its
 * own average. Uncovered windows are shown as uncovered rather than dropped:
 * "we could not test this" is evidence too.
 */

import { fmt, pct, sign, signedPct } from "@/lib/format";
import type { RegimeReport, RegimeStat } from "@/lib/types";

const REGIME_GLYPHS: Record<string, string> = {
  bull: "▲",
  bear: "▼",
  sideways: "◆",
  highVol: "↑",
  lowVol: "↓",
};

const REGIME_LABELS: Record<string, string> = {
  bull: "Bull",
  bear: "Bear",
  sideways: "Sideways",
  highVol: "High vol",
  lowVol: "Low vol",
};

function RegimeRow({ stat }: { stat: RegimeStat }) {
  return (
    <tr>
      {/* Styled by the shared tbody th[scope="row"] rule — this inline style
          object was the stylesheet restated in JSX. */}
      <th scope="row">
        <span aria-hidden>{REGIME_GLYPHS[stat.regime] ?? "·"}</span>{" "}
        {REGIME_LABELS[stat.regime] ?? stat.regime}
      </th>
      <td className="num">{pct(stat.share, 0)}</td>
      <td className={`num ${stat.sharpe == null ? "muted" : sign(stat.sharpe)}`}>
        {stat.sharpe == null ? "—" : fmt(stat.sharpe, 2)}
      </td>
      <td className={`num ${sign(stat.totalReturn)}`}>{signedPct(stat.totalReturn)}</td>
      <td className="num neg">{pct(stat.maxDrawdown, 1)}</td>
      <td className="num">{pct(stat.winRate, 0)}</td>
      <td className="num">{pct(stat.exposure, 0)}</td>
      <td className="num">{stat.bars.toLocaleString()}</td>
    </tr>
  );
}

export default function RegimePanel({ regimes }: { regimes: RegimeReport }) {
  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Regimes</span>
          <h2>Performance by market state</h2>
        </div>
        <span className="section-note">
          {regimes.classifiedBars.toLocaleString()} of {regimes.totalBars.toLocaleString()} bars classified
        </span>
      </div>

      <div className="table-wrap" tabIndex={0}>
        <table className="regime-table">
          <caption className="sr-only">
            Strategy performance conditioned on trend and volatility regimes
          </caption>
          <thead>
            <tr>
              <th scope="col">Regime</th>
              <th scope="col">% of bars</th>
              <th scope="col">Sharpe</th>
              <th scope="col">Return</th>
              <th scope="col">Max DD</th>
              <th scope="col">Win</th>
              <th scope="col">Exposure</th>
              <th scope="col">Bars</th>
            </tr>
          </thead>
          <tbody>
            {regimes.trend.map((stat) => (
              <RegimeRow key={stat.regime} stat={stat} />
            ))}
            {regimes.vol.map((stat) => (
              <RegimeRow key={stat.regime} stat={stat} />
            ))}
          </tbody>
        </table>
      </div>

      {/* A table, in the same frame as the regime table above it — the
          windows were a list whose label and reading sat at opposite ends of
          a line, so three uncovered windows printed the same sentence three
          times at three different x positions. Each window is now a row with
          the same columns as a regime (return, drawdown, win, bars), plus how
          much of the window the loaded bars overlap; an uncovered window keeps
          its row and dashes its figures, and ONE footnote under the table says
          what a dash means. "We could not test this" is still evidence, and
          it is still on screen. */}
      <section className="regime-windows research-subsection" aria-labelledby="regime-windows-title">
        <h3 id="regime-windows-title" className="research-subhead">Historical stress windows</h3>
        <div className="table-wrap" tabIndex={0}>
          <table>
            <caption className="sr-only">
              Strategy performance inside named historical stress windows
            </caption>
            <thead>
              <tr>
                <th scope="col">Window</th>
                <th scope="col">Coverage</th>
                <th scope="col">Return</th>
                <th scope="col">Max DD</th>
                <th scope="col">Win</th>
                <th scope="col">Bars</th>
              </tr>
            </thead>
            <tbody>
              {regimes.windows.map((w) => (
                <tr key={w.id}>
                  <th scope="row">{w.label}</th>
                  {w.covered && w.stat ? (
                    <>
                      <td className="num">{pct(w.coverage, 0)}</td>
                      <td className={`num ${sign(w.stat.totalReturn)}`}>
                        {signedPct(w.stat.totalReturn)}
                      </td>
                      <td className="num neg">{pct(w.stat.maxDrawdown, 1)}</td>
                      <td className="num">{pct(w.stat.winRate, 0)}</td>
                      <td className="num">{w.stat.bars.toLocaleString()}</td>
                    </>
                  ) : (
                    <>
                      {/* The overlap is measured even when the window is not
                          covered — 0% and 12% are different facts — so it is
                          the one cell an uncovered row still fills. */}
                      <td className="num muted">{pct(w.coverage, 0)}</td>
                      <td className="num muted" aria-label="not in data window">—</td>
                      <td className="num muted" aria-label="not in data window">—</td>
                      <td className="num muted" aria-label="not in data window">—</td>
                      <td className="num muted" aria-label="not in data window">—</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {regimes.windows.some((w) => !(w.covered && w.stat)) && (
          <p className="research-footnote">
            — marks a window outside the loaded bars; extend the bar count to test it.
          </p>
        )}
      </section>

      {/* Folded, not dropped. `regimes.note` states one classification method
          and two restrictions on what the table above may be used for — the
          volatility split is hindsight, and the per-regime drawdown is a
          stitched diagnostic. Every figure it qualifies stays on screen, and
          the summary says out loud that a restriction exists rather than
          leaving a reader to discover it by opening something. The words are
          interpolated from lib/regimes.ts and are not touched here. */}
      <details className="disclosure">
        <summary>How were these regimes classified, and what can they not be used for?</summary>
        <p className="research-note">{regimes.note}</p>
      </details>
    </div>
  );
}
