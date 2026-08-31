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
import type { FindingsView } from "./FindingsPane";
import { memo } from "react";

import PaneHead from "../PaneHead";

function FindingsSection({ active, view, onView }: {
  active: boolean;
  view: FindingsView;
  onView: (next: FindingsView) => void;
}) {
  return (
    <section className="card console-card coh-diffusion" aria-labelledby="diffusion-findings-heading">
      <PaneHead
        kicker="Findings"
        title="What the study concluded, out of sample"
        id="diffusion-findings-heading"
        note="reported against a pre-registered control"
        lede="The absorption clock is scored out of sample against a baseline that knows stage and rate-move size, so statement gain isolates incremental text information rather than pipeline skill."
      />
      <FindingsPane active={active} view={view} onView={onView} />
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
export default memo(FindingsSection);
