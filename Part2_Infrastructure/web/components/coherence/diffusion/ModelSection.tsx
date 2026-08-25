"use client";

/**
 * The model, worked in the browser.
 *
 * READS NOTHING, and that is the section's whole argument rather than a
 * limitation of it: `gaussian.py` shows the closed form exists, so the
 * instrument can ship before the model does. Every view here computes from
 * `lib/coherence/diffusion-model`, a TypeScript port held to the Python
 * original by a committed parity fixture. A gateway call in this section would
 * contradict the thing the section demonstrates.
 */

import { useState } from "react";

import PaneHead from "../PaneHead";
import DiffusionSimulator from "./model/DiffusionSimulator";
import HalfLifeCalculator from "./model/HalfLifeCalculator";
import ModelFormulas from "./model/ModelFormulas";
import SpectrumExplorer from "./model/SpectrumExplorer";

type ModelView = "measurement" | "instrument" | "halflife" | "simulator" | "spectrum";

const VIEWS: ReadonlyArray<[ModelView, string]> = [
  ["measurement", "Measurement"],
  ["instrument", "Instrument"],
  ["halflife", "Half-life"],
  ["simulator", "Simulator"],
  ["spectrum", "Spectrum"],
];

export default function ModelSection() {
  const [view, setView] = useState<ModelView>("measurement");
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-model-heading">
      <PaneHead
        kicker="Model"
        title="What the estimator computes, worked here"
        id="diffusion-model-heading"
        note="nothing on this section is fetched"
        lede="Every figure here is computed in this browser from the same arithmetic the gateway runs, which is what lets a reader move a slider and watch the estimator decline to answer."
      />
      <div className="seg" role="group" aria-label="Model view">
        {VIEWS.map(([name, label]) => (
          <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
            {label}
          </button>
        ))}
      </div>
      {view === "measurement" || view === "instrument" ? <ModelFormulas part={view} />
        : view === "halflife" ? <HalfLifeCalculator />
          : view === "simulator" ? <DiffusionSimulator />
            : <SpectrumExplorer />}
    </section>
  );
}
