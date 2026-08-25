"use client";

/**
 * What the corpus is made of and whether its parts agree, in one figure.
 *
 * "Fix corpus diagrams and the information is too cluttered."
 *
 * IT WAS FIVE OBJECTS FOR TWO FACTS. The Composition view drew a `ValueStrip`
 * of each series' share, then a second `ValueStrip` of each series' own bias
 * slope, then a paragraph restating the first strip's reading, then a fold with
 * a table carrying both columns again, then a fold with the gateway's detail.
 * Every one of them was about the same four rows.
 *
 * AND THE TWO FACTS ONLY MEAN ANYTHING TOGETHER. The view exists to say that
 * the corpus is not a random sample — one series is usually most of it — and
 * that the aggregate slope on the Score view can be faked by a mixture, because
 * two series pointing opposite ways sit at one together. A reader has to hold
 * SHARE and SLOPE in mind at once to see either claim, and two strips one above
 * the other are the shape that makes that hardest: the same four labels twice,
 * on two axes, with the eye asked to join them by name.
 *
 * ONE MARK CARRIES BOTH. Position is the slope against the rule at one — the
 * only reading that matters there is distance from it, in which direction. Bar
 * HEIGHT is the share of the corpus. So a heavy mark far from the rule is the
 * finding: most of what was scored is a series whose prices did not move with
 * its outcomes, and every figure on Score is mostly a score of that.
 *
 * WHY HEIGHT AND NOT LENGTH for the share. Length is already spoken for by the
 * slope, and a mark encoding two quantities on the same axis is a mark that can
 * be read wrong in one direction. Height is free here — the rows are a list,
 * not a scale — and a reader never has to be told which end is which.
 *
 * It reads nothing: both fields are on the calibration payload the section has.
 */

import Figure, { FigureEmpty, Plot } from "./Figure";
import { DIAGRAM_LABEL_PX, advancePx } from "@/lib/coherence/label-metrics";
import { pct } from "@/lib/format";
import type { CoherenceCalibration } from "@/lib/coherence/types-lab";

const ROW_H = 30;
const MARGIN = { top: 26, bottom: 30 };
/** The thinnest and thickest a share may draw, so a 1% series is still a mark. */
const BAR_MIN = 4;
const BAR_MAX = 19;
/** How far either side of the calibrated slope the axis reaches. */
const SPREAD = 0.6;

interface Row {
  ticker: string;
  count: number;
  share: number | null;
  slope: number | null;
  slopeText: string;
}

function rowsOf(data: CoherenceCalibration): { rows: Row[]; corpus: number } {
  const corpus = data.composition.reduce((sum, row) => sum + row.count, 0);
  const slopes = new Map((data.bias_by_series ?? []).map((row) => [row.series_ticker, row.slope]));
  const rows = [...data.composition]
    .sort((a, b) => b.count - a.count)
    .map((row) => {
      const raw = slopes.get(row.series_ticker);
      const slope = raw == null ? null : Number(raw);
      return {
        ticker: row.series_ticker,
        count: row.count,
        share: corpus > 0 ? row.count / corpus : null,
        // NOT `|| null`: a slope of exactly zero is a real reading — prices that
        // did not move with the outcome at all — and would be erased by it.
        slope: slope != null && Number.isFinite(slope) ? slope : null,
        slopeText: raw == null ? "no slope reported" : raw.slice(0, 6),
      };
    });
  return { rows, corpus };
}

export default function CorpusShares({ data }: { data: CoherenceCalibration }) {
  const { rows, corpus } = rowsOf(data);
  const heaviest = rows[0] ?? null;
  const scored = rows.filter((row) => row.slope != null);

  if (!rows.length) {
    return (
      <Figure
        caption="What the corpus is made of, and whether its parts agree"
        ariaLabel="No series named itself in the settled corpus"
      >
        <FigureEmpty reason="Nothing that has settled names the series it came from, so the corpus cannot be split." />
      </Figure>
    );
  }

  const height = MARGIN.top + rows.length * ROW_H + MARGIN.bottom;
  const widest = Math.max(...rows.map((row) => Math.abs((row.slope ?? 1) - 1)), 0.05);
  const reach = Math.min(SPREAD, Math.max(0.15, widest * 1.25));

  return (
    <Figure
      caption="What the corpus is made of, and whether its parts agree"
      ariaLabel={
        `${rows.length} series, each drawn at its own bias slope against a calibrated one, `
        + `with bar height carrying its share of the ${corpus} settled markets`
      }
      reading={
        heaviest && heaviest.share != null
          ? `Not a random sample: ${heaviest.ticker} alone is ${pct(heaviest.share)} of it, so every figure on the Scorecard scores THIS mixture.`
          : `${corpus} of the ${data.count} scored markets name their series, so every figure on the Scorecard scores THIS mixture.`
      }
      missing={
        scored.length < rows.length
          ? `${rows.length - scored.length} of the ${rows.length} series carry no slope: the engine reported none, which is not a slope of one.`
          : null
      }
      notes={[
        "Height is the share of the corpus and position is the slope, because the two only mean "
        + "anything together: an aggregate slope sitting at one can be two series pointing opposite "
        + "ways, and the Scorecard cannot show that.",
        "Above the rule is the classic favourite-longshot shape — prices moving MORE than the outcomes "
        + "warranted. Below it they moved less. The rule itself is a series whose prices tracked what "
        + "happened.",
      ]}
    >
      <Plot height={height}>
        {(width: number) => {
          const gutter = Math.max(...rows.map((row) => advancePx(row.ticker, DIAGRAM_LABEL_PX)));
          // "89.3%, slope no slope reported" — the word was prefixed to a
          // string that already carried it on the branch where there is none.
          const meta = rows.map((row) =>
            `${row.share == null ? "—" : pct(row.share)}, ${row.slope == null ? row.slopeText : `slope ${row.slopeText}`}`);
          const values = Math.max(...meta.map((text) => advancePx(text, DIAGRAM_LABEL_PX))) + 14;
          const x0 = gutter + 10;
          const x1 = width - values;
          const mid = (x0 + x1) / 2;
          const x = (slope: number) =>
            mid + (Math.max(-reach, Math.min(reach, slope - 1)) / reach) * ((x1 - x0) / 2);

          return (
            <>
              <line x1={mid} x2={mid} y1={MARGIN.top - 8} y2={MARGIN.top + rows.length * ROW_H} className="coh-mix__rule" />
              <text x={mid} y={MARGIN.top - 12} textAnchor="middle" className="coh-mix__tick">
                slope 1
              </text>
              <text x={x0} y={height - 10} className="coh-mix__tick">
                {`prices moved less than the outcomes (${(1 - reach).toFixed(2)})`}
              </text>
              <text x={x1} y={height - 10} textAnchor="end" className="coh-mix__tick">
                {`prices moved more (${(1 + reach).toFixed(2)})`}
              </text>

              {rows.map((row, index) => {
                const y = MARGIN.top + index * ROW_H + ROW_H / 2;
                const bar = row.share == null
                  ? BAR_MIN
                  : Math.max(BAR_MIN, Math.min(BAR_MAX, BAR_MIN + row.share * (BAR_MAX - BAR_MIN)));
                const at = row.slope == null ? null : x(row.slope);
                return (
                  <g key={row.ticker}>
                    <text x={gutter} y={y + 4} textAnchor="end" className="coh-mix__name">
                      {row.ticker}
                    </text>
                    {at == null ? (
                      <>
                        {/* A SHARE WITH NO SLOPE IS STILL A SHARE. Drawn at the
                            rule and hatched, so it is visibly not a reading of
                            one rather than silently absent from the mixture. */}
                        <rect
                          x={mid - bar / 2} y={y - bar / 2} width={bar} height={bar}
                          className="coh-mix__unscored"
                        >
                          <title>{`${row.ticker}: ${row.count} settled, ${row.slopeText}`}</title>
                        </rect>
                        <text x={mid + bar} y={y + 4} className="coh-mix__withheld" aria-hidden="true">◌</text>
                      </>
                    ) : (
                      <rect
                        x={Math.min(mid, at)}
                        y={y - bar / 2}
                        width={Math.max(2, Math.abs(at - mid))}
                        height={bar}
                        className={`coh-mix__bar${row.slope != null && row.slope > 1 ? " is-over" : " is-under"}`}
                      >
                        <title>
                          {`${row.ticker}: ${row.count} of ${corpus} settled markets, slope ${row.slopeText} — `
                            + `${(row.slope ?? 1) > 1 ? "prices moved more than the outcomes warranted" : (row.slope ?? 1) < 1 ? "prices moved less" : "prices tracked the outcomes"}`}
                        </title>
                      </rect>
                    )}
                    <text x={x1 + 12} y={y + 4} className="coh-mix__meta">
                      {meta[index]}
                    </text>
                  </g>
                );
              })}
            </>
          );
        }}
      </Plot>
    </Figure>
  );
}
