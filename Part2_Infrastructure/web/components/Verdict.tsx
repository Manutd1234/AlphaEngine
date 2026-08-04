"use client";

/**
 * The answer to "does this strategy work?" — stated before any chart.
 *
 * A backtest's headline Sharpe is the maximum of N draws, so it is not on its
 * own evidence of anything. This panel puts the deflated number and the
 * out-of-sample number next to the raw one and says plainly which way it went.
 */

import { SweepResponse } from "@/lib/types";
import { fmt, signedPct } from "@/lib/format";

const STATUS = {
  pass: { color: "var(--status-good)", icon: "✓", label: "PASS" },
  marginal: { color: "var(--status-warning)", icon: "!", label: "MARGINAL" },
  fail: { color: "var(--status-critical)", icon: "✕", label: "FAIL" },
} as const;

export default function Verdict({ data }: { data: SweepResponse }) {
  const s = STATUS[data.verdict.level];
  const oos = data.walkForwardOosSharpe;

  return (
    <div className="card" style={{ borderColor: `color-mix(in srgb, ${s.color} 45%, transparent)` }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Status is icon + label + colour — never colour alone. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 12px",
            borderRadius: 999,
            background: `color-mix(in srgb, ${s.color} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${s.color} 45%, transparent)`,
            flexShrink: 0,
          }}
        >
          <span aria-hidden style={{ color: s.color, fontWeight: 700 }}>
            {s.icon}
          </span>
          <span style={{ color: s.color, fontWeight: 700, fontSize: 12.5, letterSpacing: "0.06em" }}>
            {s.label}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ fontSize: 18, letterSpacing: "-0.01em", marginBottom: 4 }}>
            {data.verdict.headline}
          </h3>
          <p style={{ fontSize: 13.5, color: "var(--text-secondary)", maxWidth: "72ch" }}>
            {data.verdict.detail}
          </p>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginTop: 18,
          paddingTop: 16,
          borderTop: "1px solid var(--grid)",
        }}
      >
        <Metric
          label="In-sample Sharpe"
          value={fmt(data.best.sharpe, 2)}
          note={`best of ${data.combosTested} combos`}
        />
        <Metric
          label="Hurdle from the search"
          value={fmt(data.expectedMaxSharpe, 2)}
          note={`what ${data.combosTested} random trials would beat`}
        />
        <Metric
          label="Deflated Sharpe (DSR)"
          value={fmt(data.deflatedSharpeRatio, 3)}
          note="P(true Sharpe > 0) after paying for the search"
          emphasis={s.color}
        />
        <Metric
          label="Walk-forward OOS Sharpe"
          value={oos == null ? "—" : fmt(oos, 2)}
          note="on data the parameters never saw"
          emphasis={oos != null && oos <= 0 ? "var(--status-critical)" : undefined}
        />
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 14, maxWidth: "80ch" }}>
        Buy &amp; hold over the same window returned{" "}
        <strong className="num">{signedPct(data.benchmark.totalReturn)}</strong> at Sharpe{" "}
        <strong className="num">{fmt(data.benchmark.sharpe, 2)}</strong>. A strategy that does not
        beat that after costs has not earned its complexity.
      </p>
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  emphasis,
}: {
  label: string;
  value: string;
  note: string;
  emphasis?: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)" }}>
        {label}
      </div>
      <div
        className="num"
        style={{ fontSize: 24, fontWeight: 650, letterSpacing: "-0.02em", color: emphasis ?? "var(--text-primary)" }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.35 }}>{note}</div>
    </div>
  );
}
