"use client";

/**
 * The signal execution workflow — raw depth in, routed order out.
 *
 * Every colour here used to be a hardcoded hex from a dark palette (#090d12
 * strip, #111827 nodes, #38bdf8 labels) dropped inside a white card, so the
 * panel read as a foreign screenshot pasted into the page and inverted itself
 * against the theme. It now uses the house tokens like every other surface, so
 * it follows the light and dark palettes instead of fighting them.
 */

import { useState } from "react";

interface WorkflowStep {
  id: string;
  name: string;
  category: "data" | "alpha" | "optimizer" | "risk" | "fix";
  status: "active" | "passing" | "verified";
  latency: string;
  details: string;
}

const STEPS: WorkflowStep[] = [
  {
    id: "node-1",
    name: "Binance & Bybit L2 Depth Stream",
    category: "data",
    status: "active",
    latency: "0.2ms",
    details: "Consolidated L2 websocket depth stack streaming 100ms snapshots across 12 symbol pairs.",
  },
  {
    id: "node-2",
    name: "Trend & Mean Reversion Alpha Signals",
    category: "alpha",
    status: "passing",
    latency: "0.5ms",
    details: "DSR-validated momentum signals generating real-time buy/sell allocation weights.",
  },
  {
    id: "node-3",
    name: "Euler Variance Portfolio Optimizer",
    category: "optimizer",
    status: "verified",
    latency: "0.8ms",
    details: "Risk-budget constrained Mean-Variance optimizer targeting max Sharpe ratio under leverage cap.",
  },
  {
    id: "node-4",
    name: "Pre-Trade Risk Gateway (15 Gates)",
    category: "risk",
    status: "verified",
    latency: "0.2ms",
    details: "15 hard limit checks (drawdown, max gross, price collar, fat finger, rate limit) evaluated in 0.2ms.",
  },
  {
    id: "node-5",
    name: "FIX Protocol Execution Engine",
    category: "fix",
    status: "active",
    latency: "1.1ms",
    details: "FIX 4.2 / 4.4 order execution engine dispatching 35=D orders and auditing 35=8 execution reports.",
  },
];

export default function SignalDAGViewer() {
  const [selected, setSelected] = useState<WorkflowStep | null>(null);

  return (
    <div className="card signal-workflow">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Data lineage &amp; pipeline</span>
          <h2>Signal Execution Workflow</h2>
        </div>
        <span className="pill is-good">{STEPS.length}/{STEPS.length} stages active</span>
      </div>

      <p className="sub">
        Quantitative signal lineage from the raw L2 depth stream through pre-trade risk validation to
        FIX order routing. Select a stage to read what it does.
      </p>

      <ol className="signal-workflow__track" aria-label="Signal execution stages">
        {STEPS.map((step, index) => (
          <li key={step.id} className="signal-workflow__stage">
            <button
              type="button"
              className={`signal-workflow__node${selected?.id === step.id ? " is-selected" : ""}`}
              aria-pressed={selected?.id === step.id}
              onClick={() => setSelected(selected?.id === step.id ? null : step)}
            >
              <span className="signal-workflow__step">
                Step {index + 1} · {step.category}
              </span>
              <strong>{step.name}</strong>
              <span className="signal-workflow__meta">
                <span className="num">{step.latency}</span>
                <em>✓ {step.status}</em>
              </span>
            </button>
            {index < STEPS.length - 1 && (
              <span className="signal-workflow__arrow" aria-hidden>
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {selected && (
        <div className="signal-workflow__detail" role="status">
          <strong>{selected.name}</strong>
          <p>{selected.details}</p>
        </div>
      )}
    </div>
  );
}
