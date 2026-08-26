"use client";

/**
 * Each position at its share of gross against its share of the day's P&L,
 * with the diagonal where the two agree.
 *
 * THE QUESTION THE TABLE CANNOT ANSWER. The positions table lists notional and
 * P&L as two columns, and whether the largest position is also the one doing
 * the work is a division a reader has to do in their head, row by row. Plotted
 * against each other with the diagonal as the reference — on it, a position
 * earned exactly its size; above, more; below, less — the answer is where the
 * dots sit. Same grammar as `EdgeScatter` on Stake, deliberately, so a reader
 * who has met one has met both; same CSS classes, so they look the same.
 *
 * THE DIAGONAL IS THE PLOT'S REFERENCE, not a hand-drawn line — the first
 * figure to use `y1` on `PlotReference`, and the reason it was added. Painted
 * under every dot, labelled, checkable.
 *
 * MARK READOUT, NOT `sharedX`. The x here is a VALUE — share of gross — and
 * grammar rule 7 says a shared axis snaps by even division, so the cursor
 * would sit on the wrong dot wherever weights are uneven, which is always.
 *
 * Colour never carries above/below alone: a dot above the line carries `▲`
 * in its own words and a dot below carries `▼`, and the dot on the line says
 * so.
 */

import Figure, { FigureEmpty, Plot } from "@/components/coherence/Figure";
import { linearScale } from "@/components/chart-kit";
import { usd } from "@/lib/format";
import { contributionPoints, contributionReading, type ContributionInput } from "@/lib/portfolio-risk/contribution";

const HEIGHT = 240;
const MARGIN = { top: 14, right: 18, bottom: 40, left: 46 };

export default function ContributionScatter({ positions }: { positions: readonly ContributionInput[] }) {
  const summary = contributionPoints(positions);
  const caption = "Share of gross against share of the day's P&L, per position";
  const aria = "Each position plotted at its share of gross notional against its share of the day's profit and loss, with the earned-its-size diagonal";

  if (summary.withheld) {
    return (
      <Figure caption={caption} ariaLabel={aria}>
        <FigureEmpty reason={`${summary.withheld[0].toUpperCase()}${summary.withheld.slice(1)}.`} />
      </Figure>
    );
  }

  // Both axes in shares. x is [0, 1] by construction; y can be negative, so
  // the domain is symmetric about the largest magnitude and always holds
  // the diagonal's span, or a book with one small loser would draw the
  // line off the top.
  const yMax = Math.max(1, ...summary.points.map((p) => Math.abs(p.contribution)));
  const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
  const y = linearScale(-yMax, yMax, HEIGHT - MARGIN.bottom, MARGIN.top);

  return (
    <Figure caption={caption} ariaLabel={aria} reading={contributionReading(summary)}>
      <Plot
        height={HEIGHT}
        reference={(width) => {
          const x = linearScale(0, 1, MARGIN.left, width - MARGIN.right);
          return { x0: x(0), y: y(0), x1: x(1), y1: y(1), label: "earned exactly its size" };
        }}
      >
        {(width) => {
          const x = linearScale(0, 1, MARGIN.left, width - MARGIN.right);
          return (
            <>
              {[0, 0.5, 1].map((v) => (
                <g key={`x${v}`}>
                  <text className="coh-tape__tick" x={x(v)} y={HEIGHT - 22} textAnchor="middle">{pct(v)}</text>
                </g>
              ))}
              {[-yMax, 0, yMax].map((v) => (
                <g key={`y${v}`}>
                  <line className="coh-tape__grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(v)} y2={y(v)} />
                  <text className="coh-tape__tick" x={MARGIN.left - 6} y={y(v) + 4} textAnchor="end">{pct(v)}</text>
                </g>
              ))}
              {summary.points.map((p) => {
                const side = p.earnedMoreThanSize === null ? "on the line" : p.earnedMoreThanSize ? "▲ above" : "▼ below";
                return (
                  <circle
                    key={p.symbol}
                    className={p.earnedMoreThanSize ? "coh-edge__dot is-admitted" : "coh-edge__dot"}
                    cx={x(p.weight)}
                    cy={y(p.contribution)}
                    r={5}
                  >
                    <title>{`${p.symbol}: ${pct(p.weight)} of gross, ${pct(p.contribution)} of P&L (${usd(p.pnl, 0)}) — ${side}`}</title>
                  </circle>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
