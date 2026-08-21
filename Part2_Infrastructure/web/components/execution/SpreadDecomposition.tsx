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
 * and a dropped label on a two-to-six column chart is a missing venue. Because
 * a name cannot be dropped, a long one is cut to its column by `fitLabel`
 * instead — venue strings are data ("PAPER_EQUITY/Financial Modeling Prep"
 * arrives as long as it likes), so each label is drawn in the measured tick
 * face and ellipsised to the group width, with the full name on the label's
 * own `<title>` and in the table below.
 */

import { LABEL_CLEARANCE, MONO_ADVANCE_EM, TICK_FONT_SIZE, fitLabel } from "@/components/chart-axis";
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
          No audit log is reachable here, so no fill has a price to measure a spread against.
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
          No priced fill in this window. Rejections carry no execution price, so this is an absence
          of trading, not of measurement.
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
        </div>
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
            // Each label is centred on its group, so confining it to the group
            // width minus one clearance keeps every neighbouring pair at least
            // LABEL_CLEARANCE apart at any pane width.
            const labelRoom = Math.max(0, groupW - LABEL_CLEARANCE);
            const name = fitLabel(venue.venue, labelRoom);
            const subLabel = `${venue.fills} fills`;
            const subFits = subLabel.length * 10 * MONO_ADVANCE_EM <= labelRoom;

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
                  textAnchor="middle" fontSize={10} fill="var(--text-muted)" fontFamily="var(--mono)">
                  n/a
                </text>

                {/* The tick face, because the truncation is arithmetic on
                    MONO_ADVANCE_EM: drawn in any other face the measurement
                    would be fiction. The full name and count stay on the
                    <title>, so a cut label is recoverable on hover. */}
                <text x={x0 + (barW * 3 + 12) / 2} y={base + 16} textAnchor="middle"
                  fontSize={TICK_FONT_SIZE} fill="var(--text-secondary)" fontWeight={650}
                  fontFamily="var(--mono)">
                  <title>{`${venue.venue} — ${venue.fills} fills`}</title>
                  {name}
                </text>
                {subFits && (
                  <text x={x0 + (barW * 3 + 12) / 2} y={base + 29} textAnchor="middle"
                    fontSize={10} fill="var(--text-muted)" fontFamily="var(--mono)">
                    {subLabel}
                  </text>
                )}
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
                <td>measured, measured, not measurable</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Lifted out of the fold below, deliberately. A generated-data statement
          is the one sentence a reader would be wrong not to have seen, and a
          disclosure is a one-time notice with extra steps. */}
      {source === "sandbox" && <p className="research-note">Generated desk.</p>}

      {/* Methodology, and the only thing here that folds. Nothing measured
          leaves the screen with it: the withheld leg keeps its dashed column
          and its "n/a", the legend still reads "Realized spread — not
          measured", and the table's Basis cell still reads "measured,
          measured, not measurable". What folds is the WHY. */}
      <details className="disclosure">
        <summary>What is the spread measured against, and why is one column left blank?</summary>
        <p className="research-note">
          Effective spread is <span className="num">2 × |slippage|</span> against the consolidated mid
          the gateway priced each decision at. {REALIZED_SPREAD_WITHHELD}
        </p>
      </details>
    </section>
  );
}
