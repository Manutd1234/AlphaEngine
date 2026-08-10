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
 */

import { type CSSProperties } from "react";

import { SweepResponse } from "@/lib/types";
import { fmt, signedPct, trackRecordNote } from "@/lib/format";

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
          re-renders and resizes leave settled metrics alone. */}
      <div key={data.dataHash ?? "metrics"} className="verdict-metrics">
        <Metric
          index={0}
          label="In-sample Sharpe"
          value={fmt(data.best.sharpe, 2)}
          note={`best of ${data.combosTested} combos`}
        />
        <Metric
          index={1}
          label="Hurdle from the search"
          value={fmt(data.expectedMaxSharpe, 2)}
          note={`what ${data.combosTested} random trials would beat`}
        />
        <Metric
          index={2}
          label="Probabilistic Sharpe (PSR)"
          value={fmt(psr, 3)}
          note="P(true Sharpe > 0) before the search penalty"
          tone={psr < 0.95 ? "warn" : undefined}
        />
        <Metric
          index={3}
          label="Deflated Sharpe (DSR)"
          value={fmt(data.deflatedSharpeRatio, 3)}
          note="P(true Sharpe > 0) after paying for the search"
          tone="verdict"
        />
        <Metric
          index={4}
          label={`Min track record (${Math.round((data.minTrackRecord?.confidence ?? 0.95) * 100)}%)`}
          value={trlDisplay.value}
          note={trlDisplay.note}
          tone={trlDisplay.met === false ? "critical" : undefined}
        />
        <Metric
          index={5}
          label="Walk-forward OOS Sharpe"
          value={oos == null ? "—" : fmt(oos, 2)}
          note="on data the parameters never saw"
          tone={oos != null && oos <= 0 ? "critical" : undefined}
        />
      </div>

      <p className="verdict-benchmark">
        Buy &amp; hold over the same window returned{" "}
        <strong className="num">{signedPct(data.benchmark.totalReturn)}</strong> at Sharpe{" "}
        <strong className="num">{fmt(data.benchmark.sharpe, 2)}</strong>. A strategy that does not
        beat that after costs has not earned its complexity.
      </p>
    </div>
  );
}

function Metric({
  index,
  label,
  value,
  note,
  tone,
}: {
  /** Position in the 40ms stagger. */
  index: number;
  label: string;
  value: string;
  note: string;
  /** `verdict` inherits the card's tone; the others are absolute. */
  tone?: "warn" | "critical" | "verdict";
}) {
  return (
    <div className="stagger-reveal verdict-metric" style={{ "--stagger-i": index } as CSSProperties}>
      <div className="verdict-metric__label">{label}</div>
      <div className="num verdict-metric__value" data-tone={tone}>
        {value}
      </div>
      <div className="verdict-metric__note">{note}</div>
    </div>
  );
}
