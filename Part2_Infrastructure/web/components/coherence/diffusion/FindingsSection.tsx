"use client";

/**
 * What the study concluded, and whether the instrument was fit to conclude it.
 *
 * A SECTION AGAIN, UNDER ITS PUBLISHED ID. `findings` was a Proofs section,
 * folded into Diffusion as a one-view group on 2026-08-24, and returns on
 * 2026-08-25 with the id it was published under.
 *
 * It is also the reason the Diffusion tab exists. As a group it drew its own
 * three-panel switcher INSIDE a view inside a group — a third control level,
 * carried in `coherence-sections.test.ts` as a named exemption because there
 * was nowhere else to put it. `FindingsPane` keeps that switcher; it is now the
 * section's one control row rather than a third level, so the exemption is
 * deleted rather than inherited.
 */

import FindingsPane from "./FindingsPane";
import PaneHead from "../PaneHead";

export default function FindingsSection({ active }: { active: boolean }) {
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-findings-heading">
      <PaneHead
        kicker="Findings"
        title="What the study concluded, out of sample"
        id="diffusion-findings-heading"
        note="reported against a pre-registered control"
        lede="The absorption clock is predictable without the text at all — R² +0.14 out of sample — and the statement's spectrum adds nothing to it, a sharper and falsifiable claim rather than “nothing predicts anything”."
      />
      <FindingsPane active={active} />
    </section>
  );
}
