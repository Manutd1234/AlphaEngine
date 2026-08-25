"use client";

/**
 * The estimator with its controls left on.
 *
 * A SECTION SINCE 2026-08-25. The three views here are the only ones on the tab
 * a reader can DRIVE, and they were the last three buttons of a five-button
 * switcher whose first two were reading matter. Set an absorbed curve and watch
 * where the half-life lands; push the noise up until the gate refuses; move the
 * eigenvalues and watch the spectrum's mass slide along the resolution axis.
 *
 * The interesting case is the refusal. An estimator that always answers is not
 * being watched carefully enough, and each of these three can be driven to a
 * state where the honest output is a named reason rather than a number.
 *
 * READS NOTHING. Every figure computes in this browser from
 * `lib/coherence/diffusion-model`, the TypeScript port a committed parity
 * fixture holds to the Python reference — which is what makes a slider possible
 * at all, since a round trip per keystroke would make all three unusable.
 */

import { memo, useState } from "react";

import PaneHead from "../PaneHead";
import DiffusionSimulator from "./model/DiffusionSimulator";
import HalfLifeCalculator from "./model/HalfLifeCalculator";
import SpectrumExplorer from "./model/SpectrumExplorer";

type SandboxView = "halflife" | "simulator" | "spectrum";

const VIEWS: ReadonlyArray<[SandboxView, string]> = [
  ["halflife", "Half-life"],
  ["simulator", "Simulator"],
  ["spectrum", "Spectrum"],
];

function SandboxSection() {
  const [view, setView] = useState<SandboxView>("halflife");
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-sandbox-heading">
      <PaneHead
        kicker="Sandbox"
        title="Move the inputs and watch it answer, or decline to"
        id="diffusion-sandbox-heading"
        note="computed on a slider a reader moves"
        lede="Every number here comes from the same arithmetic the gateway runs, so a refusal you can produce with a slider is a refusal the ledger can produce too."
      />
      {/* Wrapped 2026-08-25: a bare `.seg` could be reached by neither
          the sticky rule nor the wrap rule, both `.coh-bar`-scoped. */}
      <div className="coh-bar">
        <div className="seg" role="group" aria-label="Sandbox view">
          {VIEWS.map(([name, label]) => (
            <button key={name} type="button" aria-pressed={view === name} onClick={() => setView(name)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {view === "halflife" ? <HalfLifeCalculator />
        : view === "simulator" ? <DiffusionSimulator />
          : <SpectrumExplorer />}
    </section>
  );
}

/**
 * MEMOISED, because the console above it re-renders on every poll.
 *
 * `DiffusionConsole` has to re-render every twenty seconds — the freshness
 * stamp is a clock — but since `use-coherence.ts` keeps a payload's identity
 * when nothing drawable changed, the props reaching this section are usually
 * the same objects they were. Without a memo boundary that fact buys nothing:
 * a parent re-render re-renders its children whatever their props say.
 *
 * The saving is small and measured rather than assumed: about 1.9ms of script
 * per poll, taken back to back with only the identity check toggled. React
 * writes nothing to the DOM when the output matches, so what this boundary
 * saves is reconciliation, not paint.
 */
export default memo(SandboxSection);
