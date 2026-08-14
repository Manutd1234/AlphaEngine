"use client";

/**
 * What a fill actually cost, split into the parts that can be measured.
 *
 * Effective spread is impact: `2 x |slippage|` against the consolidated mid the
 * gateway priced the decision at. Fee is the explicit half. Together they are
 * the cost the desk paid. Realized spread — what you would need to separate
 * impact from reversion — requires the mid a few minutes after the fill, and no
 * endpoint in this system serves one, so it is drawn as an empty dashed column
 * rather than at zero.
 *
 * That third column is the point of the chart rather than an apology for it. A
 * two-bar chart of impact and fee would look complete and quietly imply that
 * cost has been fully decomposed; the gap says which question is still open and
 * names the table that would answer it.
 *
 * The withheld-column idiom is `PnlWaterfall`'s, deliberately: one convention
 * for "measured at zero" versus "not measured", used on both surfaces that need
 * it. Axis labels are hand-placed rather than delegated to `XAxis`, for the
 * reason that component's own caller notes — it drops labels inside `minGap`,
 * and a dropped label on a two-to-six column chart is a missing venue.
 */

import { DEFAULT_MARGIN, Grid, extent, linearScale, ticks, useMeasuredWidth } from "@/components/chart-kit";
import { REALIZED_SPREAD_WITHHELD, venueQuality, type BlotterRow } from "@/lib/blotter";

const HEIGHT = 210;
const MARGIN = { ...DEFAULT_MARGIN, right: 18, bottom: 42 };

export default function SpreadDecomposition({
  rows,
  source = "live",
}: {
  rows: BlotterRow[];
  source?: "live" | "sandbox" | "unavailable";
}) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>(620);
  const mix = venueQuality(rows);

  if (source === "unavailable") {
    return (
      <section className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Cost decomposition</span>
            <h2>Effective spread and fee</h2>
          </div>
        </div>
        <p className="muted">
          No audit log is reachable in this deployment, so no fill has a price to measure a spread
          against. Cost decomposition needs the executions, not the book.
        </p>
      </section>
    );
  }

  const priced = mix.venues.filter((venue) => venue.effectiveSpreadBps != null);

  if (!priced.length) {
    return (
      <section className="card">
        <div className="portfolio-card-heading">
          <div>
            <span className="page-kicker">Cost decomposition</span>
            <h2>Effective spread and fee</h2>
          </div>
        </div>
        <p className="muted">
          No priced fill in this window. Rejections carry no execution price, so a rejected-only
          window has nothing to decompose — this is an absence of trading, not of measurement.
        </p>
      </section>
    );
  }

  const values = priced.flatMap((venue) => [venue.effectiveSpreadBps ?? 0, venue.meanFeeBps ?? 0]);
  const [, hi] = extent([0, ...values]);
  const yTicks = ticks(0, hi * 1.1, 4);
  const top = Math.max(hi * 1.1, yTicks[yTicks.length - 1] ?? 1);

  const plotW = Math.max(160, width - MARGIN.left - MARGIN.right);
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const yScale = linearScale(0, top, MARGIN.top + plotH, MARGIN.top);
  const groupW = plotW / priced.length;
  // Three slots per venue: effective, fee, realized (withheld).
  const barW = Math.min(30, (groupW - 18) / 3);

  return (
    <section className="card">
      {/* The Where pane's own grammar — section-heading compact + h3, like
          FillQualityHeatmap beside it. This card wore the portfolio heading
          class (kicker + underlined h2), so one pane showed two card-header
          styles and a skipped heading level between peer cards. */}
      <header className="section-heading compact">
        <div>
          <h3>Effective spread and fee</h3>
          <p className="muted">Cost decomposition per venue.</p>
        </div>
        <span className="section-note">{mix.totalFills} fills</span>
      </header>

      <div ref={ref}>
        <svg width="100%" height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
          aria-label={`Effective spread and fee in basis points across ${priced.length} venues. Realized spread is not measured.`}>
          <Grid yTicks={yTicks} yScale={yScale} x0={MARGIN.left} x1={MARGIN.left + plotW}
            format={(v) => `${v.toFixed(0)}`} />

          {priced.map((venue, index) => {
            const x0 = MARGIN.left + index * groupW + (groupW - barW * 3 - 12) / 2;
            const base = MARGIN.top + plotH;
            const effective = venue.effectiveSpreadBps ?? 0;
            const fee = venue.meanFeeBps;

            return (
              <g key={venue.venue}>
                <rect x={x0} y={yScale(effective)} width={barW}
                  height={Math.max(1, base - yScale(effective))}
                  fill="var(--diverging-neg)" rx={2}>
                  <title>{`${venue.venue} — effective spread ${effective.toFixed(1)} bps`}</title>
                </rect>

                {fee != null ? (
                  <rect x={x0 + barW + 6} y={yScale(fee)} width={barW}
                    height={Math.max(1, base - yScale(fee))}
                    fill="var(--series-2)" rx={2}>
                    <title>{`${venue.venue} — fee ${fee.toFixed(1)} bps`}</title>
                  </rect>
                ) : (
                  <rect x={x0 + barW + 6} y={base - 1} width={barW} height={1} fill="var(--axis)">
                    <title>{`${venue.venue} — no fee recorded`}</title>
                  </rect>
                )}

                {/* Withheld, not zero. Same convention as PnlWaterfall's absent
                    legs: a dashed empty column and the word, so the gap reads as
                    a measurement nobody took rather than a cost of nothing. */}
                <rect x={x0 + barW * 2 + 12} y={MARGIN.top + plotH * 0.35} width={barW}
                  height={plotH * 0.65} fill="none" stroke="var(--border)" strokeWidth={1}
                  strokeDasharray="3 3" rx={2}>
                  <title>{`${venue.venue} — realized spread not measured`}</title>
                </rect>
                <text x={x0 + barW * 2 + 12 + barW / 2} y={MARGIN.top + plotH * 0.3}
                  textAnchor="middle" fontSize={9.5} fill="var(--text-muted)" fontFamily="var(--mono)">
                  n/a
                </text>

                <text x={x0 + (barW * 3 + 12) / 2} y={base + 16} textAnchor="middle"
                  fontSize={10.5} fill="var(--text-secondary)" fontWeight={650}>
                  {venue.venue}
                </text>
                <text x={x0 + (barW * 3 + 12) / 2} y={base + 29} textAnchor="middle"
                  fontSize={9.5} fill="var(--text-muted)" fontFamily="var(--mono)">
                  {venue.fills} fills
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <ul className="legend">
        <li><i aria-hidden style={{ background: "var(--diverging-neg)" }} /> Effective spread</li>
        <li><i aria-hidden style={{ background: "var(--series-2)" }} /> Fee</li>
        <li><i aria-hidden className="is-withheld" /> Realized spread — not measured</li>
      </ul>

      <div className="table-wrap" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th className="num">Effective</th>
              <th className="num">Fee</th>
              <th className="num">Realized</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((venue) => (
              <tr key={venue.venue}>
                <td><strong>{venue.venue}</strong></td>
                <td className="num">{venue.effectiveSpreadBps!.toFixed(1)} bps</td>
                <td className="num">{venue.meanFeeBps != null ? `${venue.meanFeeBps.toFixed(1)} bps` : "—"}</td>
                <td className="num">—</td>
                <td>measured · measured · not measurable</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="research-note">
        Effective spread is <span className="num">2 × |slippage|</span> against the consolidated mid
        the gateway priced each decision at, so this is the textbook measure rather than a proxy for
        it. {REALIZED_SPREAD_WITHHELD}
        {source === "sandbox" && " Generated desk."}
      </p>
    </section>
  );
}
