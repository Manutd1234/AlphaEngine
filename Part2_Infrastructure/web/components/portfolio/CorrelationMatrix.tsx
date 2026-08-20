"use client";

/**
 * Pairwise correlation, drawn as the matrix it is.
 *
 * Alpha carries magnitude, hue carries sign, and the number is printed in every
 * cell — readable with no colour perception at all. That last clause is why the
 * fill is capped (lib/correlation.ts) rather than run to full saturation: past
 * 75% the tile wins and the fallback stops being legible, which trades the
 * accessible reading for a prettier one.
 *
 * The crosshair rings the hovered row and column instead of tinting them. In a
 * heatmap the background IS the datum; changing it on hover corrupts the
 * measurement at the moment somebody is reading it.
 */

import { useState } from "react";

import { corrFill, corrLabel, corrTitle } from "@/lib/correlation";
import { fmt } from "@/lib/format";
import type { CovarianceModel, PortfolioRisk } from "@/lib/portfolio-risk";

interface CorrelationMatrixProps {
  model: CovarianceModel;
  worst: PortfolioRisk["worstCorrelation"];
  observations: number;
}

export default function CorrelationMatrix({ model, worst, observations }: CorrelationMatrixProps) {
  // Declared before any bail-out. tests/workspace-routing.test.ts scans this
  // file for a hook below an early return.
  const [cross, setCross] = useState<{ i: number; j: number } | null>(null);
  const symbols = model.symbols;

  // A 1x1 correlation matrix is one cell reading 1.00. It is not a
  // diversification statement, it is a tautology, and drawing it invites being
  // read as one.
  if (symbols.length < 2) {
    return (
      <div className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Diversification</span>
            <h2>Correlation</h2>
          </div>
        </div>
        <p className="sub">
          One measurable instrument. Correlation is a statement about a pair, so there is nothing to
          show until the book holds a second position with enough history to measure.
        </p>
      </div>
    );
  }

  const short = (s: string) => s.replace("USDT", "");

  return (
    <div className="card">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Diversification</span>
          <h2>Correlation</h2>
        </div>
        <span>
          {symbols.length} instruments, {observations} daily observations
        </span>
      </div>

      <p className="sub">Diversification is only real while these stay low.</p>

      {worst && Math.abs(worst.corr) >= 0.8 && (
        <div className="banner warn" role="status">
          <span aria-hidden>!</span>
          <div>
            <strong>
              {worst.a} and {worst.b} correlate at {fmt(worst.corr, 2)}.
            </strong>{" "}
            Two positions this correlated are close to one position of their combined size — the book
            is less diversified than the position count suggests.
          </div>
        </div>
      )}

      {/* The ramp is the caption: it shows hue as the sign and depth as the
          strength, and the number in every cell is a cell away. A sentence
          under it narrated all three. */}
      <div className="corr-legend">
        <span>−1</span>
        <i className="is-neg" aria-hidden />
        <span className="muted">0</span>
        <i className="is-pos" aria-hidden />
        <span>+1</span>
      </div>

      <div className="table-wrap" tabIndex={0}>
        <table className="corr-matrix" onPointerLeave={() => setCross(null)}>
          <caption className="sr-only">
            Pairwise return correlation between held instruments, {symbols.length} by {symbols.length}.
            Each cell prints its own coefficient.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Instrument</span>
              </th>
              {symbols.map((s, j) => (
                <th scope="col" key={s} className={cross?.j === j ? "is-cross" : undefined}>
                  {short(s)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSymbol, i) => (
              <tr key={rowSymbol}>
                <th scope="row" className={cross?.i === i ? "is-cross" : undefined}>
                  {short(rowSymbol)}
                </th>
                {symbols.map((colSymbol, j) => {
                  const c = model.correlation[i][j];
                  const onCross = cross !== null && (cross.i === i || cross.j === j);
                  const isFocus = cross?.i === i && cross.j === j;
                  return (
                    <td
                      key={colSymbol}
                      className={["corr-cell", i === j ? "is-self" : "", isFocus ? "is-focus" : onCross ? "is-cross" : ""]
                        .filter(Boolean)
                        .join(" ")}
                      onPointerEnter={() => setCross({ i, j })}
                    >
                      <span title={corrTitle(rowSymbol, colSymbol, c)} style={{ background: corrFill(c) }}>
                        {corrLabel(c)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="research-note">
        Measured from {observations} daily closes of the instruments actually held, not from assumed
        factor loadings. The diagonal is 1.00 by construction and is coloured as such — the one cell
        here whose value is certain rather than measured.
      </p>
    </div>
  );
}
