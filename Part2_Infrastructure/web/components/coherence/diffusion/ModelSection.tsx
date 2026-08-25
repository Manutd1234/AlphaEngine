"use client";

/**
 * What the estimator measures on a price path, worked in the browser.
 *
 * ONE VIEW SINCE 2026-08-25 and no switcher, which is the point of the split.
 * This section was five views: two of formula cards and three a reader can
 * drive. Those are different acts — reading what a thing computes, and turning
 * its knobs — so the drivable three are `sandbox` now and the instrument half
 * of the cards is `instrument`. What is left is the seven cards that say what
 * happens to a price path: the absorbed fraction, the gate that decides whether
 * there was a move at all, the crossing, and the two fits that are reported but
 * are never the verdict.
 *
 * READS NOTHING, and that is the section's argument rather than a limitation of
 * it: `gaussian.py` shows the closed form exists, so the instrument can ship
 * before the model does. A gateway call here would contradict the thing being
 * demonstrated, and `diffusion-model-views.test.ts` holds all three of these
 * sections to it.
 */

import PaneHead from "../PaneHead";
import ModelFormulas from "./model/ModelFormulas";

export default function ModelSection() {
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-model-heading">
      <PaneHead
        kicker="Measurement"
        title="What the estimator computes on a price path"
        id="diffusion-model-heading"
        note="computes in the browser, fetching nothing"
        lede="Every card names the reference module it is a port of, and states what breaks it above what it measures."
      />
      <ModelFormulas part="measurement" />
    </section>
  );
}
