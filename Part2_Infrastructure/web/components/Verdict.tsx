"use client";

/**
 * The answer to "does this strategy work?" — stated before any chart.
 *
 * A backtest's headline Sharpe is the maximum of N draws, so it is not on its
 * own evidence of anything. This panel puts the deflated number and the
 * out-of-sample number next to the raw one and says plainly which way it went.
 *
 * Styled by classes and a `data-tone` attribute — the last inline-styled
 * surface in the app, converted so its tones ride the status-fill and `-text`
 * tokens, which keeps the AA contract green by construction. The pill answers
 * instantly; the six metrics assemble after it, keyed by data identity.
 *
 * The six are one real `<table>` since 2026-08-23, on a reader's request. As
 * six free-standing columns, a label that wrapped ("Probabilistic Sharpe
 * (PSR)") pushed its own figure a line lower than its neighbours', and the
 * notes — one line here, two there — left the row with no bottom edge. The
 * labels are the header band, so every figure starts on the same line; each
 * figure and its note share a cell, with the house frame and column rules
 * around them. Six columns at the figure size need ~900px, so below that the
 * wrap scrolls rather than letting a figure break.
 */

import { type CSSProperties } from "react";

import DsrSearchDistribution from "@/components/research/DsrSearchDistribution";
import { SweepResponse } from "@/lib/types";
import { fmt, trackRecordNote } from "@/lib/format";

const STATUS = {
  pass: { icon: "✓", label: "PASS" },
  marginal: { icon: "!", label: "MARGINAL" },
  fail: { icon: "✕", label: "FAIL" },
} as const;

export default function Verdict({ data }: { data: SweepResponse }) {
  const s = STATUS[data.verdict.level];
  const oos = data.walkForwardOosSharpe;
  const psr = data.probabilisticSharpeRatio;
  // Optional-chained so a payload cached before MinTRL existed still renders.
  const trl = data.minTrackRecord?.vsZero ?? null;
  const trlDisplay = trackRecordNote(trl?.bars ?? null, data.bars, data.request.interval);

  const metrics: VerdictMetric[] = [
    {
      label: "In-sample Sharpe",
      value: fmt(data.best.sharpe, 2),
      note: `best of ${data.combosTested} combos`,
    },
    {
      label: "Hurdle from the search",
      value: fmt(data.expectedMaxSharpe, 2),
      note: `what ${data.combosTested} random trials would beat`,
    },
    {
      label: "Probabilistic Sharpe (PSR)",
      value: fmt(psr, 3),
      note: "P(true Sharpe > 0) before the search penalty",
      tone: psr < 0.95 ? "warn" : undefined,
    },
    {
      label: "Deflated Sharpe (DSR)",
      value: fmt(data.deflatedSharpeRatio, 3),
      note: "P(true Sharpe > 0) after paying for the search",
      tone: "verdict",
    },
    {
      label: `Min track record (${Math.round((data.minTrackRecord?.confidence ?? 0.95) * 100)}%)`,
      value: trlDisplay.value,
      note: trlDisplay.note,
      tone: trlDisplay.met === false ? "critical" : undefined,
    },
    {
      label: "Walk-forward OOS Sharpe",
      value: oos == null ? "—" : fmt(oos, 2),
      note: "on data the parameters never saw",
      tone: oos != null && oos <= 0 ? "critical" : undefined,
    },
  ];

  return (
    <div className="card verdict-card" data-tone={data.verdict.level}>
      <div className="verdict-lead">
        {/* Status is icon + label + colour — never colour alone. */}
        <div className="verdict-pill">
          <span aria-hidden>{s.icon}</span>
          <span>{s.label}</span>
        </div>

        <div className="verdict-headline">
          <h3>{data.verdict.headline}</h3>
          <p>{data.verdict.detail}</p>
        </div>
      </div>

      {/* The pill above answered instantly; the evidence assembles after it.
          Keyed by data identity so only a new result replays the stagger —
          re-renders and resizes leave settled metrics alone. `.table-wrap` is
          focusable so a keyboard reader can reach the sideways scroll. */}
      <div key={data.dataHash ?? "metrics"} className="table-wrap verdict-metrics" tabIndex={0}>
        <table className="verdict-table">
          <caption className="sr-only">
            The six figures the verdict is read from, one per column: the in-sample Sharpe,
            the hurdle the search set, the probabilistic and deflated Sharpe ratios, the
            minimum track record and the walk-forward out-of-sample Sharpe.
          </caption>
          <thead>
            <tr>
              {metrics.map((metric) => (
                <th key={metric.label} scope="col" className="verdict-metric__label">
                  {metric.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {metrics.map((metric, index) => (
                <Metric key={metric.label} index={index} {...metric} />
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <DsrSearchDistribution data={data} />

      {/* No benchmark figures here. The stat row immediately below this card
          carries them where they belong — beside the strategy's own numbers,
          as "buy & hold −1.11" under Annualised Sharpe and "buy & hold −40.7%"
          under Total return — which is where a reader compares them.
          copy-audit.test.ts holds that. */}
    </div>
  );
}

interface VerdictMetric {
  label: string;
  value: string;
  note: string;
  /** `verdict` inherits the card's tone; the others are absolute. */
  tone?: "warn" | "critical" | "verdict";
}

/** One column's body cell: the figure over its note. The label is the column header. */
function Metric({
  index,
  value,
  note,
  tone,
}: VerdictMetric & {
  /** Position in the 40ms stagger. */
  index: number;
}) {
  return (
    <td className="stagger-reveal verdict-metric" style={{ "--stagger-i": index } as CSSProperties}>
      <div className="num verdict-metric__value" data-tone={tone}>
        {value}
      </div>
      <div className="verdict-metric__note">{note}</div>
    </td>
  );
}
