"use client";

/**
 * Parameter stability — is the winner a plateau or a cliff?
 *
 * The grid already reported a champion. The champion is not the finding; the
 * *shape around* the champion is. A strategy whose Sharpe degrades smoothly as
 * parameters move has an edge that tolerates being slightly wrong about the
 * parameters, which is the only kind that survives contact with live data. One
 * bright cell surrounded by nothing is a coordinate the search found in noise —
 * and the reported Sharpe is identical in both cases.
 *
 * So this panel does two things the surface chart alone cannot: it recolours the
 * grid by *neighbourhood behaviour* rather than by return, and it states the
 * winner's retention as a number with a verdict attached.
 */

import { useState } from "react";

import Heatmap from "@/components/Heatmap";
import { fmt } from "@/lib/format";
import type { ParamResult, StabilityReport } from "@/lib/types";

interface StabilityPanelProps {
  stability: StabilityReport;
  results: ParamResult[];
  best: ParamResult;
  selected: ParamResult | null;
  onSelect: (r: ParamResult) => void;
}

const LEVEL_TONE: Record<string, string> = {
  pass: "var(--success-text)",
  marginal: "var(--warning-text)",
  fail: "var(--critical-text)",
};

const LEVEL_GLYPH: Record<string, string> = { pass: "✓", marginal: "▲", fail: "✕" };

/**
 * The grid size below which there is no neighbourhood to draw.
 *
 * `parameterStability` classifies a cell from the tested cells around it and
 * calls anything with fewer than three of them `isolated`, so a sweep of three
 * or fewer combinations produces a surface every cell of which is unclassified.
 * The workspace used to express that by not rendering this panel at all, which
 * is the one thing an honest panel may not do: half the Parameters bench
 * disappeared and nothing said why, on a state the range sliders reach
 * directly. The threshold lives here now, and the panel reports it.
 */
const MIN_SURFACE_RESULTS = 3;

export default function StabilityPanel({
  stability,
  results,
  best,
  selected,
  onSelect,
}: StabilityPanelProps) {
  const [mode, setMode] = useState<"sharpe" | "stability">("stability");
  const winner = stability.best;

  if (results.length <= MIN_SURFACE_RESULTS) {
    return (
      <div className="card">
        <div className="section-heading compact">
          <div>
            <span className="page-kicker">Robustness</span>
            <h2>Parameter surface &amp; stability</h2>
          </div>
          <span className="section-note">
            {results.length} of {MIN_SURFACE_RESULTS + 1} combinations needed
          </span>
        </div>

        {/* The engine already wrote a verdict for this grid and nobody ever
            read it: with the panel unrendered, "The winner sits on the grid
            edge" and its instruction to widen the range went nowhere. */}
        <div
          className="stability-verdict"
          style={{ borderLeftColor: LEVEL_TONE[stability.verdict.level] }}
          role="status"
        >
          <strong style={{ color: LEVEL_TONE[stability.verdict.level] }}>
            <span aria-hidden>{LEVEL_GLYPH[stability.verdict.level]}</span>{" "}
            {stability.verdict.headline}
          </strong>
          <p>{stability.verdict.detail}</p>
        </div>

        <p className="sub">
          No surface is drawn from {results.length} combination{results.length === 1 ? "" : "s"}: a
          neighbourhood needs at least {MIN_SURFACE_RESULTS + 1}. Widen the fast or slow range, or cut
          the step, in the research rail&rsquo;s setup panel.
        </p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="section-heading compact">
        <div>
          <span className="page-kicker">Robustness</span>
          <h2>Parameter surface &amp; stability</h2>
        </div>
        <div className="seg research-seg" role="group" aria-label="Surface colouring">
          <button type="button" aria-pressed={mode === "sharpe"} onClick={() => setMode("sharpe")}>
            Sharpe
          </button>
          <button type="button" aria-pressed={mode === "stability"} onClick={() => setMode("stability")}>
            Neighbourhood
          </button>
        </div>
      </div>

      <div
        className="stability-verdict"
        style={{ borderLeftColor: LEVEL_TONE[stability.verdict.level] }}
        role="status"
      >
        <strong style={{ color: LEVEL_TONE[stability.verdict.level] }}>
          <span aria-hidden>{LEVEL_GLYPH[stability.verdict.level]}</span>{" "}
          {stability.verdict.headline}
        </strong>
        <p>{stability.verdict.detail}</p>
      </div>

      {winner && (
        <div className="tiles stability-tiles">
          <StabilityTile
            label="Winner"
            value={`${winner.fast}/${winner.slow}`}
            note={`Sharpe ${fmt(winner.sharpe, 2)}`}
          />
          {/* A percentage only inside the band where it means something. The
              ratio's denominator is the winner's Sharpe, which can sit a hair
              above zero — and "-8268%" is arithmetically right and useless. */}
          <StabilityTile
            label="Neighbour Sharpe"
            value={
              winner.retention !== null && winner.retention >= 0 && winner.retention <= 2
                ? `${Math.round(winner.retention * 100)}%`
                : fmt(winner.neighbourMean, 2)
            }
            note={
              winner.retention !== null && winner.retention >= 0 && winner.retention <= 2
                ? `retained across ${winner.neighbours} neighbour${winner.neighbours === 1 ? "" : "s"}`
                : `mean of ${winner.neighbours}, against ${fmt(winner.sharpe, 2)} at the peak`
            }
            tone={
              winner.retention === null
                ? undefined
                : winner.retention >= 0.6
                  ? "pos"
                  : winner.retention <= 0.2
                    ? "neg"
                    : undefined
            }
          />
          <StabilityTile
            label="Worst neighbour"
            value={fmt(winner.neighbourMin, 2)}
            note="Sharpe one grid step away"
            tone={winner.neighbourMin < 0 ? "neg" : undefined}
          />
          <StabilityTile
            label="Grid shape"
            value={`${stability.plateauCount} / ${stability.cliffCount}`}
            note={`plateau / cliff cells of ${stability.classified} classified`}
          />
        </div>
      )}

      {/* The seg names the colouring and the heatmap legend keys it; what is left is adjacency.
          Which is a definition, and the residue after the visible affordances
          have said their part — so it folds. The numbers inside it (5, 25, 20,
          24) illustrate the rule; none of them is measured from this run, so no
          figure a reader acts on moves. Still gated on the stability mode: a
          fold nested inside the condition it always had. `.disclosure` brings
          its own top margin, which is what the inline one was doing. */}
      {mode === "stability" && (
        <details className="disclosure">
          <summary>What counts as a neighbour on this grid?</summary>
          <p className="research-note">Adjacency is in grid-index space — with a step of 5, the neighbour of 25 is 20, because 24 was never tested.</p>
        </details>
      )}

      <Heatmap
        results={results}
        best={best}
        selected={selected}
        onSelect={onSelect}
        mode={mode}
        stability={stability.cells}
      />
    </div>
  );
}

function StabilityTile({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note: string;
  tone?: "pos" | "neg";
}) {
  const color =
    tone === "pos" ? "var(--success-text)" : tone === "neg" ? "var(--critical-text)" : "var(--text-primary)";
  return (
    <div className="stability-tile">
      <span>{label}</span>
      <strong className="num" style={{ color }}>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
