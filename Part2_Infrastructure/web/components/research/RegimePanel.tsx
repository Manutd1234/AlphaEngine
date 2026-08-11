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
      <th scope="row" style={{ textAlign: "left", padding: "7px 10px", borderBottom: "1px solid var(--grid)", fontWeight: 600 }}>
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
        <table>
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

      <h3 className="regime-windows-heading">Historical stress windows</h3>
      <ul className="regime-windows">
        {regimes.windows.map((w) => (
          <li key={w.id}>
            <span className="regime-windows__label">{w.label}</span>
            {w.covered && w.stat ? (
              <span className="num">
                <span className={sign(w.stat.totalReturn)}>{signedPct(w.stat.totalReturn)}</span>
                {" · max DD "}
                <span className="neg">{pct(w.stat.maxDrawdown, 1)}</span>
                {` · ${w.stat.bars} bars`}
              </span>
            ) : (
              <span className="muted">
                not in data window{w.coverage > 0 ? ` (${pct(w.coverage, 0)} overlap)` : ""} — extend the
                bar count to test it
              </span>
            )}
          </li>
        ))}
      </ul>

      <p className="research-note">{regimes.note}</p>
    </div>
  );
}
