"use client";

/**
 * The stake plan drawn: each outcome's share of the bankroll as a bar.
 *
 * Added on the third 2026-08-24 review ("every subtab must have an interactive
 * diagram"): Plan and All outcomes opened on a bare table, and a ranked list
 * of fractions is the most drawable thing on the section. The bars draw ONLY
 * what the table's Stake column states — the figure ranks, the table proves.
 *
 * A passed-over outcome keeps its row with a ○ and no bar: dropping it would
 * hide half the ranking, and a zero-length bar would claim a solved stake of
 * zero where the solver declined to stake at all. A fraction that does not
 * parse draws a dash, never a zero.
 */

import type { CoherenceKelly } from "@/lib/coherence/types-lab";
import Figure, { FigureEmpty, Plot } from "../Figure";
import { decimalLabel } from "./DistributionView";

/**
 * A wire decimal as a plain number, for BAR GEOMETRY only. A Kelly fraction
 * can carry eighteen places, finer than a centicent, so `toCenticents`
 * refuses it and is right to. Six places place a rectangle; every number a
 * reader READS comes from `decimalLabel`.
 */
export function toRatio(raw: string | null | undefined): number | null {
  if (raw == null || !/^-?\d*(?:\.\d*)?$/.test(raw.trim()) || !raw.trim()) return null;
  const [whole, fraction = ""] = raw.trim().split(".");
  const value = Number(whole || "0") + Number(`0.${fraction.slice(0, 6) || "0"}`);
  return Number.isFinite(value) ? value : null;
}

const ROW_H = 22;
const TOP = 6;
const BOTTOM = 8;
/** Outcome labels at the 12px series rung, ≈6.9px a glyph: 24 characters. */
const LABEL_W = 170;
const VALUE_W = 74;

export default function StakeBars({ stakes, caption }: {
  stakes: CoherenceKelly["stakes"];
  caption: string;
}) {
  if (!stakes.length) {
    return (
      <Figure caption={caption} ariaLabel="No outcome to draw">
        <FigureEmpty reason="The solver ranked no outcome." />
      </Figure>
    );
  }
  const ratios = stakes.map((stake) => (stake.admitted ? toRatio(stake.fraction) : null));
  const widest = Math.max(...ratios.map((ratio) => ratio ?? 0), 1e-9);
  const height = TOP + stakes.length * ROW_H + BOTTOM;
  const ariaLabel = stakes
    .map((stake) => `${stake.label}: ${stake.admitted ? `stake ${decimalLabel(stake.fraction, 4)}` : "passed over"}`)
    .join(". ");

  return (
    <Figure caption={caption} ariaLabel={ariaLabel}>
      <Plot height={height}>
        {(width) => {
          const plotW = Math.max(40, width - LABEL_W - VALUE_W);
          return stakes.map((stake, index) => {
            const y = TOP + index * ROW_H;
            const ratio = ratios[index];
            const label = stake.label.length > 24 ? `${stake.label.slice(0, 23)}…` : stake.label;
            return (
              <g key={stake.ticker}>
                <text x={0} y={y + 13} className="coh-axis__label">
                  {label}
                  <title>{stake.label}</title>
                </text>
                {stake.admitted && ratio != null ? (
                  <rect x={LABEL_W} y={y + 4} width={Math.max(1, (ratio / widest) * plotW)} height={ROW_H - 10}
                        className="coh-kelly__bar-staked">
                    <title>{`stake ${decimalLabel(stake.fraction, 6)} of the bankroll`}</title>
                  </rect>
                ) : (
                  <text x={LABEL_W} y={y + 13} className="coh-axis__label">
                    {stake.admitted ? "— no parseable fraction" : "○ passed over"}
                  </text>
                )}
                <text x={width - 2} y={y + 13} textAnchor="end" className="coh-axis__label">
                  {stake.admitted ? decimalLabel(stake.fraction, 4) : "—"}
                </text>
              </g>
            );
          });
        }}
      </Plot>
    </Figure>
  );
}

const G_ROW_H = 26;

/**
 * The Method view's own drawing: the plan's growth against the riskless
 * alternative, as two bars from one zero line — the comparison the seven-row
 * table beneath it exists to argue.
 */
export function GrowthBars({ kelly }: { kelly: CoherenceKelly }) {
  const caption = "Log growth: the plan against the riskless alternative";
  const rows = [
    { label: "plan, at risk", raw: kelly.growth_rate },
    { label: "riskless alternative", raw: kelly.riskless_growth },
  ].map((row) => ({ ...row, value: toRatio(row.raw) }));
  const known = rows.filter((row) => row.value != null);
  if (!known.length) {
    return (
      <Figure caption={caption} ariaLabel="No growth figure to draw"
              missing="Neither growth was priced: no stake was admitted, so there is no rate to compare.">
        <FigureEmpty reason="No growth rate came back." />
      </Figure>
    );
  }
  const top = Math.max(...known.map((row) => Math.abs(row.value as number)), 1e-9);
  const height = 8 + rows.length * G_ROW_H + 8;
  return (
    <Figure
      caption={caption}
      ariaLabel={rows.map((row) => `${row.label}: ${decimalLabel(row.raw, 4)}`).join(". ")}
    >
      <Plot height={height}>
        {(width) => {
          const plotW = Math.max(40, width - LABEL_W - VALUE_W);
          return rows.map((row, index) => {
            const y = 8 + index * G_ROW_H;
            return (
              <g key={row.label}>
                <text x={0} y={y + 14} className="coh-axis__label">{row.label}</text>
                {row.value != null ? (
                  <rect x={LABEL_W} y={y + 5} width={Math.max(1, (Math.abs(row.value) / top) * plotW)}
                        height={G_ROW_H - 12}
                        className={index === 0 ? "coh-kelly__bar-staked" : "coh-kelly__bar-cash"}>
                    <title>{`${row.label}: ${decimalLabel(row.raw, 6)}`}</title>
                  </rect>
                ) : (
                  <text x={LABEL_W} y={y + 14} className="coh-axis__label">— not priced on this solve</text>
                )}
                <text x={width - 2} y={y + 14} textAnchor="end" className="coh-axis__label">
                  {decimalLabel(row.raw, 4)}
                </text>
              </g>
            );
          });
        }}
      </Plot>
    </Figure>
  );
}
