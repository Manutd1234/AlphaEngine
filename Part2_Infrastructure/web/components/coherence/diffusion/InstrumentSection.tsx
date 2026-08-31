"use client";

/**
 * The instrument built on top of the measurement: a clock that is not made of
 * the event, and the closed-form information spectrum the study reads.
 *
 * A SECTION SINCE 2026-08-25, and its twin is `model`. `ModelFormulas` already
 * split its thirteen cards into what the estimator MEASURES on a price path and
 * what is BUILT on top of it, for a measured reason — the thirteen together came
 * to 2,724px, four times the next largest view on the tab. Those two halves are
 * two questions, so they are two sections rather than two buttons.
 *
 * READS NOTHING, and that is the argument rather than a saving: `gaussian.py`
 * shows the closed form exists, so the instrument can ship before the model
 * does. A gateway call here would contradict the thing the section
 * demonstrates, and `diffusion-model-views.test.ts` holds it to that.
 */

import { memo } from "react";

import PaneHead from "../PaneHead";
import ModelFormulas from "./model/ModelFormulas";

function InstrumentSection() {
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-instrument-heading">
      <PaneHead
        kicker="Instrument"
        title="The clock, the control and the spectrum"
        id="diffusion-instrument-heading"
        note="nothing on this section is fetched"
        lede="Each card names its reference module and diagrams the instrument, its measurement, validity bound, failure mode and applicable control behind one summary."
      />
      <ModelFormulas part="instrument" />
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
export default memo(InstrumentSection);
