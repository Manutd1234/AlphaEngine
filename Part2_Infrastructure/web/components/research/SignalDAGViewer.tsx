"use client";

/**
 * The signal path — depth in, paper order out, as far as this deployment can
 * actually see it.
 *
 * WHAT THIS PANEL USED TO SAY, and why replacing it mattered more than any
 * chart on the roadmap: it rendered a hardcoded five-stage array claiming a
 * "FIX Protocol Execution Engine … dispatching 35=D orders and auditing 35=8
 * execution reports", a "Pre-Trade Risk Gateway (15 Gates)", and per-stage
 * latencies of 0.2ms / 0.5ms / 0.8ms / 1.1ms. There is no FIX in this system —
 * the gateway is FastAPI over REST to Binance and Bybit — the gate count
 * appeared nowhere else in the repository, and the latencies were string
 * literals. The status pill read `{STEPS.length}/{STEPS.length} stages active`
 * in green, so it was 5/5 healthy by construction and could not report a fault
 * if one occurred.
 *
 * It took no props and read no state, on the tab a reader opens to learn what
 * the pipeline is, in a product whose every other surface refuses to draw an
 * unmeasured number.
 *
 * Now every stage, state and figure comes from `deriveSignalPath`, which is a
 * pure function over the health snapshot and is tested without a DOM. Colour
 * never carries the meaning alone: each node prints a glyph and the state word
 * beside it, and each names the wire field it was read from, so a reader can
 * check the claim rather than take it.
 */

import { useState } from "react";

import type { SystemHealth } from "@/components/systems/types";
import {
  deriveSignalPath,
  STAGE_GLYPH,
  STAGE_WORD,
  summariseSignalPath,
  type SignalStage,
} from "@/lib/signal-path";

export default function SignalDAGViewer({
  health,
  healthError,
}: {
  health: SystemHealth | null;
  healthError: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const stages = deriveSignalPath(health, healthError);
  const summary = summariseSignalPath(stages);
  const open: SignalStage | null = stages.find((s) => s.id === selected) ?? null;

  return (
    <div className="card signal-workflow">
      <div className="portfolio-card-heading">
        <div>
          <span className="page-kicker">Data lineage &amp; pipeline</span>
          <h2>Signal path</h2>
        </div>
        {/* Counts by state, so this can go amber and red. The pill it replaces
            printed the array's own length over itself and was green always. */}
        <span className={`pill is-${summary.tone}`}>{summary.label}</span>
      </div>

      <p className="sub">
        Consolidated depth through the pre-trade battery to a paper order, with each stage&rsquo;s
        state read from the health snapshot rather than described. Select a stage for the reading
        behind it. Orders are paper only: this desk holds no funds and reaches no real venue.
      </p>

      <ol className="signal-workflow__track" aria-label="Signal path stages">
        {stages.map((stage, index) => (
          <li key={stage.id} className="signal-workflow__stage">
            <button
              type="button"
              className={`signal-workflow__node${selected === stage.id ? " is-selected" : ""}`}
              aria-pressed={selected === stage.id}
              data-state={stage.state}
              onClick={() => setSelected(selected === stage.id ? null : stage.id)}
            >
              <span className="signal-workflow__step">
                Step {index + 1} · {stage.role}
              </span>
              <strong>{stage.name}</strong>
              <span className="signal-workflow__meta">
                {/* A stage nothing measures says so, rather than borrowing a
                    plausible number from the stage next to it. */}
                <span className="num">{stage.measured ?? "not measured"}</span>
                <em>
                  <span aria-hidden>{STAGE_GLYPH[stage.state]}</span> {STAGE_WORD[stage.state]}
                </em>
              </span>
            </button>
            {index < stages.length - 1 && (
              <span className="signal-workflow__arrow" aria-hidden>
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {open && (
        <div className="signal-workflow__detail" role="status">
          <strong>{open.name}</strong>
          <p>{open.detail}</p>
          {/* The provenance line is the point of the panel: it lets a reader
              verify the state above instead of trusting it. */}
          <p className="signal-workflow__source">
            Read from <code>{open.source}</code>
          </p>
        </div>
      )}
    </div>
  );
}
