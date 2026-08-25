"use client";

/**
 * Coherence index — how far these prices are from admitting a probability, over time.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `index` was published on
 * `origin/main`, folded into the Scorecard on 2026-08-24 because both answer
 * "were these prices right", and returns on 2026-08-25 because sharing a
 * question is not sharing a subject.
 *
 * What separates them is everything except the question. The Scorecard scores a
 * SETTLED corpus against what actually paid — once, after the fact, on markets
 * that have an answer. This measures the L1 distance from the quoted price
 * vector to the nearest one summing to a dollar, on every poll, on markets that
 * have not settled and may never. One is a verdict about the past; this is a
 * time series about the present, and it is the series nobody publishes for this
 * exchange.
 *
 * TWO READS UNDER ONE SECTION, each gated on the views that draw it — the trend
 * comes from the calibration history and the two index views from the index
 * series, so a reader on the trend never pays for the tape. That is the same
 * discipline every section on this rail keeps; it is only unusual here because
 * the section carries two rather than one, and they answer the same question
 * about two different clocks.
 */

import { useState } from "react";

import CalibrationTrend from "./CalibrationTrend";
import IndexPane from "./IndexPane";
import PaneHead from "./PaneHead";

type IndexView = "trend" | "series" | "families";

const VIEWS: ReadonlyArray<[IndexView, string]> = [
  ["trend", "Score trend"],
  ["series", "By poll"],
  ["families", "By family"],
];

export default function IndexSection({ active }: { active: boolean }) {
  const [view, setView] = useState<IndexView>("trend");

  return (
    <section className="card console-card coh-calib" aria-labelledby="coherence-index-heading">
      <PaneHead
        kicker="Coherence index"
        title="How far these prices sit from admitting a probability"
        id="coherence-index-heading"
        note="measured every poll, on markets that have not settled"
        lede="Zero is prices that admit a probability exactly; the distance above it is how much the quotes contradict themselves."
      />

      {/* The control row is pinned (`14u`), so a reader deep in the body can
          switch view without scrolling back to the head. One row per section is
          the rule this rail already kept; wrapping it is what made it pinnable. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Index view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* The branch IS the gate, and the compiler proves it: inside the else,
          `view` cannot be "trend", so a conjunction guarding on it would be one
          TypeScript reports as always true. An always-true guard reads like a
          gate and defends nothing, which is worse than having none. */}
      {view === "trend" ? (
        <CalibrationTrend active={active} />
      ) : (
        <IndexPane active={active} view={view === "series" ? "series" : "families"} />
      )}
    </section>
  );
}
