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

import PaneHead from "../PaneHead";
import ModelFormulas from "./model/ModelFormulas";

export default function InstrumentSection() {
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-instrument-heading">
      <PaneHead
        kicker="Instrument"
        title="The clock, the control and the spectrum"
        id="diffusion-instrument-heading"
        note="nothing on this section is fetched"
        lede="Each card names the module it is the reference for, and states what breaks it above what it measures."
      />
      <ModelFormulas part="instrument" />
    </section>
  );
}
